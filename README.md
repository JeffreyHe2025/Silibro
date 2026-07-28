# Verilog Coder

A small web app: sign in with email/password and keep your Verilog projects in
the cloud. Every time you sign in, your saved projects are waiting for you.
Built as a static site (HTML/CSS/JS) with [Ace](https://ace.c9.io/) for the
editor and [Supabase](https://supabase.com/) for auth + database.

## Files

| File                  | Purpose                                            |
| --------------------- | -------------------------------------------------- |
| `index.html`          | Page markup (auth view + app view)                 |
| `styles.css`          | Styling                                            |
| `app.js`              | Auth, project CRUD, editor, Run/Compile            |
| `config.js`           | **Your** Supabase URL + anon key (you fill in)     |
| `supabase-schema.sql` | One-time database setup (you run in Supabase)      |

## One-time setup (~5 minutes)

### 1. Create a Supabase project
1. Go to <https://supabase.com> and sign up (free).
2. Click **New project**, give it a name and a database password, pick a
   region, and wait ~1 minute for it to provision.

### 2. Create the database tables
1. In your project, open **SQL Editor** → **New query**.
2. Open `supabase-schema.sql` from this folder, copy all of it, paste it in,
   and click **Run**. This creates the `projects` table and the Row Level
   Security rules that keep each user's projects private.
3. Run **`supabase-files-migration.sql`** the same way. This adds the `files`
   table so each project can hold multiple files. (Safe to re-run.)

### 3. Plug in your keys
1. In Supabase, go to **Project Settings → API**.
2. Copy the **Project URL** and the **anon public** key.
3. Open `config.js` and paste them in:
   ```js
   window.SUPABASE_CONFIG = {
     url: "https://abcdefgh.supabase.co",
     anonKey: "eyJhbGciOi...",
   };
   ```
   The anon key is meant to be public — your data is protected by the Row Level
   Security policies, not by hiding the key.

### 4. (For quick testing) turn off email confirmation
By default Supabase emails a confirmation link on sign-up. To test instantly
without it:
- **Authentication → Providers → Email** → turn **Confirm email** off.

Leave it **on** for a real/public deployment so people verify their address.

## Run it locally

Because the app loads libraries from a CDN and talks to Supabase, just open the
file or serve it locally:

```bash
# simplest
open index.html

# or a local server (http://localhost:8000)
python3 -m http.server 8000
```

Then: **Sign up** → **+ New** to create a project → edit → **Save**
(or ⌘/Ctrl+S). Sign out and back in — your projects are still there. Open it
in another browser or device and sign in to see them sync.

## Deploy it (optional)

It's a static site, so any static host works — Netlify, Vercel, GitHub Pages,
or Supabase Storage. Drag-and-drop the folder, or connect a Git repo. Remember
to add `config.js` (or set the values) on whatever host you use.

## Notes / limitations

- **Run / Compile** does a lightweight *static check* (balanced
  `module`/`endmodule`, `begin`/`end`, parentheses) — it is **not** a real
  Verilog compiler or simulator. Real synthesis/simulation needs a backend like
  Icarus Verilog (`iverilog`) or a WASM build of one. The `checkVerilog()` /
  `runCode()` functions in `app.js` are the single place to swap that in.
- `config.js` contains only the public anon key, so it's safe to commit. Never
  put the Supabase **service_role** key in client-side code.
