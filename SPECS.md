# Verilog Coder — Full Build Specification

This document specifies the entire application precisely enough for another engineer
or LLM to **recreate it from scratch**. It is behavior + contract level, not a
line-by-line copy. Where a rule matters for correctness it is called out explicitly.

---

## 1. Product summary

A web app that turns a natural-language hardware request into **verified Verilog**,
through a two-agent (Verifier → Builder) pipeline, and hosts a monthly **model
leaderboard**. Users can bring their own LLM API key (BYOK) or use **Amazon Bedrock**
paid by the site owner with a free-credit allowance (signed-in and anonymous).

Three deployable pieces:
1. **Frontend** — static site (vanilla ES5-style JS, no framework), Ace editor.
2. **Backend** — Node 18 + Express (CommonJS). Runs the agentic build pipeline,
   local EDA tools (iverilog/yosys/verilator), Bedrock, billing, leaderboard, admin.
3. **Database + Auth** — Supabase (Postgres + email/password auth + RLS).
Plus a **harness** (monthly benchmark, Node, no framework) run by cron on the backend.

---

## 2. Frontend

### 2.1 Files & pages
- `index.html` — single page with two top-level views: **auth-view** (signed out) and
  **app-view** (signed in), plus a right-hand **chat panel** ("LLM Connection").
  Loads Supabase JS + Ace + JSZip + Mermaid from CDN, then `config.js`, then
  `app.js?v=NN` (cache-buster bumped on every JS/CSS change).
- `styles.css` — all styling (light theme, `.hidden` utility).
- `config.js` — `window.SUPABASE_CONFIG = { url, anonKey }` (non-secret).
- Standalone pages, each a self-contained folder with its own inline CSS, served at a
  trailing-slash path (Amplify strips `.html`, so use `folder/index.html`):
  - `models/` — free-tier Bedrock model list; Llama ranked by cost, DeepSeek by
    cost/token; prices in a JS `MODELS` array; "Best value" badge on cheapest.
  - `leaderboard/` — fetches `GET <backend>/leaderboard/results`; renders a **Top-3
    Overall** podium (balance score = accuracy 0.6 + speed 0.4, speed normalized as
    fastest/this), plus separate **By Accuracy** and **By Speed** tables. Shows only
    models actually tested (accuracyPct != null). Provider badge inferred from name.
  - `admin/` — developer-only key/model manager (see 2.6).
  - `confirmed/` — email-confirmation landing ("Email confirmed — sign in"). Reads the
    URL hash for `error` to show an expired-link message.
  - `reset/` — password-reset landing: set a new password twice (with eye toggles) via
    the Supabase recovery session (`sb.auth.updateUser({password})`).

### 2.2 Auth (Supabase email/password)
- `sb = supabase.createClient(cfg.url, cfg.anonKey)`.
- Modes: **signin** / **signup** toggled by a link. `setAuthMode(mode)`:
  - signup shows a **Confirm password** field and hides "Forgot password?"; signin
    shows "Forgot password?" and hides confirm.
  - Every time the form is shown, both password fields reset to `type="password"`
    ("show password" default OFF).
- Password fields each have an inline **👁 eye** button toggling only their own field.
- **Sign up**: require password ≥ 6 chars and both fields equal, else inline error.
  `sb.auth.signUp({ email, password, options: { emailRedirectTo: origin + "/confirmed/" } })`.
  If no session returned (email confirmation on) → switch to signin mode, THEN show a
  green success panel "confirmation link sent to <email>, check inbox/spam" (order
  matters: `setAuthMode` clears the message, so set it after).
- **Sign in**: `signInWithPassword`. On "email not confirmed" error, show a friendly
  "confirm your email first" message.
- **Forgot password**: link (signin mode only) → `sb.auth.resetPasswordForEmail(email,
  { redirectTo: origin + "/reset/" })` → neutral "if an account exists…" confirmation.
- **Guest**: "Continue without signing in" enters the app signed-out.
- `onAuthStateChange` swaps views; on sign-in it loads projects/conversations and,
  for admin emails, reveals the 🔐 Admin topbar link (via `/admin/keys/status` == 200).

### 2.3 Projects, files, editor
- Supabase tables `projects`, `files`, `conversations` (RLS: owner-only). Frontend
  CRUD via the Supabase JS client (anon key + user JWT; RLS enforces isolation).
- Left sidebar: project list → file list. Ace editor in the center. A file can be
  marked the **spec** (`.md`). Editor edits sync to the in-memory file and save to DB.
- Toolbar: Save, Run simulation, Synthesize project, and a "More" menu (Diagram,
  Use as spec, Sync current code, GitHub push, Export/zip via JSZip).

### 2.4 Chat panel / LLM connection
- Header icons: expand, **☰ history**, **✎ new chat**, **🔑 settings**, **✕ close**.
  History + New are always visible (even with no key) so past chats are viewable;
  only *sending* needs a key.
- **Providers** (`PROVIDER_INFO`): `bedrock` (default; no key — uses account/anon free
  credit), `anthropic`, `openai`, `google`, `openrouter`. Each has a model list; Bedrock
  lists the non-Claude free-tier models (Llama/DeepSeek/Nova/Pixtral) with friendly
  labels. `getProviderModel/setProviderModel` persist per provider in localStorage.
- **Connect**: for BYOK, save+test the key (stored in `sessionStorage`, cleared on
  browser close; survives reload). For Bedrock, "connected" == selected (no key);
  `getProviderKey("bedrock")` returns a sentinel `"account"` so `if(!key)` gates pass.
- **Context management**: the plain-chat path sends the full `chatHistory`. Before each
  send, `maybeSummarizeContext()`: if the transcript exceeds ~8k tokens (32k chars,
  ≥4 msgs), summarize it (preserving module names/ports/widths/reset style/decisions)
  and start a **fresh session** seeded with that summary. The build path prepends a
  bounded `buildContextPreamble()` (carried-over summary + last ~5 user requests) so
  follow-ups ("make it 16-bit") are context-aware.
- **History**: conversations persist to Supabase per user. `loadConversations(autoOpen)`
  only auto-opens the last chat on initial sign-in restore (`autoOpen=true`); clicking
  ☰ must NOT auto-open (otherwise it boots into a chat).

### 2.5 Build flow (frontend side)
- Sending a prompt runs the **Verifier → approval → Builder** flow via the backend
  `/flow/*` NDJSON-streaming endpoints (see 3.3). A lightweight LLM "is this a hardware
  build request?" router decides build-vs-chat; off-topic chat is politely declined.
- **Follow-up edits** (`runEditFlow`): if the current project already has a design (a
  `spec.md`/session spec **and** ≥1 Verilog module), a new prompt is treated as an EDIT
  — it skips `/flow/start` + the approval popup and calls **`/flow/continue` with
  `editRequest`**. The backend updates the spec and rebuilds/re-testbenches **only the
  affected modules** (see 3.3). The returned updated spec is saved back to `spec.md`.
  A fresh/empty project falls through to the full Verifier→approval→Builder flow.
- All Bedrock-capable fetches send `credentials: "include"` + `X-Anon-Id` (see 2.7)
  and the user's JWT via `Authorization` when signed in.

### 2.6 Admin page (`/admin/`)
- Gated: only emails in the backend's `ADMIN_EMAILS` (checked via signed-in JWT).
- Import BYOK keys (Anthropic/OpenAI/Google) — stored backend-side, shown only masked.
- Choose which models the **monthly benchmark** runs, per provider. BYOK providers
  (anthropic/openai/google) have a key + model list; **Bedrock providers (deepseek,
  llama)** have model lists with **no key** (run on the owner's AWS). Each model row
  has a **Check** button → `/admin/check-model` reports available vs retired.
- **Run size**: problems-per-run and attempts-per-problem (`/admin/run-settings`).

### 2.7 Anonymous free tier identity
- A per-browser id in `localStorage` (`vc_anon_id`, a UUID) sent as **`X-Anon-Id`** on
  Bedrock calls. This is the durable identity (works where 3rd-party cookies are
  blocked). The backend also sets a signed httpOnly cookie where allowed. Signing in/out
  does not change it.

---

## 3. Backend (Node/Express, `backend/`)

CommonJS. Deps: `express`, `cors`, `dotenv`, `@supabase/supabase-js`, `stripe`,
`@aws-sdk/client-bedrock-runtime`, `@langchain/langgraph`, `@langchain/core`.
Entry: `server.js` (`PORT` env, default 3000). CORS reflects origin + `credentials:true`
(restrict to `ALLOWED_ORIGINS` if set). Reads `backend/.env` via dotenv.

### 3.1 Endpoints
Utility: `GET /health` → `{ok:true}`; `GET /version` → `{commit}` (running git short SHA).

Compile/sim (local EDA tools, isolated temp dirs per call):
- `POST /compile` {files,top} → iverilog compile check.
- `POST /compile/report` → per-file compile results.
- `POST /testbench`, `POST /testbench/run` → generate/run a testbench.
- `POST /synthesize` {files,top} → yosys synthesis stats/netlist.

LLM one-shot:
- `POST /bedrock/chat` {model,system,messages} → Bedrock via server creds, metered.

Agentic build (all NDJSON-streaming except `/flow/start`):
- `POST /flow/start` {prompt,provider,key,verifierModel,builderModel} → runs the
  Verifier, pauses at approval (LangGraph `interrupt`), returns `{threadId, spec}` or
  `{offTopic, redirect}`.
- `POST /flow/approve` {threadId,approved,changes,provider} → resumes; streams build
  events; final line `{done,files,log,manifest,review,...}`.
- `POST /flow/continue` {spec,files,...,editRequest?} → resume a stopped build (seed
  files, skip done modules), OR — when `editRequest` is present — a **follow-up edit**:
  `planEdit` (Verifier) merges the request into the spec and returns the minimal set of
  **changed/new modules**; `buildDesign` runs with `control.forceRebuild = changed` so
  those seeded modules are rebuilt + re-verified while all others are skipped (not
  re-testbenched). Streams an `editPlan` event and returns the updated `spec`.
- `POST /flow/stop` {threadId} → cooperative cancel. `POST /flow/decision` {threadId,
  choice} → resolve a mid-build budget decision (continue|buildOnly|raiseCutoff).
- `POST /refix` {spec,manifest,review,...} → rewrite review-flagged modules, re-verify.

Billing:
- `GET /billing/account` (JWT) → signed-in token/credit status.
- `GET /billing/anon-account` (X-Anon-Id) → guest status + `siteOpen`.
- `GET/POST /billing/usage`, `POST /billing/checkout` (Stripe), `POST /billing/webhook`
  (Stripe raw-body signature-verified — mounted BEFORE express.json()).

Leaderboard + admin (auth: `X-Harness-Token` OR Bearer `LEADERBOARD_POST_TOKEN` for
the harness; `authAdmin` (JWT + ADMIN_EMAILS) for the browser):
- `POST /leaderboard/results` (token) stores results to a file; `GET` returns them.
- `GET/POST /admin/keys`, `GET /admin/keys/status`, `GET/POST /admin/models`,
  `POST /admin/check-model`, `GET/POST /admin/run-settings`.

### 3.2 Providers (`llm.js`, `bedrock.js`)
- `callLLM({provider,key,model,system,messages,temperature})` supports `anthropic`
  (api.anthropic.com/v1/messages), `openai` (chat/completions), `openrouter`,
  `google`/`gemini` (generativelanguage v1beta), and `bedrock` (via `bedrock.js`
  Converse API using AWS creds). Returns assistant text.
- `runWithUsage(fn)` meters token usage via AsyncLocalStorage so billing can charge
  after a call. `bedrock.js` has a `PRICING` table ($/1M in/out per model),
  `costMicros` (with markup) and `rawCostMicros` (real AWS cost, no markup).

### 3.3 Agentic pipeline (`flow.js` + `build.js`)
LangGraph state machine (`flow.js`): nodes **verifier → approval → builder →
verifierReview**. `verifier` writes the spec; if the request is not hardware it sets
`offTopic`+`redirect` and routes to END. `approval` uses `interrupt({spec})` so the
frontend can approve/edit. `builder` runs `buildDesign`; `verifierReview` a final pass.
`startFlow`/`resumeFlow` drive it with a `MemorySaver` per `threadId`.

`buildDesign(llm, spec, onProgress, verifierLLM, decide, control)` (`build.js`):
1. `planGraph` → module list (name, purpose, dependsOn) from the spec.
2. `topoSort` + **`topoLevels`**: group modules into dependency levels; modules in a
   level are independent and are built **concurrently** (`mapLimit`, cap 4). Compiles
   use isolated temp dirs so concurrency is safe. Single-module design = one level.
3. Per module: `genInterfaceContract` (Verifier extracts ports/params from spec) →
   `buildHeader` (deterministic header; **must drop ports/params without a valid
   identifier and sanitize defaults**, else a malformed contract yields
   `parameter undefined = …`). `buildModule` writes the body (retries on compile fail).
4. **Deterministic reset fix**: if spec wants a synchronous reset but code has an async
   one, `stripAsyncReset` (no LLM). Reset type is derived from CODE (`detectResetType`),
   overriding any wrong LLM summary — avoids phantom conformance violations.
5. `summarizeModule` (structured description, not code) → `checkConformance` (Verifier
   judges ports/behavior/reset vs spec; ignores module *name*) → `fixModuleConformance`
   loop if violated. The Verifier writes explicit how-to fix instructions.
6. Verification tiers: structural (lint via iverilog, synth via yosys) + a code-gen
   **smoke** baseline on every module; **functional** tier adds an LLM oracle testbench
   with fault localization/repair (`localizeAndFix`) + Verilator line coverage
   (display-only). A per-build **fixBudget** bounds LLM correction calls; at thresholds
   it asks the user (continue|buildOnly|raiseCutoff).
7. `finalConformanceSweep` — one holistic review, loop fixes.
Returns `{files:{name:code}, results, summaries, manifest, dependencyGraph, review}`.
Builder temperature is low (steadier); Verifier keeps its own temperature.

### 3.4 EDA tools (`compile.js`, `smoketb.js`)
Every function writes files to a fresh `fs.mkdtempSync` dir and shells out:
`iverilog -g2012` + `vvp` (compile/sim), `yosys` (`read_verilog -sv`, lint/synth),
`verilator --binary --coverage --timing` (coverage). All parse tool output and clean up.

### 3.5 Billing & free tier
- **BYOK** calls: not metered (user pays their provider).
- **Bedrock** calls go through `prepareBilling(req,res,provider)` →
  - `X-Harness-Token` matches `HARNESS_ADMIN_TOKEN` → mode `harness` (no charge, no
    logging — the monthly benchmark; cost lands on AWS bill, invisible to the cap).
  - valid JWT → mode `user` (charge `billing_accounts`).
  - else anonymous → signed cookie or `X-Anon-Id` UUID → mode `anon` (charge
    `anon_accounts`). Missing/blank → 401.
  Then `runBilled` runs the work and, for user/anon, debits **raw** AWS cost (no markup)
  and logs to `usage_events`/`anon_usage_events`.
- **Dollar free tier**: each user/device gets a fixed monthly credit (default **$0.85**,
  spendable on any model), stored in `billing_accounts`/`anon_accounts` as micros in the
  `monthly_token_cap`/`period_used_tokens` columns (repurposed to hold dollars). A signup
  trigger grants it; **the trigger must be exception-safe so it can never roll back
  signup** ("Database error saving new user" comes from a throwing trigger).
- **Sitewide soft cap**: `free_tier_spend_micros()` sums this month's `usage_events`
  + `anon_usage_events`. When it exceeds `FREE_TIER_MONTHLY_CAP_USD` (default 250),
  `gateFreeTier` blocks **new** users (tokens_used==0) with a "try next month" message;
  users already mid-quota keep going. Resets monthly.
- Signed-in and anonymous pools are **independent** (current design). Streaming
  endpoints must call `prepareBilling` **before** `res.flushHeaders()` so the anon
  cookie / a 401/402 can be returned as a normal response.

### 3.6 Database objects (SQL files)
**The complete SQL contract — every table, column, RLS policy, function body, trigger,
run order, and the token→dollar migration — is specified in `SPECS-SQL.md`.** Write
the SQL from that document. Summary:
- App: `projects`, `files`, `conversations` (each RLS owner-only; shared
  `set_updated_at()` trigger).
- Billing: `billing_accounts`, `usage_events`, `credit_topups` (+ funcs `charge_user`,
  `add_credits`, `can_spend`, `usage_status`, `roll_period`, `grant_starting_credits`
  trigger). The free tier evolves token→dollar; `charge_user` is redefined across files
  (final version accumulates raw AWS micros and returns jsonb).
- Anon: `anon_accounts`, `anon_usage_events` (+ `charge_anon`, `can_spend_anon`,
  `usage_status_anon`, `roll_period_anon`). Sitewide: `free_tier_spend_micros`.
  RLS on, **no policies** → only the service_role (backend) can touch them.
- All migrations idempotent. The signup trigger **must be exception-safe** (a throwing
  trigger causes "Database error saving new user" and rolls back signup).

---

## 4. Harness (`harness/`, monthly benchmark)

Node, no deps beyond global `fetch`. Cron on the backend server (1st of month, 04:00).
- Reads model selection + run size from the backend `/admin/*` (token-auth), and BYOK
  keys from `/admin/keys`. Falls back to `config.json` if the backend is unreachable.
- Picks N random problems from a **Pluto** `medium` clone, runs each M times through the
  **agentic pipeline** (calls the backend `/flow/start` + auto-approve `/flow/approve`;
  Bedrock via harness-token bypass — no user, no charge).
- Scoring (`score.js`): the DUT must be named `opt_model`; **`forceHeader`** stitches
  Pluto's authoritative `header.v` onto only the LLM's **top** module (submodules kept
  verbatim), so name/ports always match the testbench. Compile `opt.v + unopt.v +
  testbench.v` with iverilog, run vvp, parse `Total mismatches: N out of M`.
- Aggregate: per-problem accuracy = passes/attempts; model accuracy = **average across
  problems**; speed = average latency over all runs. POST to `/leaderboard/results`.

**Modules** (`harness/src/`): `index.js` (orchestrator: load `/admin` config, pick
problems, loop models × problems × attempts, aggregate, POST), `agentic.js` (drive
`/flow/start` + auto-approve `/flow/approve`, sending `X-Harness-Token`), `llm.js`
(direct-mode provider caller, timed), `problems.js` (discover + random-pick Pluto
problems, load prompt/header/harness files), `extract.js` (`extractVerilog`,
`parseModules`, `forceHeader`), `score.js` (write files, iverilog+vvp, parse verdict),
`results.js` (aggregate + write + POST), `env.js` (load `.env`). `config.json` holds the
fallback model list + defaults; `run-monthly.sh` (cron entry: git-update Pluto, run) and
`setup-ec2.sh` (deps check, clone `github.com/scale-lab/Pluto`, install the cron).

---

## 5. Deployment & conventions (see DEPLOY.md for the full runbook)

- Frontend: static, assembled by `amplify.yml` (lists exactly which files/folders get
  published — new pages must be added there). Cache-bust via `?v=NN`.
- Backend: EC2 + pm2; `git pull && npm install && pm2 restart server --update-env`.
  `/version` reports the running commit; `git pull` alone doesn't change what runs.
- Backend URL is hard-coded in the frontend (`getBackendUrl()` + each page's `BACKEND`).
- Secrets only in `backend/.env` (gitignored); `ENV_TEMPLATE.txt` has placeholders.
  Anon/publishable Supabase key is safe client-side; service_role is backend-only.
- Style: frontend is framework-free `var`/`function` ES5-ish; backend CommonJS.

---

## 6. Complete file inventory (every tracked file → where it's specified)

To confirm nothing is missing, here is every file in the repo and how it's covered.
"Recreatable from spec" = an engineer/LLM can write it from this doc; "data asset" =
must be copied from the repo, cannot be regenerated; "meta" = not application logic.

| File / folder | Coverage |
| --- | --- |
| `index.html` | §2.1 (structure), §2.2–2.5 (element behaviors) |
| `app.js` | §2 (all frontend behavior) |
| `styles.css` | §2.1 (light theme, `.hidden`); exact CSS at author's discretion |
| `config.js` | §2.1 + DEPLOY §1 (`SUPABASE_CONFIG`) |
| `models/`, `leaderboard/`, `admin/`, `confirmed/`, `reset/` (each `index.html`) | §2.1 |
| `amplify.yml` | §5 + DEPLOY §2 (static build manifest) |
| `supabase-schema.sql`, `supabase-files-migration.sql`, `supabase-conversations-migration.sql` | **SPECS-SQL.md §1–3** |
| `backend/server.js` | §3.1 (endpoints), §3.5 (billing middleware) |
| `backend/llm.js`, `backend/bedrock.js` | §3.2 |
| `backend/flow.js`, `backend/build.js` | §3.3 |
| `backend/compile.js`, `backend/smoketb.js` | §3.4 |
| `backend/billing.js` | §3.5 |
| `backend/*.sql` (`billing-schema`, `billing-freetier`, `free-credits`, `anon-freetier`, `sitewide-cap`) | **SPECS-SQL.md §4–8** |
| `backend/free-tokens-setup.sql`, `backend/sync-balances.sql` | optional/unused — SPECS-SQL.md §9 note |
| `backend/package.json` / `package-lock.json` | deps listed in §3 header; run `npm install` |
| `backend/ENV_TEMPLATE.txt` | §3 + DEPLOY §3d (the `.env` keys) |
| `backend/lib/gscl45nm.lib` | **data asset** — Liberty standard-cell file for µm² synthesis. Optional (absent → GE estimate). Copy from repo; see `backend/lib/README.md`. |
| `harness/src/*.js`, `harness/config.json`, `harness/*.sh` | §4 (per-module) |
| `harness/package.json` | no dependencies (global `fetch`); §4 header |
| `README.md`, `backend/README.md`, `harness/README.md`, `backend/lib/README.md`, `DEPLOY.md`, `SPECS.md`, `SPECS-SQL.md` | **meta** (docs, not app logic) |
| `.gitignore`, `backend/.gitignore`, `harness/.gitignore` | **meta** — ignore `.env`, `node_modules/`, `*-results.json`, `dev-keys.json`, `benchmark-*.json`, `results/`, `run.log` |

**Runtime-generated files (never committed; created by the running app):**
`backend/.env`, `backend/dev-keys.json` (admin BYOK keys), `backend/benchmark-models.json`,
`backend/benchmark-run.json`, `backend/leaderboard-results.json`, `harness/.env`,
`harness/results/`. All are gitignored and created on first use.

**The only non-recreatable file is `backend/lib/gscl45nm.lib`** (a data asset, and
optional). Everything else is fully specified by SPECS.md + SPECS-SQL.md.
