import { useEffect, useState } from 'react';
import { useGoogleLogin } from '@react-oauth/google';
import { Check, Cloud, Download, LoaderCircle, LogOut, RefreshCw, X } from 'lucide-react';
import { downloadDriveFile, DriveFile, findPanelpassFolder, listComicsInFolder } from '../lib/googleDrive';
import { cn } from '../lib/utils';

interface GoogleDrivePickerProps {
  onImport: (file: File) => Promise<void>;
  importedDriveIds: Set<string>;
}

type ImportableDriveFile = File & {
  driveMetadata?: {
    id: string;
    name: string;
  };
};

interface AuthSession {
  popup: Window | null;
  redirectUri: string;
  state: string;
  verifier: string;
}

interface AuthMessage {
  type: string;
  code?: string;
  error?: string;
  state?: string;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
}

const AUTH_MESSAGE_TYPE = 'panelpass-google-drive-auth';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';

function base64UrlEncode(bytes: Uint8Array): string {
  let value = '';

  bytes.forEach((byte) => {
    value += String.fromCharCode(byte);
  });

  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function createVerifier(): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
}

async function createChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));

  return base64UrlEncode(new Uint8Array(digest));
}

function formatBytes(value: number): string {
  if (value === 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const size = value / 1024 ** index;

  return `${size >= 10 || index === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[index]}`;
}

async function exchangeCodeForToken(
  clientId: string,
  code: string,
  verifier: string,
  redirectUri: string,
): Promise<TokenResponse> {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: clientId,
      code,
      code_verifier: verifier,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }),
  });

  if (!response.ok) {
    throw new Error('Failed to finish Google Drive sign-in.');
  }

  return response.json() as Promise<TokenResponse>;
}

export default function GoogleDrivePicker({ onImport, importedDriveIds }: GoogleDrivePickerProps) {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  const authSessionRef = useRef<AuthSession | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [importingIds, setImportingIds] = useState<Set<string>>(new Set());
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [folderMessage, setFolderMessage] = useState<string | null>(null);
  const [fileErrors, setFileErrors] = useState<Record<string, string>>({});

  const login = useGoogleLogin({
    onSuccess: ({ access_token, expires_in }) => {
      setAccessToken(access_token);
      setExpiresAt(Date.now() + (expires_in ?? 3600) * 1000);
      setIsAuthenticating(false);
      setError(null);
      setIsOpen(true);
    },
    onError: () => {
      setError('Google Drive sign-in failed.');
      setIsAuthenticating(false);
    },
    onNonOAuthError: ({ type }) => {
      if (type !== 'popup_closed') {
        setError('Popup was blocked. Allow popups for this site and try again.');
      }
      setIsAuthenticating(false);
    },
    scope: DRIVE_SCOPE,
  });

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const authError = searchParams.get('error');

    if (window.opener && (code || authError)) {
      window.opener.postMessage(
        {
          type: AUTH_MESSAGE_TYPE,
          code: code ?? undefined,
          error: authError ?? undefined,
          state: state ?? undefined,
        } satisfies AuthMessage,
        window.location.origin,
      );

      window.history.replaceState({}, document.title, window.location.pathname);
      window.close();
    }
  }, []);

  useEffect(() => {
    if (!expiresAt) {
      return undefined;
    }

    const timeout = window.setTimeout(() => {
      handleDisconnect();
      setError('Google Drive session expired. Connect again to continue.');
    }, Math.max(expiresAt - Date.now(), 0));

    return () => window.clearTimeout(timeout);
  }, [expiresAt]);

  useEffect(() => {
    setSelectedIds((current) => new Set([...current].filter((id) => !importedDriveIds.has(id))));
  }, [importedDriveIds]);

  useEffect(() => {
    const handleMessage = async (event: MessageEvent<AuthMessage>) => {
      if (event.origin !== window.location.origin || event.data?.type !== AUTH_MESSAGE_TYPE) {
        return;
      }

      const authSession = authSessionRef.current;

      if (!authSession || event.data.state !== authSession.state) {
        return;
      }

      authSession.popup?.close();
      authSessionRef.current = null;
      setIsAuthenticating(false);

      if (event.data.error) {
        setError('Google Drive sign-in was cancelled or denied.');
        return;
      }

      if (!event.data.code || !clientId) {
        setError('Google Drive sign-in did not return an authorization code.');
        return;
      }

      try {
        const tokenResponse = await exchangeCodeForToken(
          clientId,
          event.data.code,
          authSession.verifier,
          authSession.redirectUri,
        );

        setAccessToken(tokenResponse.access_token);
        setExpiresAt(Date.now() + tokenResponse.expires_in * 1000);
        setError(null);
        setIsOpen(true);
      } catch (authError) {
        console.error(authError);
        setError(authError instanceof Error ? authError.message : 'Failed to finish Google Drive sign-in.');
      }
    };

    window.addEventListener('message', handleMessage);

    return () => window.removeEventListener('message', handleMessage);
  }, [clientId]);

  useEffect(() => {
    if (!isOpen || !accessToken) {
      return;
    }

    void loadDriveFiles(accessToken);
  }, [accessToken, isOpen]);

  const handleDisconnect = () => {
    setAccessToken(null);
    setExpiresAt(null);
    setFiles([]);
    setSelectedIds(new Set());
    setImportingIds(new Set());
    setFileErrors({});
  };

  const loadDriveFiles = async (token: string) => {
    setIsLoadingFiles(true);
    setError(null);
    setFolderMessage(null);
    setFileErrors({});

    try {
      const folderId = await findPanelpassFolder(token);

      if (!folderId) {
        setFiles([]);
        setFolderMessage('No `panelpass` folder found in your Google Drive. Create a folder named `panelpass` and add your comic files there.');
        return;
      }

      const driveFiles = await listComicsInFolder(token, folderId);
      setFiles(driveFiles);

      if (driveFiles.length === 0) {
        setFolderMessage('No `.cbz` or `.cbr` files were found in your `panelpass` folder yet.');
      }
    } catch (loadError) {
      console.error(loadError);

      if (loadError instanceof Error && loadError.message === 'Google Drive session expired.') {
        handleDisconnect();
      }

      setError(loadError instanceof Error ? loadError.message : 'Failed to load Google Drive files.');
    } finally {
      setIsLoadingFiles(false);
    }
  };

  const beginAuth = async () => {
    if (!clientId) {
      setError('Set `VITE_GOOGLE_CLIENT_ID` in `.env.local` before connecting Google Drive.');
      return;
    }

    setIsAuthenticating(true);
    setError(null);

    try {
      const verifier = createVerifier();
      const challenge = await createChallenge(verifier);
      const state = crypto.randomUUID();
      const redirectUri = `${window.location.origin}${window.location.pathname}`;
      const popup = window.open('', 'panelpass-google-drive', 'popup,width=520,height=720');

      if (!popup) {
        throw new Error('Popup blocked. Allow popups for this site and try again.');
      }

      authSessionRef.current = {
        popup,
        redirectUri,
        state,
        verifier,
      };

      const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');

      authUrl.search = new URLSearchParams({
        client_id: clientId,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: DRIVE_SCOPE,
        state,
        prompt: 'consent',
      }).toString();

      popup.location.href = authUrl.toString();
    } catch (authError) {
      console.error(authError);
      authSessionRef.current?.popup?.close();
      authSessionRef.current = null;
      setError(authError instanceof Error ? authError.message : 'Failed to start Google Drive sign-in.');
      setIsAuthenticating(false);
    }
  };

  const handleOpen = () => {
    if (!import.meta.env.VITE_GOOGLE_CLIENT_ID) {
      setError('Set VITE_GOOGLE_CLIENT_ID in .env.local before connecting Google Drive.');
      return;
    }
    if (accessToken) {
      setIsOpen(true);
      return;
    }
    setIsAuthenticating(true);
    login();
  };

  const toggleSelection = (fileId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);

      if (next.has(fileId)) {
        next.delete(fileId);
      } else {
        next.add(fileId);
      }

      return next;
    });
  };

  const markImporting = (fileId: string, isImporting: boolean) => {
    setImportingIds((current) => {
      const next = new Set(current);

      if (isImporting) {
        next.add(fileId);
      } else {
        next.delete(fileId);
      }

      return next;
    });
  };

  const importDriveComic = async (driveFile: DriveFile) => {
    if (!accessToken || importedDriveIds.has(driveFile.id)) {
      return;
    }

    markImporting(driveFile.id, true);
    setFileErrors((current) => {
      const next = { ...current };
      delete next[driveFile.id];
      return next;
    });

    try {
      const blob = await downloadDriveFile(accessToken, driveFile.id);
      const file = new File([blob], driveFile.name, { type: blob.type || 'application/octet-stream' }) as ImportableDriveFile;
      file.driveMetadata = {
        id: driveFile.id,
        name: driveFile.name,
      };

      await onImport(file);
      setSelectedIds((current) => {
        const next = new Set(current);
        next.delete(driveFile.id);
        return next;
      });
    } catch (importError) {
      console.error(importError);

      if (importError instanceof Error && importError.message === 'Google Drive session expired.') {
        handleDisconnect();
        setError('Google Drive session expired. Connect again to continue.');
        return;
      }

      setFileErrors((current) => ({
        ...current,
        [driveFile.id]: importError instanceof Error ? importError.message : 'Import failed.',
      }));
    } finally {
      markImporting(driveFile.id, false);
    }
  };

  const handleImportSelected = async () => {
    const pendingFiles = files.filter(
      (file) => selectedIds.has(file.id) && !importedDriveIds.has(file.id) && !importingIds.has(file.id),
    );

    for (const driveFile of pendingFiles) {
      await importDriveComic(driveFile);
    }
  };

  const selectedImportCount = [...selectedIds].filter((id) => !importedDriveIds.has(id)).length;

  return (
    <>
      <button
        onClick={() => void handleOpen()}
        disabled={isAuthenticating}
        className="border border-[#333] px-5 py-2 font-black text-sm uppercase tracking-tight text-[#F0F0F0] transform skew-x-[-12deg] hover:border-cyan-400 hover:text-cyan-400 hover:scale-105 active:scale-95 transition-all disabled:opacity-50 disabled:hover:scale-100"
      >
        <span className="transform skew-x-[12deg] flex items-center gap-2">
          {isAuthenticating ? <LoaderCircle size={16} className="animate-spin" /> : <Cloud size={16} />}
          {accessToken ? 'Open Google Drive' : 'Connect Google Drive'}
        </span>
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-4xl rounded-2xl border border-[#2A2A2A] bg-[#0F0F0F] shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between border-b border-[#222] px-6 py-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-cyan-400">Google Drive</p>
                <h2 className="mt-1 text-xl font-black italic uppercase tracking-tight font-display">panelpass folder</h2>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => accessToken && void loadDriveFiles(accessToken)}
                  disabled={!accessToken || isLoadingFiles}
                  className="rounded-lg border border-[#333] p-2 text-[#888] hover:border-cyan-400 hover:text-cyan-400 transition-colors disabled:opacity-50"
                  title="Refresh files"
                >
                  <RefreshCw size={16} className={cn(isLoadingFiles && 'animate-spin')} />
                </button>

                {accessToken && (
                  <button
                    onClick={handleDisconnect}
                    className="rounded-lg border border-[#333] px-3 py-2 text-xs font-bold uppercase tracking-widest text-[#888] hover:border-red-500 hover:text-red-400 transition-colors"
                  >
                    <span className="flex items-center gap-2">
                      <LogOut size={14} />
                      Disconnect
                    </span>
                  </button>
                )}

                <button
                  onClick={() => setIsOpen(false)}
                  className="rounded-lg border border-[#333] p-2 text-[#888] hover:border-white hover:text-white transition-colors"
                  title="Close"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            <div className="border-b border-[#222] px-6 py-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between bg-[#111]">
              <p className="text-xs text-[#888] max-w-2xl">
                Browse `.cbz` and `.cbr` files from your Google Drive `panelpass` folder and import them into local storage.
              </p>

              <button
                onClick={() => void handleImportSelected()}
                disabled={selectedImportCount === 0 || importingIds.size > 0}
                className="bg-cyan-400 text-black px-4 py-2 text-xs font-black uppercase tracking-widest rounded-lg hover:brightness-110 transition disabled:opacity-50"
              >
                Import Selected {selectedImportCount > 0 ? `(${selectedImportCount})` : ''}
              </button>
            </div>

            {(error || folderMessage) && (
              <div className="px-6 pt-5">
                {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>}
                {folderMessage && <div className="mt-3 rounded-xl border border-[#333] bg-[#141414] px-4 py-3 text-sm text-[#BBB]">{folderMessage}</div>}
              </div>
            )}

            <div className="max-h-[65vh] overflow-y-auto px-6 py-5">
              {isLoadingFiles ? (
                <div className="flex min-h-48 items-center justify-center text-[#888]">
                  <div className="flex items-center gap-3 text-sm font-bold uppercase tracking-widest">
                    <LoaderCircle size={18} className="animate-spin text-cyan-400" />
                    Loading Drive files
                  </div>
                </div>
              ) : files.length > 0 ? (
                <div className="space-y-3">
                  {files.map((file) => {
                    const isImported = importedDriveIds.has(file.id);
                    const isImporting = importingIds.has(file.id);
                    const isSelected = selectedIds.has(file.id);

                    return (
                      <div key={file.id} className="rounded-xl border border-[#222] bg-[#141414] p-4">
                        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                          <label className="flex items-start gap-3 cursor-pointer">
                            <button
                              type="button"
                              onClick={() => !isImported && !isImporting && toggleSelection(file.id)}
                              disabled={isImported || isImporting}
                              className={cn(
                                'mt-0.5 flex h-5 w-5 items-center justify-center rounded border transition-colors',
                                isSelected ? 'border-cyan-400 bg-cyan-400 text-black' : 'border-[#444] bg-black text-transparent',
                                (isImported || isImporting) && 'opacity-50',
                              )}
                              aria-pressed={isSelected}
                            >
                              <Check size={14} strokeWidth={3} />
                            </button>

                            <div>
                              <p className="text-sm font-bold uppercase tracking-wide text-[#F0F0F0] break-all">{file.name}</p>
                              <p className="mt-1 text-[11px] font-bold uppercase tracking-[0.2em] text-[#666]">{formatBytes(file.size)}</p>
                            </div>
                          </label>

                          <div className="flex items-center gap-3 self-end md:self-center">
                            {isImported && (
                              <span className="rounded-full border border-cyan-400/40 bg-cyan-400/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-300">
                                Already imported
                              </span>
                            )}

                            <button
                              onClick={() => void importDriveComic(file)}
                              disabled={isImported || isImporting}
                              className="rounded-lg border border-[#333] px-4 py-2 text-xs font-black uppercase tracking-widest text-[#F0F0F0] hover:border-cyan-400 hover:text-cyan-400 transition-colors disabled:opacity-50"
                            >
                              <span className="flex items-center gap-2">
                                {isImporting ? <LoaderCircle size={14} className="animate-spin" /> : <Download size={14} />}
                                {isImporting ? 'Importing...' : 'Import'}
                              </span>
                            </button>
                          </div>
                        </div>

                        {fileErrors[file.id] && (
                          <p className="mt-3 text-xs text-red-300">{fileErrors[file.id]}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : !error && !folderMessage ? (
                <div className="flex min-h-48 items-center justify-center text-sm text-[#666]">
                  No files available yet.
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </>
  );
}