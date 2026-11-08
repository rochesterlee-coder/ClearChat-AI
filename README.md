# ClearChat website starter

This is the first ClearChat milestone: a welcome page with two entry choices.

- **Proceed Without Email**: starts a browser-local session marker using `localStorage`. It is local to that browser/device and does not create cloud sync.
- **Proceed With Email**: sends a Supabase email sign-in/verification link once Supabase is configured.

## Run it locally

You can open `index.html` directly for the welcome screen and local-device flow. For a local web server, use VS Code Live Server or run:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000`.

## Enable real email verification

1. Create a project at https://supabase.com/.
2. In Supabase, open **Project Settings → API**.
3. Copy the **Project URL** and the **anon/public key**.
4. In `app.js`, replace:
   - `YOUR_SUPABASE_PROJECT_URL`
   - `YOUR_SUPABASE_ANON_KEY`
5. In Supabase, open **Authentication → URL Configuration**.
6. Set your Site URL to `https://clearchat.site`.
7. Add these Redirect URLs:
   - `https://clearchat.site/**`
   - `http://localhost:8000/**` (for local testing)
8. In **Authentication → Providers → Email**, make sure email sign-in is enabled and email confirmation is enabled.
9. Configure the email sender/SMTP settings in Supabase for reliable production delivery. The default provider may have sending limits.
10. Deploy the files in this folder to your website host and connect `clearchat.site` to that host.

The browser app uses only the Supabase **anon/public key**. Never paste a Supabase `service_role` key into `app.js` or any frontend file.

## Important current scope

This is a starter front end, not the full AI platform yet. It does not include AI models, mouse control, browser automation, or synced user profiles. Those can be added as separate milestones after the entry flow is working.

Before public launch, add a privacy policy, terms, abuse protections, and secure server-side authorization for any future AI or computer-control actions.
