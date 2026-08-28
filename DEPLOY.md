# Verilog Coder — Edit & Redeploy Guide (fresh machine, your own accounts)

This guide takes a new maintainer from **just the code files** to a **fully running
deployment on their own cloud accounts**. You do **not** get the original owner's
Supabase project, AWS account, or domain — you create your own. Nothing here needs
any secret from the previous owner.

The app has three independently-deployed pieces:

| Piece | What it is | Hosted on |
| --- | --- | --- |
| **Frontend** | static site: `index.html`, `app.js`, `styles.css`, `config.js`, and the `models/`, `leaderboard/`, `admin/`, `confirmed/`, `reset/` folders | AWS Amplify (or any static host) |
| **Backend** | Node/Express API in `backend/` (build pipeline, Bedrock, billing, leaderboard, admin) | one Linux server (EC2) with a public HTTPS URL |
| **Database + Auth** | Postgres tables + email/password auth | Supabase |

Plus an optional **`harness/`** (monthly model benchmark) that runs on the backend server via cron.

---

## 0. Tools to install on your machine

- **Node.js 18+** and npm — <https://nodejs.org>
- **git**
- An editor (VS Code, etc.)
- (For the backend server) SSH access to a Linux box; the server also needs
  `iverilog`, `yosys`, and `verilator` installed (see step 3).

Clone/copy the code, then:
```bash
cd Verilog_coder_website
```

---

## 1. Create your own Supabase project (auth + database)

1. Sign up at <https://supabase.com> → **New project** (free tier is fine). Pick a
   region and set a database password. Wait ~1 min to provision.
2. **SQL Editor → New query** and run these files **in this order** (paste each
   file's contents, Run, repeat). All are idempotent (safe to re-run):

   **Core app tables**
   1. `supabase-schema.sql`            — `projects` table + RLS
   2. `supabase-files-migration.sql`   — `files` table + RLS
   3. `supabase-conversations-migration.sql` — `conversations` table + RLS

   **Billing / free tier** (needed only if you use Amazon Bedrock)
   4. `backend/billing-schema.sql`     — `billing_accounts`, `usage_events`, credit funcs
   5. `backend/billing-freetier.sql`   — converts the free tier to a monthly **token** allowance
   6. `backend/free-credits.sql`       — converts it to a **dollar** allowance ($0.85/user) + signup trigger
   7. `backend/anon-freetier.sql`      — anonymous (no-account) free tier tables/funcs
   8. `backend/sitewide-cap.sql`       — sitewide monthly spend function
   9. `backend/sync-balances.sql`      — (optional, currently unused) reconcile signed-in vs guest pools

3. **Authentication → URL Configuration**
   - **Site URL** = your frontend URL (after step 4 you'll know it, e.g.
     `https://main.xxxx.amplifyapp.com`). *Must not be `localhost`* or email links break.
   - **Redirect URLs** (allow-list) — add:
     `https://YOUR-FRONTEND/confirmed/` and `https://YOUR-FRONTEND/reset/`
4. **Authentication → Providers → Email** — turn **Confirm email** ON (recommended).
5. **Authentication → SMTP** — the built-in email sender is rate-limited to a few
   messages/hour. For real use, enable **Custom SMTP** (Resend or AWS SES) so
   confirmation + password-reset emails actually send.
6. **Project Settings → API** — copy the **Project URL** and the **anon/publishable**
   key (the anon key is safe to expose; RLS protects the data).

### Wire the frontend to your Supabase
Edit **`config.js`** with your values:
```js
window.SUPABASE_CONFIG = {
  url: "https://YOUR-PROJECT.supabase.co",
  anonKey: "YOUR-ANON-OR-PUBLISHABLE-KEY",
};
```

---

## 2. Deploy the frontend (AWS Amplify)

The frontend is plain static files assembled by **`amplify.yml`** (it copies
`index.html app.js styles.css config.js` plus the `models/ leaderboard/ admin/
confirmed/ reset/` folders into `dist/`). **Any new top-level page must be added to
the `cp` line in `amplify.yml`, or Amplify won't serve it.**

1. Push the code to a GitHub repo you own.
2. AWS Console → **Amplify → New app → Host web app** → connect that repo/branch.
3. Amplify auto-detects `amplify.yml`. Deploy. You get a URL like
   `https://main.xxxx.amplifyapp.com`.
4. Put that URL into Supabase **Site URL** + **Redirect URLs** (step 1.3).

> Alternative host: any static host works (S3+CloudFront, Netlify, GitHub Pages).
> Just serve the same files; folders must resolve at `/models/`, `/admin/`, etc.

**Cache-busting:** `index.html` references `app.js?v=NN` and `styles.css?v=NN`.
When you change those files, bump the `?v=` number so browsers fetch the new copy.

---

## 3. Deploy the backend (EC2 / any Linux server)

The backend needs a **public HTTPS URL** (the frontend calls it, and Supabase auth
requires https for cookies). Simplest: an EC2 instance + a free DuckDNS hostname +
Caddy/Nginx for TLS, or an Amplify/other reverse proxy.

### 3a. Provision the box
- Launch a small Linux instance (e.g. Ubuntu on EC2).
- Install runtime + EDA tools:
  ```bash
  sudo apt-get update
  sudo apt-get install -y nodejs npm iverilog yosys verilator git
  sudo npm i -g pm2            # process manager
  ```
- Give it a stable public hostname with HTTPS. One easy path:
  - Register a free subdomain at <https://duckdns.org>, point it at the instance IP.
  - Install **Caddy** (auto-TLS) reverse-proxying `:443 → :3000`.

### 3b. AWS Bedrock access (only if using the Bedrock provider)
- The backend calls Bedrock with **the server's AWS credentials**. Best practice:
  attach an **IAM role** to the EC2 instance with `bedrock:InvokeModel` +
  `bedrock:InvokeModelWithResponseStream` (Resource `*` is simplest; scope later).
- In the **Bedrock console (your region) → Model access**, request access to the
  models you'll use (Llama, DeepSeek, etc.). Cross-region models use `us.` inference
  profile IDs.

### 3c. Configure and start
```bash
cd backend
npm install
cp ENV_TEMPLATE.txt .env      # then fill .env — see the file's comments
PORT=3000 pm2 start "node -e 'require(\"./server\")'" --name server
pm2 save
```

**`backend/.env` keys** (all server-side secrets; never commit):
- `AWS_REGION` (+ `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` if not using an IAM role)
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (service_role — bypasses RLS, backend only)
- `HARNESS_ADMIN_TOKEN` — random secret (`openssl rand -hex 32`); shared with the harness
- `ANON_COOKIE_SECRET` — random secret (falls back to the service key)
- `ADMIN_EMAILS` — comma-separated emails allowed on `/admin`
- `FREE_TIER_MONTHLY_CAP_USD` — sitewide free-tier ceiling (default 250)
- `ALLOWED_ORIGINS` — your frontend origin (tightens CORS; blank = reflect any)
- Stripe keys only if you enable paid credit top-ups.

### 3d. Point the frontend at your backend
The backend URL is **hard-coded** in the frontend. Update it in **`app.js`**:
```js
function getBackendUrl() { return "https://YOUR-BACKEND-HOST"; }
```
Also update the `BACKEND` constant near the top of `admin/index.html`,
`leaderboard/index.html`, and `reset/index.html`/`confirmed/index.html` if present.
Bump `app.js?v=` and redeploy the frontend.

### 3e. Verify
```bash
curl https://YOUR-BACKEND-HOST/health     # {"ok":true}
curl https://YOUR-BACKEND-HOST/version    # {"commit":"..."} = the running git commit
```

---

## 4. The everyday edit → redeploy loop

**Frontend change** (`index.html`, `app.js`, `styles.css`, or any page folder):
```bash
# edit files...
# if you changed app.js/styles.css, bump the ?v=NN in index.html
git add -A && git commit -m "..." && git push        # Amplify auto-rebuilds
```
Confirm live: hard-refresh; check the deployed `app.js?v=NN` matches.

**Backend change** (`backend/*.js`):
```bash
git add -A && git commit -m "..." && git push
# then on the server:
cd backend && git pull && npm install && pm2 restart server --update-env
curl https://YOUR-BACKEND-HOST/version   # confirm the new commit is running
```
> `git pull` alone does **not** change what's running — you must `pm2 restart`.
> `/version` reports the *running* commit; if it lags the repo, you skipped the restart.

**Database change** (`.sql`): run the file in the Supabase SQL editor. All migrations
are written to be idempotent.

---

## 5. Optional: the monthly benchmark (`harness/`)

Runs the model leaderboard on the 1st of each month. It lives in `harness/` and runs
**on the backend server** (needs `iverilog`).

```bash
cd harness
printf 'HARNESS_ADMIN_TOKEN=%s\n' 'SAME-TOKEN-AS-BACKEND-ENV' > .env
./setup-ec2.sh        # checks deps, clones the Pluto benchmark, installs the cron
./run-monthly.sh      # run once now to test
```
It reads the model list + run size from the backend's `/admin` page, runs the agentic
pipeline on random problems, and POSTs results to `/leaderboard/results` (shown at
`/leaderboard/`). See `harness/README.md`.

---

## 6. Handover / security checklist

- **Never commit secrets.** `.env`, `dev-keys.json`, `*-results.json` are gitignored;
  `ENV_TEMPLATE.txt` holds placeholders only.
- The **anon/publishable** Supabase key in `config.js` is safe client-side (RLS).
  The **service_role** key is backend-only.
- Rotate `HARNESS_ADMIN_TOKEN` and `ANON_COOKIE_SECRET` if they ever leak.
- All user data lives in **your** Supabase; all model cost lands on **your** AWS bill.

---

## File map

```
index.html, app.js, styles.css, config.js   frontend app (Ace editor, auth, chat, build UI)
models/  leaderboard/  admin/                extra static pages (served at /models/ etc.)
confirmed/  reset/                           email-confirm + password-reset landing pages
amplify.yml                                  static build (which files/folders get published)
supabase-*.sql                               core app tables (projects, files, conversations)
backend/                                     Node/Express API (see backend section of SPECS.md)
  server.js  build.js  flow.js  compile.js   API + agentic build pipeline + EDA tool runners
  llm.js  bedrock.js  billing.js  smoketb.js providers, Bedrock, billing, smoke tests
  *.sql                                      billing / free-tier / leaderboard DB objects
  ENV_TEMPLATE.txt                           backend .env template
harness/                                     monthly benchmark (cron on the backend server)
```
