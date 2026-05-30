export interface DriveFile {
  id: string;
  name: string;
  size: number;
}

interface DriveFilesResponse {
  files?: Array<{
    id: string;
    name: string;
    size?: string;
  }>;
}

const DRIVE_API_URL = 'https://www.googleapis.com/drive/v3/files';

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