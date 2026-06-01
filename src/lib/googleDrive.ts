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
    q: `name='${name}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
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

async function getConfigFolderId(token: string): Promise<string> {
  const panelpassId = await findOrCreateFolder(token, 'root', 'panelpass');
  return findOrCreateFolder(token, panelpassId, 'config');
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