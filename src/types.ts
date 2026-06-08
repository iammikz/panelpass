export type Theme = 'light' | 'dark';

export interface ComicPageFile {
  id: string;
  name: string;
}

export type ComicSource =
  | { type: 'local' }
  | { type: 'google-drive'; driveFileId: string; driveName: string }
  | {
      type: 'google-drive-extracted';
      folderId: string;
      metadataFileId: string;
      driveName: string;
      pageFiles: ComicPageFile[];
      originalDriveFileId?: string;
    };

export interface Comic {
  id: string; // UUID
  title: string;
  addedAt: number; // timestamp
  lastViewedAt?: number; // timestamp
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
