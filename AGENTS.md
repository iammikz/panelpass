# PanelPass — Agent Instructions

PanelPass is a **local-first, offline browser-based comic reader** for `.cbr`/`.cbz` files built with React 19, Vite 6, TypeScript, and Tailwind CSS v4. No backend, no server, no auth — everything runs in the browser with IndexedDB for persistence.

> **Platform:** PanelPass is a **web app**, not an Android app. The `extensions/keiyoushi-extensions-source` folder (a plain gitignored vendored copy of the Kotlin/Tachiyomi sources) is reference material only — its `HttpSource` contract (build an HTTP request, parse the response) is fully implementable in the browser via `fetch()` + JSON/DOM parsing. We **port the source behaviour into TypeScript**, never compile or run Kotlin. See `docs/manifest-scoping.md`.

## Commands

```bash
npm run dev      # dev server on :3000 (0.0.0.0)
npm run build    # production build → dist/
npm run preview  # preview the production build
npm run lint     # TypeScript type-check only (tsc --noEmit)
```

> There are **no test files**. Do not create test infrastructure unless explicitly asked.

## Architecture

```
src/
  App.tsx                  # Root: switches between 'library', 'reader', and 'settings' views
  types.ts                 # Shared types: Comic, ComicSource, ComicPageFile, ComicFile, Theme
  components/
    Library.tsx            # Upload, bookshelf grid, sort, stats, drag-and-drop, delete
    Reader.tsx             # Full-screen reader: single/dual page + webtoon (one/all-v/all-h), zoom, gestures, scrubber
    Settings.tsx           # Storage info panel + Drive cloud toggle (currently disabled)
    GoogleDrivePicker.tsx  # OAuth flow + Drive file picker / import modal
    HowToUse.tsx           # First-run walkthrough modal
  lib/
    db.ts                  # localforage wrappers — two stores: 'metadata' and 'files'
    parser.ts              # ComicParser: CBZ/ZIP (JSZip) + CBR/RAR (node-unrar-js) parsing
    googleDrive.ts         # Drive REST helpers: folder/file listing, download, extracted-sync, progress CSV
    utils.ts               # cn() (clsx+twMerge), generateId() (crypto.randomUUID), formatTime()
extensions/
  keiyoushi-extensions-source/  # vendored reference copy of Tachiyomi-style source defs (plain gitignored folder, NOT a submodule) — added to prep manga online/offline reading
```

## Feature Status

### Implemented
| Feature | Location |
|---------|----------|
| CBZ / ZIP / CBR upload (drag-and-drop + browse) | `Library.tsx` → `processFile()`; `parser.ts` → `loadRar()` (`.cbr` via `node-unrar-js`) |
| Bookshelf grid with cover thumbnails + progress bar | `Library.tsx` |
| Reading progress saved per comic (auto + on page turn / scroll) | `db.ts` → `updateComicProgress()` |
| Single-page reader mode | `Reader.tsx` |
| Dual-page spread mode | `Reader.tsx` → `pageSubMode: 'dual'` |
| Webtoon reader: one-page / all-pages vertical / all-pages horizontal | `Reader.tsx` → `webtoonSubMode` |
| Panel tap-to-zoom (double-click / double-tap) | `Reader.tsx` → `handleDoubleTap()` |
| Swipe gestures + single/double-tap disambiguation (touch) | `Reader.tsx` |
| Page scrubber + direct page jump | `Reader.tsx` |
| Light / dark reading themes | `Reader.tsx` — persisted via `useLocalStorage` |
| Keyboard navigation (arrows, space, escape) | `Reader.tsx` |
| Reading stats dashboard (total books, completed, pages) | `Library.tsx` footer section |
| Sorting (name / recently viewed) | `Library.tsx` → `sortComics()` |
| First-run how-to-use walkthrough | `HowToUse.tsx` |
| Settings view (storage info, Drive toggle) | `Settings.tsx` |
| Google Drive **Connect + Import** (download `.cbz`/`.cbr` from `panelpass/` folder into local library) | `GoogleDrivePicker.tsx`, `googleDrive.ts` (`findPanelpassFolder`, `listComicsInFolder`, `downloadDriveFile`) |

### Planned — do not implement unless explicitly asked
| Feature | Notes |
|---------|-------|
| **Google Drive Cloud Storage sync** | Extracted-page cloud storage + `lastViewed.csv` progress sync. ⚠️ **Under maintenance** — the code exists in `googleDrive.ts` (`listExtractedComics`, `upsertComicsMetadata`, `readLastViewedCSV`, `uploadExtractedPage`, `createUniqueExtractedComicFolder`) but is NOT wired in; `Settings.tsx` hardcodes the toggle off (`isDriveStorageAvailable = false`). Do not re-enable until the store/retrieve data bugs are resolved. |
| **Bookmarks & notes** | Per-page bookmarks + private notes; needs new `Bookmark` type and a third localforage store |
| **Series / collection grouping** | Group comics into named series with issue numbers; needs a `Series` type and UI in `Library.tsx` |
| **Search & filter** | In-library search by title; filter by recently added / in-progress |
| **Manga online & offline search/reading** | Tachiyomi-style extension sources. `extensions/keiyoushi-extensions-source` (vendored reference copy, plain gitignored folder — not a submodule) added as groundwork only — no source engine or reader built yet. Scoped in `docs/manifest-scoping.md`. **Web app, not Android:** port sources to TS via `fetch()`, do not compile Kotlin. |

## Responsive Breakpoints

| Device | Breakpoint | Reader layout | Library grid |
|--------|------------|---------------|--------------|
| Mobile | < 768px | Vertical scroll (webtoon default) | 2 columns |
| Tablet | 768px – 1024px | Double-page spread option | 3 columns |
| Desktop | > 1024px | Single / double page + sidebar | 5–6 columns |

## Key Conventions

- **Styling**: Tailwind CSS v4 via `@tailwindcss/vite` plugin. No `tailwind.config.*` file — theme tokens in `src/index.css` under `@theme {}`. Use `cn()` from `src/lib/utils.ts` for conditional classes.
- **State**: Local component state only (`useState`). No global store. Reader settings (theme, mode) persist via `useLocalStorage` from `usehooks-ts`.
- **Persistence**: `localforage` (IndexedDB). Two instances in `src/lib/db.ts` — `metadata` stores `Comic[]`, `files` stores raw `Blob` keyed as `comic_file_<id>`.
- **IDs**: `generateId()` uses `crypto.randomUUID()` (migrated when Google Drive support was added).
- **Imports**: One import statement per source module — never split `import { a } from 'x'; import { b } from 'x'`.
- **Version**: Keep `package.json` `.version` and the footer string in `Library.tsx` in sync.

## Supported Formats (current)

- `.cbz` / `.zip` — `ComicParser` in `src/lib/parser.ts` via JSZip.
- `.cbr` / `.rar` — `ComicParser` via `node-unrar-js` (WASM), detected by RAR magic bytes (`Rar!`).
- Cover images stored as base64 data URLs in metadata; page images use `URL.createObjectURL` with ref-tracked cleanup.

## Common Pitfalls

- `ComicParser` must be instantiated fresh per file — it holds internal `zip` and `imagePaths` state.
- `handleTurnPage` reads `comicRef.current` (not `comic` state) to avoid stale closures on rapid input.
- Blob URL cleanup uses `pageUrlRef` / `nextPageUrlRef` refs revoked on unmount and on each page turn — do not remove these refs.
- `progress` in `Library.tsx` guards against `totalPages === 1` to avoid `NaN` width.
