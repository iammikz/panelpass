import { Comic, ComicPageFile } from '../types';

export interface DriveFile {
  id: string;
  name: string;
  size: number;
}

export interface DriveExtractedComicMetadata {
  id: string;
  title: string;
  totalPages: number;
  coverImage?: string;
  pageFiles: ComicPageFile[];
  originalDriveFileId?: string;
  addedAt: number;
  updatedAt: number;
}

interface DriveFilesResponse {
  files?: Array<{
    id: string;
    name: string;
    size?: string;
    mimeType?: string;
  }>;
}

const DRIVE_API_URL = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';

export const DRIVE_SCOPE =
  'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.file';

async function getDriveJson<T>(token: string, searchParams: URLSearchParams): Promise<T> {
  const response = await fetch(`${DRIVE_API_URL}?${searchParams.toString()}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (response.status === 401) {
    throw new Error('Google Drive session expired.');
  }

  if (!response.ok) {
    throw new Error('Failed to load data from Google Drive.');
  }

  return response.json() as Promise<T>;
}

function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export async function findPanelpassFolder(token: string): Promise<string | null> {
  const searchParams = new URLSearchParams({
    q: "name='panelpass' and mimeType='application/vnd.google-apps.folder' and trashed=false",
    fields: 'files(id)',
    pageSize: '10',
  });

  const response = await getDriveJson<DriveFilesResponse>(token, searchParams);

  return response.files?.[0]?.id ?? null;
}

export async function listComicsInFolder(token: string, folderId: string): Promise<DriveFile[]> {
  const searchParams = new URLSearchParams({
    q: `'${folderId}' in parents and trashed=false and (name contains '.cbz' or name contains '.cbr')`,
    fields: 'files(id,name,size)',
    orderBy: 'name_natural',
    pageSize: '200',
  });

  const response = await getDriveJson<DriveFilesResponse>(token, searchParams);

  return (response.files ?? [])
    .filter((file) => /\.(cbz|cbr)$/i.test(file.name))
    .map((file) => ({
      id: file.id,
      name: file.name,
      size: Number(file.size ?? 0),
    }));
}

export async function downloadDriveFile(token: string, fileId: string): Promise<Blob> {
  const response = await fetch(`${DRIVE_API_URL}/${fileId}?alt=media`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (response.status === 401) {
    throw new Error('Google Drive session expired.');
  }

  if (!response.ok) {
    throw new Error('Failed to download file from Google Drive.');
  }

  return response.blob();
}

async function findOrCreateFolder(token: string, parentId: string, name: string): Promise<string> {
  const searchParams = new URLSearchParams({
    q: `name='${escapeDriveQueryValue(name)}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id)',
    pageSize: '1',
  });

  const response = await getDriveJson<DriveFilesResponse>(token, searchParams);
  const existingId = response.files?.[0]?.id;
  if (existingId) return existingId;

  const createResponse = await fetch(DRIVE_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    }),
  });

  if (createResponse.status === 401) throw new Error('Google Drive session expired.');
  if (!createResponse.ok) throw new Error('Failed to create folder on Google Drive.');

  const created = await createResponse.json() as { id: string };
  return created.id;
}

async function uploadMultipartFile(
  token: string,
  metadata: Record<string, unknown>,
  body: Blob | string,
  contentType: string,
): Promise<string> {
  const boundary = `panelpass_boundary_${crypto.randomUUID()}`;
  const metadataJson = JSON.stringify(metadata);
  const multipartBody = new Blob(
    [
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
      metadataJson,
      `\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`,
      body,
      `\r\n--${boundary}--`,
    ],
    { type: `multipart/related; boundary=${boundary}` },
  );

  const response = await fetch(`${DRIVE_UPLOAD_URL}?uploadType=multipart`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body: multipartBody,
  });

  if (response.status === 401) throw new Error('Google Drive session expired.');
  if (!response.ok) throw new Error('Failed to upload file to Google Drive.');

  const created = await response.json() as { id: string };
  return created.id;
}

async function updateMultipartFile(
  token: string,
  fileId: string,
  body: Blob | string,
  contentType: string,
): Promise<string> {
  const response = await fetch(`${DRIVE_UPLOAD_URL}/${fileId}?uploadType=media`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': contentType,
    },
    body,
  });

  if (response.status === 401) throw new Error('Google Drive session expired.');
  if (!response.ok) throw new Error('Failed to update file on Google Drive.');
  return fileId;
}

async function getConfigFolderId(token: string): Promise<string> {
  const panelpassId = await findOrCreateFolder(token, 'root', 'panelpass');
  return findOrCreateFolder(token, panelpassId, 'config');
}

export async function getExtractedComicsFolderId(token: string): Promise<string> {
  const panelpassId = await findOrCreateFolder(token, 'root', 'panelpass');
  const extractedId = await findOrCreateFolder(token, panelpassId, 'extracted');
  return findOrCreateFolder(token, extractedId, 'comics');
}

export function sanitizeDriveFolderName(title: string): string {
  const cleaned = title
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned || 'Untitled Comic';
}

export async function createUniqueExtractedComicFolder(
  token: string,
  title: string,
): Promise<{ folderId: string; folderName: string }> {
  const parentId = await getExtractedComicsFolderId(token);
  const baseName = sanitizeDriveFolderName(title);
  let folderName = baseName;
  let suffix = 2;

  while (true) {
    const searchParams = new URLSearchParams({
      q: `name='${escapeDriveQueryValue(folderName)}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id)',
      pageSize: '1',
    });
    const response = await getDriveJson<DriveFilesResponse>(token, searchParams);
    if (!response.files?.[0]) break;
    folderName = `${baseName} (${suffix})`;
    suffix += 1;
  }

  return {
    folderId: await findOrCreateFolder(token, parentId, folderName),
    folderName,
  };
}

export async function uploadExtractedPage(
  token: string,
  folderId: string,
  pageIndex: number,
  blob: Blob,
): Promise<ComicPageFile> {
  const extension = blob.type === 'image/png'
    ? 'png'
    : blob.type === 'image/webp'
      ? 'webp'
      : blob.type === 'image/gif'
        ? 'gif'
        : blob.type === 'image/bmp'
          ? 'bmp'
          : 'jpg';
  const name = `page-${String(pageIndex + 1).padStart(5, '0')}.${extension}`;
  const id = await uploadMultipartFile(
    token,
    { name, parents: [folderId] },
    blob,
    blob.type || 'application/octet-stream',
  );

  return { id, name };
}

export async function saveExtractedComicMetadata(
  token: string,
  folderId: string,
  metadataFileId: string,
  metadata: DriveExtractedComicMetadata,
): Promise<string> {
  const body = JSON.stringify(metadata, null, 2);
  if (metadataFileId) {
    return updateMultipartFile(token, metadataFileId, body, 'application/json');
  }

  return uploadMultipartFile(
    token,
    { name: 'metadata.json', mimeType: 'application/json', parents: [folderId] },
    body,
    'application/json',
  );
}

async function readDriveTextFile(token: string, fileId: string): Promise<string> {
  const response = await fetch(`${DRIVE_API_URL}/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (response.status === 401) throw new Error('Google Drive session expired.');
  if (!response.ok) throw new Error('Failed to download file from Google Drive.');

  return response.text();
}

async function listChildFolders(token: string, parentId: string): Promise<DriveFile[]> {
  const searchParams = new URLSearchParams({
    q: `'${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id,name)',
    orderBy: 'name_natural',
    pageSize: '200',
  });
  const response = await getDriveJson<DriveFilesResponse>(token, searchParams);

  return (response.files ?? []).map((file) => ({
    id: file.id,
    name: file.name,
    size: Number(file.size ?? 0),
  }));
}

async function findMetadataFile(token: string, folderId: string): Promise<string | null> {
  const searchParams = new URLSearchParams({
    q: `name='metadata.json' and '${folderId}' in parents and trashed=false`,
    fields: 'files(id)',
    pageSize: '1',
  });
  const response = await getDriveJson<DriveFilesResponse>(token, searchParams);

  return response.files?.[0]?.id ?? null;
}

export async function listExtractedComics(token: string): Promise<Comic[]> {
  const parentId = await getExtractedComicsFolderId(token);
  const folders = await listChildFolders(token, parentId);
  const comics: Comic[] = [];

  for (const folder of folders) {
    try {
      const metadataFileId = await findMetadataFile(token, folder.id);
      if (!metadataFileId) continue;
      const metadata = JSON.parse(await readDriveTextFile(token, metadataFileId)) as DriveExtractedComicMetadata;
      if (!metadata.id || !metadata.title || !Array.isArray(metadata.pageFiles)) continue;

      comics.push({
        id: metadata.id,
        title: metadata.title,
        addedAt: metadata.addedAt,
        lastViewedAt: metadata.updatedAt,
        currentPage: 0,
        totalPages: metadata.totalPages,
        coverImage: metadata.coverImage,
        isCompleted: false,
        source: {
          type: 'google-drive-extracted',
          folderId: folder.id,
          metadataFileId,
          driveName: folder.name,
          pageFiles: metadata.pageFiles,
          originalDriveFileId: metadata.originalDriveFileId,
        },
      });
    } catch (error) {
      console.error('Failed to load extracted comic metadata:', error);
    }
  }

  return comics;
}

export async function readLastViewedCSV(
  token: string,
): Promise<{ fileId: string; entries: Map<string, number> }> {
  const configFolderId = await getConfigFolderId(token);

  const searchParams = new URLSearchParams({
    q: `name='lastViewed.csv' and '${configFolderId}' in parents and trashed=false`,
    fields: 'files(id)',
    pageSize: '1',
  });

  const response = await getDriveJson<DriveFilesResponse>(token, searchParams);
  const fileId = response.files?.[0]?.id ?? '';

  if (!fileId) return { fileId: '', entries: new Map() };

  const mediaResponse = await fetch(`${DRIVE_API_URL}/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (mediaResponse.status === 401) throw new Error('Google Drive session expired.');
  if (!mediaResponse.ok) return { fileId, entries: new Map() };

  const text = await mediaResponse.text();
  const entries = new Map<string, number>();
  const lines = text.split('\n');

  // Skip header row (id,current_page)
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const commaIdx = line.indexOf(',');
    if (commaIdx === -1) continue;
    const id = line.slice(0, commaIdx).trim();
    const page = parseInt(line.slice(commaIdx + 1).trim(), 10);
    if (id && !isNaN(page)) entries.set(id, page);
  }

  return { fileId, entries };
}

export async function writeLastViewedCSV(
  token: string,
  fileId: string,
  entries: Map<string, number>,
): Promise<string> {
  const rows = ['id,current_page'];
  entries.forEach((page, id) => rows.push(`${id},${page}`));
  const csvContent = rows.join('\n') + '\n';

  if (fileId) {
    const response = await fetch(`${DRIVE_UPLOAD_URL}/${fileId}?uploadType=media`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'text/csv',
      },
      body: csvContent,
    });

    if (response.status === 401) throw new Error('Google Drive session expired.');
    if (!response.ok) throw new Error('Failed to update lastViewed.csv on Google Drive.');
    return fileId;
  }

  // Create new file via multipart upload
  const configFolderId = await getConfigFolderId(token);
  const metadata = JSON.stringify({ name: 'lastViewed.csv', mimeType: 'text/csv', parents: [configFolderId] });
  const boundary = 'panelpass_csv_boundary';
  const multipartBody =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${metadata}\r\n` +
    `--${boundary}\r\nContent-Type: text/csv\r\n\r\n` +
    `${csvContent}\r\n` +
    `--${boundary}--`;

  const response = await fetch(`${DRIVE_UPLOAD_URL}?uploadType=multipart`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body: multipartBody,
  });

  if (response.status === 401) throw new Error('Google Drive session expired.');
  if (!response.ok) throw new Error('Failed to create lastViewed.csv on Google Drive.');

  const created = await response.json() as { id: string };
  return created.id;
}
