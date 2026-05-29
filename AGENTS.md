# PanelPass — Agent Instructions

PanelPass is a **local-first, offline browser-based comic reader** for `.cbr`/`.cbz` files built with React 19, Vite 6, TypeScript, and Tailwind CSS v4. No backend, no server, no auth — everything runs in the browser with IndexedDB for persistence.

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
  App.tsx                  # Root: switches between 'library' and 'reader' views
  types.ts                 # Shared types: Comic, Theme, ComicFile
  components/
    Library.tsx            # Upload, bookshelf grid, reading stats, drag-and-drop
    Reader.tsx             # Full-screen reader: single-page + webtoon modes
  lib/
    db.ts                  # localforage wrappers — two stores: 'metadata' and 'files'
    parser.ts              # JSZip-based CBZ parser; exposes ComicParser class
    utils.ts               # cn() (clsx+twMerge), generateId(), formatTime()
```

## Feature Status

### Implemented
| Feature | Location |
|---------|----------|
| CBZ/ZIP upload (drag-and-drop + browse) | `Library.tsx` → `processFile()` |
| Bookshelf grid with cover thumbnails + progress bar | `Library.tsx` |
| Reading progress saved per comic | `db.ts` → `updateComicProgress()` |
| Single-page reader mode | `Reader.tsx` |
| Vertical scroll (webtoon) reader mode | `Reader.tsx` |
| Panel tap-to-zoom (double-click) | `Reader.tsx` → `handleDoubleTap()` |
| Light / dark / sepia reading themes | `Reader.tsx` — persisted via `useLocalStorage` |
| Keyboard navigation (arrows, space, escape) | `Reader.tsx` |
| Reading stats dashboard (total books, completed, pages) | `Library.tsx` footer section |

### Planned — do not implement unless explicitly asked
| Feature | Notes |
|---------|-------|
| **CBR support** | RAR-compressed; requires `unrar.js` — JSZip cannot open RAR. Touch points: `parser.ts`, `processFile()` in `Library.tsx` |
| **Double-page spread mode** | Third reader mode for tablet/landscape. Add `'spread'` to the `'single' \| 'webtoon'` union in `types.ts` and `Reader.tsx` |
| **Google Drive integration** | OAuth (PKCE, no backend), Drive picker scoped to `panelpass/` folder, new `ComicSource` type in `types.ts` to distinguish local vs. Drive files |
| **Bookmarks & notes** | Per-page bookmarks + private notes; needs new `Bookmark` type and a third localforage store |
| **Series / collection grouping** | Group comics into named series with issue numbers; needs a `Series` type and UI in `Library.tsx` |
| **Search & filter** | In-library search by title; filter by recently added / in-progress |

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
- **IDs**: `generateId()` uses `Math.random().toString(36)`. Migrate to `crypto.randomUUID()` when Google Drive is added.
- **Imports**: One import statement per source module — never split `import { a } from 'x'; import { b } from 'x'`.
- **Version**: Keep `package.json` `.version` and the footer string in `Library.tsx` in sync.

## Supported Formats (current)

- `.cbz` / `.zip` — `ComicParser` in `src/lib/parser.ts` via JSZip.
- Cover images stored as base64 data URLs in metadata; page images use `URL.createObjectURL` with ref-tracked cleanup.

## Common Pitfalls

- `ComicParser` must be instantiated fresh per file — it holds internal `zip` and `imagePaths` state.
- `handleTurnPage` reads `comicRef.current` (not `comic` state) to avoid stale closures on rapid input.
- Blob URL cleanup uses `pageUrlRef` / `nextPageUrlRef` refs revoked on unmount and on each page turn — do not remove these refs.
- `progress` in `Library.tsx` guards against `totalPages === 1` to avoid `NaN` width.
