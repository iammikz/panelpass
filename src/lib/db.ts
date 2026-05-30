import localforage from 'localforage';
import { Comic, ComicSource } from '../types';

const metadataStorage = localforage.createInstance({
  name: 'PanelPass',
  storeName: 'metadata',
});

const fileStorage = localforage.createInstance({
  name: 'PanelPass',
  storeName: 'files',
});

export async function getComics(): Promise<Comic[]> {
  const comics = await metadataStorage.getItem<Comic[]>('comics');
  if (!comics) {
    return [];
  }

  let hasLegacyComics = false;
  const normalizedComics = comics.map((comic) => {
    if (comic.source) {
      return comic;
    }

    hasLegacyComics = true;

    return {
      ...comic,
      source: { type: 'local' } satisfies ComicSource,
    };
  });

  if (hasLegacyComics) {
    await metadataStorage.setItem('comics', normalizedComics);
  }

  return normalizedComics;
}

export async function saveComicFile(id: string, file: Blob) {
  await fileStorage.setItem(`comic_file_${id}`, file);
}

export async function saveComicMetadata(comic: Comic) {
  const comics = await getComics();
  comics.push(comic);
  await metadataStorage.setItem('comics', comics);
}

export async function getComicFile(id: string): Promise<Blob | null> {
  return fileStorage.getItem<Blob>(`comic_file_${id}`);
}

export async function updateComicProgress(id: string, currentPage: number) {
  const comics = await getComics();
  const index = comics.findIndex((c) => c.id === id);
  if (index !== -1) {
    comics[index].currentPage = currentPage;
    if (currentPage >= comics[index].totalPages - 1) {
      comics[index].isCompleted = true;
    }
    await metadataStorage.setItem('comics', comics);
  }
}

export async function deleteComic(id: string) {
  const comics = await getComics();
  const updated = comics.filter((c) => c.id !== id);
  await metadataStorage.setItem('comics', updated);
  await fileStorage.removeItem(`comic_file_${id}`);
}
