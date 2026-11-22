# Netlify (watch party)

Watch YouTube together in lobbies with a 6 digit PIN.

## Setup

1. Go to supabase.com and create a free project.
2. Open **Project Settings -> API** and copy the **Project URL** and the **anon public** key.
3. Paste both into `config.js`.
4. Upload the whole folder to a GitHub repo, then turn on GitHub Pages (or import the repo into Vercel / Cloudflare Pages).

No database tables are needed. Everything runs on Supabase Realtime.

If joining never works, open **Realtime -> Settings** in Supabase and make sure public channel access is allowed.

## Test locally

The site must be opened through a web server, not by double clicking `index.html`:

```
python -m http.server 8000
```

Then open http://localhost:8000 in two browser tabs. Create a lobby in one tab and join with the PIN in the other.
