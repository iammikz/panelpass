# PanelPass

PanelPass is a browser-based comic reader for `.cbz`, `.zip`, and `.cbr` files. It runs as a React/Vite single-page app, stores comics locally in IndexedDB by default, and can optionally import or store comics through a user-owned Google Drive folder.

The app has no backend, no server-side accounts, and no database service. Reading, parsing, progress tracking, and storage all happen in the browser.

## Features

- Import `.cbz`, `.zip`, and `.cbr` comic archives
- Drag-and-drop or file-picker local uploads
- Optional Google Drive picker for files in a `panelpass` Drive folder
- Optional Google Drive cloud storage mode that extracts pages to `panelpass/extracted/comics/<comic-title>/`
- Bookshelf grid with cover thumbnails, progress bars, completion indicators, delete controls, and reading stats
- Sort bookshelf by comic name or recently viewed
- Single-page reading mode
- Dual-page spread mode
- Webtoon mode with one-page, all-pages vertical, and all-pages horizontal layouts
- Light and dark reader themes
- Tap/click UI toggle, double-tap or double-click zoom, swipe navigation, keyboard navigation, and page jumping
- Reading progress saved locally, with optional Google Drive progress sync through `panelpass/config/lastViewed.csv`

## Storage Modes

### Local Storage

By default, PanelPass saves comic metadata and archive blobs in the browser through IndexedDB via `localforage`.

This mode works offline after import and does not upload your local files anywhere. Clearing browser site data can remove the saved library.

### Google Drive Import

The Google Drive picker scans a folder named exactly `panelpass` in the signed-in user's Drive and lists `.cbz` and `.cbr` files. Imported Drive files can be saved into the local browser library.

### Google Drive Cloud Storage

When Google Drive Cloud Storage is enabled in Settings, imported comics are extracted page-by-page and uploaded to:

```text
panelpass/extracted/comics/<comic-title>/
```

Each extracted comic folder contains individual page images and a `metadata.json` file. The bookshelf can then load that extracted library from Drive on another device after connecting the same Google account.

## Tech Stack

- React 19
- TypeScript
- Vite 6
- Tailwind CSS v4 through `@tailwindcss/vite`
- IndexedDB persistence through `localforage`
- CBZ/ZIP parsing through `jszip`
- CBR/RAR parsing through `node-unrar-js`
- Google OAuth through `@react-oauth/google`
- Icons from `lucide-react`

## Getting Started

### Prerequisites

- Node.js 20 or newer
- npm

### Install

```bash
npm install
```

### Run Locally

```bash
npm run dev
```

The Vite dev server runs on `http://localhost:3000` and listens on `0.0.0.0`.

## Google Drive Setup

Google Drive is optional. Local uploads work without any environment variables.

To enable Drive import and Drive cloud storage:

1. Create an OAuth client ID in Google Cloud.
2. Configure the local app URL as an authorized JavaScript origin.
3. Add the client ID to `.env.local`:

```bash
VITE_GOOGLE_CLIENT_ID=your-google-oauth-client-id
```

4. Create a folder named `panelpass` in Google Drive.
5. Add `.cbz` or `.cbr` files to that folder.

PanelPass requests Drive readonly and Drive file scopes so it can list/download comics from the `panelpass` folder and create/update its own extracted comic and progress files.

## Available Scripts

```bash
npm run dev      # start Vite on port 3000
npm run build    # create production build in dist/
npm run preview  # preview the production build
npm run lint     # run TypeScript with no emit
npm run clean    # remove dist/ and server.js
```

## Project Structure

```text
src/
  App.tsx                         # Top-level library, reader, and settings routing
  types.ts                        # Shared Comic, ComicSource, and reader types
  components/
    GoogleDrivePicker.tsx         # OAuth flow and Drive comic import modal
    HowToUse.tsx                  # First-run guide modal
    Library.tsx                   # Uploads, bookshelf, sorting, stats, deletion
    Reader.tsx                    # Comic reader modes, progress, gestures, themes
    Settings.tsx                  # Local vs. Drive storage settings
  lib/
    db.ts                         # IndexedDB/localforage metadata and file stores
    googleDrive.ts                # Drive API helpers and extracted-library sync
    parser.ts                     # CBZ/ZIP and CBR/RAR parser
    utils.ts                      # Class merging, ID generation, formatting
```

## Privacy Notes

PanelPass is designed to be local-first. In local storage mode, comic archives remain in the browser's IndexedDB on the current device.

Google Drive features only run after the user connects a Google account. In Drive cloud storage mode, imported comics are extracted and uploaded to the user's own Google Drive under the `panelpass` folder.

## License

See [LICENSE](LICENSE).
