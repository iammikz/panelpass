---
description: "Implement Google Drive integration — OAuth PKCE login, browse the panelpass/ folder, and import .cbz/.cbr files into the local library"
name: "Google Drive Integration"
argument-hint: "Any extra scope or constraint (e.g. 'read-only', 'also support root folder')"
agent: "agent"
tools: ["search", "read_file", "replace_string_in_file", "create_file", "run_in_terminal"]
---

# Google Drive Integration for PanelPass

Implement the Google Drive integration described in `AGENTS.md` and the architecture below. Work through each step in order. After each step, verify the TypeScript compiler reports no new errors (`npm run lint`) before continuing.

## Context

Read these files before writing any code:

- [src/types.ts](../../src/types.ts) — shared types; needs `ComicSource` addition
- [src/lib/db.ts](../../src/lib/db.ts) — localforage wrappers; `Comic[]` storage
- [src/lib/parser.ts](../../src/lib/parser.ts) — `ComicParser` class; reuse as-is
- [src/components/Library.tsx](../../src/components/Library.tsx) — upload flow (`processFile()`); Google Drive import plugs in here
- [src/App.tsx](../../src/App.tsx) — root component; no changes expected
- [package.json](../../package.json) — current dependencies

## Requirements

### Authentication
- OAuth 2.0 **Authorization Code + PKCE** flow — no backend, no client secret exposed.
- Use the **Google Identity Services** library (`@react-oauth/google` or the raw GIS script tag). Prefer the npm package to keep bundling clean.
- Scopes needed: `https://www.googleapis.com/auth/drive.readonly` (read-only is sufficient).
- Store the **access token** in component state only — never in `localStorage` (tokens expire; persisting them creates stale-credential bugs).
- The **Google OAuth Client ID** must come from an environment variable: `VITE_GOOGLE_CLIENT_ID`. Document in `README.md` that the user must create `.env.local` with this value.
- On sign-out or token expiry, clear state and show the "Connect Google Drive" button again.

### Drive File Picker
- After auth, call the **Google Drive REST API v3** (not the Picker JS SDK — the REST API is more controllable and works without an additional API key).
- Flow:
  1. Search for a folder named exactly `panelpass` owned by the user: `q=name='panelpass' and mimeType='application/vnd.google-apps.folder' and trashed=false`.
  2. If no such folder exists, show an inline message: _"No `panelpass` folder found in your Google Drive. Create a folder named `panelpass` and add your comic files there."_
  3. If found, list its direct children filtered to `.cbz` and `.cbr` files: `q='<folderId>' in parents and trashed=false and (name contains '.cbz' or name contains '.cbr')`.
  4. Display results as a scrollable file list inside a modal/sheet: filename, file size (formatted), and an **Import** button per file.
  5. Support multi-select with a **Import Selected** bulk action.

### Import Pipeline
- Importing a Drive file means:
  1. Download the file blob via `https://www.googleapis.com/drive/v3/files/<id>?alt=media` with the Bearer token.
  2. Construct a `File` object from the blob (preserving the filename).
  3. Pass that `File` directly into the **existing** `processFile()` function in `Library.tsx` — do not duplicate parsing logic.
- Show per-file import progress (spinner while downloading + parsing).
- If a file with the same Drive file ID has already been imported, show a "Already imported" badge and disable the Import button.

### Type Changes — `src/types.ts`
Add a `ComicSource` type and extend `Comic`:

```ts
export type ComicSource =
  | { type: 'local' }
  | { type: 'google-drive'; driveFileId: string; driveName: string };

export interface Comic {
  // ... existing fields unchanged ...
  source: ComicSource; // NEW — default { type: 'local' } for existing/new local comics
}
```

All places that construct a `Comic` object must be updated to include `source`.

### New file — `src/lib/googleDrive.ts`
Encapsulate all Drive API calls here. Export:

```ts
export async function findPanelpassFolder(token: string): Promise<string | null>
export async function listComicsInFolder(token: string, folderId: string): Promise<DriveFile[]>
export async function downloadDriveFile(token: string, fileId: string): Promise<Blob>

export interface DriveFile {
  id: string;
  name: string;
  size: number; // bytes
}
```

Use `fetch` directly — no third-party Drive SDK needed.

### New component — `src/components/GoogleDrivePicker.tsx`
Renders the Drive connection UI and file list modal. Props:

```ts
interface GoogleDrivePickerProps {
  onImport: (file: File) => Promise<void>; // wraps processFile
  importedDriveIds: Set<string>;           // to show "already imported"
}
```

### Integration into `Library.tsx`
- Add a **"Connect Google Drive"** button next to the existing upload button.
- When clicked, trigger OAuth if not yet authenticated, then open `<GoogleDrivePicker>`.
- Pass `processFile` as `onImport`. Build `importedDriveIds` from `comics.filter(c => c.source.type === 'google-drive').map(c => c.source.driveFileId)`.

### AGENTS.md note
The `AGENTS.md` mentions migrating `generateId()` to `crypto.randomUUID()` when Google Drive is added. Make that change in `src/lib/utils.ts` as part of this implementation.

## Step-by-Step Plan

1. **Install dependencies** — add `@react-oauth/google` (or equivalent GIS npm package). Run `npm install`.
2. **Update `src/types.ts`** — add `ComicSource`, update `Comic`.
3. **Update all `Comic` constructors** — add `source: { type: 'local' }` to every place a `Comic` is built (search for `generateId()` usages in `Library.tsx`).
4. **Migrate `generateId()`** — replace `Math.random().toString(36)` with `crypto.randomUUID()` in `src/lib/utils.ts`.
5. **Create `src/lib/googleDrive.ts`** — implement the three exported functions.
6. **Create `src/components/GoogleDrivePicker.tsx`** — modal UI with auth button, file list, and import actions.
7. **Update `Library.tsx`** — wire in the Connect button and `GoogleDrivePicker`.
8. **Update `README.md`** — document `VITE_GOOGLE_CLIENT_ID` env var setup.
9. **Run `npm run lint`** — fix all TypeScript errors before declaring done.

## Constraints

- No backend. No service worker. No server-side token exchange.
- Do **not** use the Google Picker JS SDK (requires an additional API key and a separate `<script>` tag).
- Do **not** store tokens in `localStorage` or `sessionStorage`.
- Do **not** duplicate `processFile()` — always call the existing function.
- Follow existing code conventions: one `import` statement per source module, `cn()` for conditional Tailwind classes, Tailwind CSS v4 (`@theme {}` tokens in `index.css`, no `tailwind.config.*`).
- Keep `package.json` `.version` and the footer string in `Library.tsx` in sync if you bump the version.
- CBR files from Drive still cannot be parsed by `ComicParser` (JSZip cannot open RAR). Import them anyway — they will fail at parse time with the same error a locally-uploaded `.cbr` would show. Do not add a RAR parser.
