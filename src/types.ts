export type Theme = 'light' | 'dark' | 'sepia';

export interface Comic {
  id: string; // UUID
  title: string;
  addedAt: number; // timestamp
  currentPage: number;
  totalPages: number;
  coverImage?: string; // base64 or blob URL of the first page
  isCompleted: boolean;
}

// Stored separately in IndexedDB to avoid loading huge blobs into memory everywhere
export interface ComicFile {
  id: string;
  data: Blob;
}
