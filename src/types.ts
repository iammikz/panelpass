export type Theme = 'light' | 'dark';

export type ComicSource =
  | { type: 'local' }
  | { type: 'google-drive'; driveFileId: string; driveName: string };

export interface Comic {
  id: string; // UUID
  title: string;
  addedAt: number; // timestamp
  currentPage: number;
  totalPages: number;
  coverImage?: string; // base64 or blob URL of the first page
  isCompleted: boolean;
  source: ComicSource;
}

// Stored separately in IndexedDB to avoid loading huge blobs into memory everywhere
export interface ComicFile {
  id: string;
  data: Blob;
}
