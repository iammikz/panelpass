# Run and deploy your app

This contains everything you need to run your app locally.

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Create `.env.local` in the project root with your Google OAuth client ID:
   `VITE_GOOGLE_CLIENT_ID=your-google-oauth-client-id`
3. Configure that OAuth client in Google Cloud with your local app URL as an authorized JavaScript origin and redirect URI.
4. Run the app:
   `npm run dev`

Google Drive import uses OAuth 2.0 with PKCE in the browser and looks for a Drive folder named `panelpass` containing `.cbz` or `.cbr` files.
