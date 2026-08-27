// HTTP backend for the bottom-up Verilog builder.
//
//   POST /build   { spec, provider, key, model }
//     -> plans modules, builds bottom-up, iverilog-checks each one,
//        returns the built files + a per-module log.
//   POST /compile { files: [{name, code}], top? }
//     -> just compile-check a set of files (handy for the frontend loop).
//   GET  /health

// Load secrets from backend/.env if present (AWS / Supabase / Stripe keys).
try { require("dotenv").config({ path: require("path").join(__dirname, ".env") }); } catch (e) { /* dotenv optional */ }

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const express = require("express");
const cors = require("cors");
const { buildDesign, refixFromReview, generateProjectTestbench, repairProjectTestbench } = require("./build");
const { compileVerilog, compileReport, runTestbench, synthesizeProject } = require("./compile");
const { startFlow, resumeFlow, resolveDecision, requestStop, isStopped } = require("./flow");
const { runWithUsage, callLLM } = require("./llm");
const {
  billingReady, authUser, authUserOptional, authAdmin, assertCredits, chargeUsage, getStatus,
  anonStatus, assertCreditsAnon, chargeUsageAnon,
  freeTierOpen, freeTierSpendMicros,
  billingRouter, billingWebhook,
} = require("./billing");

const app = express();
// Reflect the caller's Origin and allow credentials so the anonymous free-tier
// cookie can round-trip cross-site (frontend and backend are different hosts).
// Restrict to ALLOWED_ORIGINS (comma-separated) if set; else reflect any origin.
const ALLOW = (process.env.ALLOWED_ORIGINS || "").split(",").map((x) => x.trim()).filter(Boolean);
app.use(cors({ origin: ALLOW.length ? ALLOW : true, credentials: true }));

// Stripe webhook needs the RAW body for signature verification, so it must be
// registered BEFORE express.json() parses everything else.
app.post("/billing/webhook", ...billingWebhook);

app.use(express.json({ limit: "4mb" }));

// JSON billing routes (account balance, usage history, checkout).
app.use("/billing", billingRouter);

// Run a handler that makes Bedrock calls, but only for a signed-in user with a
// positive credit balance; meter the token usage and debit the balance after.
// For any non-bedrock provider this is a passthrough (BYOK, no metering).
//   returns { result, balance }  (balance in dollars, or null when not metered)
// Constant-time compare so the harness-token check isn't timing-attackable.
function safeEqual(a, b) {
  a = String(a || ""); b = String(b || "");
  if (!a || !b || a.length !== b.length) return false;
  try { return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b)); } catch (e) { return false; }
}

// ---- Anonymous free-tier cookie (signed httpOnly, per-browser; no IP) --------
const ANON_COOKIE = "vc_anon";
const ANON_SECRET = process.env.ANON_COOKIE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
function anonEnabled() { return billingReady() && ANON_SECRET && process.env.ANON_FREE_TIER !== "off"; }
function signAnon(id) { return crypto.createHmac("sha256", ANON_SECRET).update(id).digest("hex").slice(0, 32); }
function parseCookies(req) {
  const out = {}; const h = req.headers.cookie || "";
  h.split(";").forEach((p) => { const i = p.indexOf("="); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return out;
}
// Read the anon id from the cookie, but only if OUR signature validates.
function readAnonId(req) {
  const c = parseCookies(req)[ANON_COOKIE]; if (!c) return null;
  const dot = c.lastIndexOf("."); if (dot < 0) return null;
  const id = c.slice(0, dot), sig = c.slice(dot + 1);
  if (!ANON_SECRET || signAnon(id) !== sig) return null;
  return id;
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Return the browser's anon id. Sources, in order of trust:
//   1. our signed httpOnly cookie (first-party contexts / cookie-allowed browsers)
//   2. the client's localStorage id via the X-Anon-Id header (works even where
//      third-party cookies are blocked, e.g. Safari — the frontend and backend are
//      different sites, so the cookie is third-party there)
//   3. mint a fresh one.
// Also (best-effort) sets the cookie so cookie-allowed browsers get the stronger
// httpOnly identifier. MUST run before res.flushHeaders() so Set-Cookie can go out.
function ensureAnonId(req, res) {
  const hdr = req.headers["x-anon-id"];
  const headerId = UUID_RE.test(String(hdr || "")) ? String(hdr) : null;
  let id = readAnonId(req) || headerId;
  if (!id) id = crypto.randomUUID();
  if (!res.headersSent && !readAnonId(req)) {
    res.cookie(ANON_COOKIE, id + "." + signAnon(id), {
      httpOnly: true, secure: true, sameSite: "none",
      maxAge: 365 * 24 * 3600 * 1000, path: "/",
    });
  }
  return id;
}

// Enforce the personal monthly cap AND the sitewide $500/month soft cap. The
// sitewide cap only turns AWAY users who have NOT started using free tokens this
// month (tokens_used == 0); anyone already mid-quota keeps going. Resets monthly.
async function gateFreeTier(st, isAnon) {
  const remaining = Number((st && st.tokens_remaining) || 0);
  const used = Number((st && st.tokens_used) || 0);
  if (remaining <= 0) {
    const e = new Error(isAnon
      ? "You've used the free credit on this device this month."
      : "You've used your free monthly credit.");
    e.status = 402; e.code = "quota_exhausted"; throw e;
  }
  if (used <= 0 && !(await freeTierOpen())) {
    const e = new Error("This month's free tier is fully used across all users. Please try again next month \u2014 or connect your own API key to keep going now.");
    e.status = 402; e.code = "site_closed"; throw e;
  }
}

// Decide who pays for a Bedrock call BEFORE any work/streaming, and gate it.
// Returns a bill context: { mode: "byok"|"harness"|"user"|"anon", userId?, anonId? }.
// For streaming endpoints, call this BEFORE res.flushHeaders() so the anon cookie
// and any 402/401 error can be sent as a normal response.
async function prepareBilling(req, res, provider) {
  if (provider !== "bedrock") return { mode: "byok" };
  const ht = process.env.HARNESS_ADMIN_TOKEN;
  if (ht && safeEqual(req.headers["x-harness-token"], ht)) return { mode: "harness" };
  if (!billingReady()) { const e = new Error("billing not configured"); e.status = 500; throw e; }
  const userId = await authUserOptional(req);
  if (userId) {
    const st = await getStatus(userId);
    await gateFreeTier(st, false);
    return { mode: "user", userId: userId };
  }
  if (anonEnabled()) {
    const anonId = ensureAnonId(req, res);
    const st = await anonStatus(anonId);
    await gateFreeTier(st, true);
    return { mode: "anon", anonId: anonId };
  }
  const e = new Error("sign in required"); e.status = 401; throw e;
}

// Run the metered work and settle the charge for a prepared bill context.
// Returns { result, balance, anonTokensRemaining? }.
async function runBilled(bill, kind, fn) {
  if (bill.mode === "byok" || bill.mode === "harness") return { result: await fn(), balance: null };
  const { result, usage } = await runWithUsage(fn);
  if (bill.mode === "user") {
    const micros = await chargeUsage(bill.userId, kind, usage);
    return { result, balance: micros / 1e6 };
  }
  const remaining = await chargeUsageAnon(bill.anonId, kind, usage); // anon
  return { result, balance: null, anonTokensRemaining: remaining };
}

// Convenience for NON-streaming handlers: prepare (gate + cookie) then run.
async function withBilling(req, res, provider, kind, fn) {
  const bill = await prepareBilling(req, res, provider);
  return runBilled(bill, kind, fn);
}

// Which commit is this server running? Compare to the latest on GitHub to know
// if a git pull + pm2 restart is needed. Read once at startup.
let RUNNING_COMMIT = "unknown";
try {
  RUNNING_COMMIT = require("child_process")
    .execSync("git rev-parse --short HEAD", { cwd: __dirname, timeout: 3000 })
    .toString().trim();
} catch (e) { /* not a git checkout */ }
app.get("/version", (_req, res) => res.json({ commit: RUNNING_COMMIT }));

app.get("/health", (_req, res) => res.json({ ok: true }));

// ---- Monthly leaderboard results (written by the Pluto harness) --------------
// The harness POSTs its aggregated results here (authed with the harness token or
// a Bearer LEADERBOARD_POST_TOKEN); the public /leaderboard page GETs them.
const LEADERBOARD_FILE = path.join(__dirname, "leaderboard-results.json");
function leaderboardAuthed(req) {
  const ht = process.env.HARNESS_ADMIN_TOKEN;
  if (ht && safeEqual(req.headers["x-harness-token"], ht)) return true;
  const lt = process.env.LEADERBOARD_POST_TOKEN;
  const bearer = String(req.headers["authorization"] || "").replace(/^Bearer\s+/i, "");
  if (lt && safeEqual(bearer, lt)) return true;
  return false;
}
app.post("/leaderboard/results", (req, res) => {
  if (!leaderboardAuthed(req)) return res.status(401).json({ error: "unauthorized" });
  const data = req.body;
  if (!data || typeof data !== "object" || !Array.isArray(data.models)) {
    return res.status(400).json({ error: "expected a results object with a models[] array" });
  }
  try { fs.writeFileSync(LEADERBOARD_FILE, JSON.stringify(data)); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: String((e && e.message) || e) }); }
});
app.get("/leaderboard/results", (_req, res) => {
  try {
    if (!fs.existsSync(LEADERBOARD_FILE)) return res.json({ models: [], empty: true });
    res.type("application/json").send(fs.readFileSync(LEADERBOARD_FILE, "utf8"));
  } catch (e) { res.status(500).json({ error: String((e && e.message) || e) }); }
});

// ---- Developer BYOK keys for the monthly harness ----------------------------
// The developer imports provider API keys on the /admin page (gated to admin
// emails); the harness reads them (token-auth) and runs those models monthly in
// addition to Bedrock. Stored server-side only, never returned to a browser.
const DEV_KEYS_FILE = path.join(__dirname, "dev-keys.json");
const DEV_KEY_NAMES = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GOOGLE_API_KEY", "DEEPSEEK_API_KEY"];
function readDevKeys() { try { return JSON.parse(fs.readFileSync(DEV_KEYS_FILE, "utf8")); } catch (e) { return {}; } }
function writeDevKeys(o) { fs.writeFileSync(DEV_KEYS_FILE, JSON.stringify(o)); }
function maskKeys(store) {
  const out = {};
  DEV_KEY_NAMES.forEach(function (k) {
    const v = store[k];
    out[k] = v ? ("set (" + v.slice(0, 4) + "…" + v.slice(-2) + ")") : "unset";
  });
  return out;
}
// Developer saves/updates keys (empty string clears one).
app.post("/admin/keys", async (req, res) => {
  try { await authAdmin(req); } catch (e) { return res.status(e.status || 500).json({ error: String((e && e.message) || e) }); }
  const body = req.body || {};
  const store = readDevKeys();
  DEV_KEY_NAMES.forEach(function (k) {
    if (typeof body[k] === "string") { const v = body[k].trim(); if (v) store[k] = v; else delete store[k]; }
  });
  try { writeDevKeys(store); } catch (e) { return res.status(500).json({ error: String((e && e.message) || e) }); }
  res.json({ ok: true, status: maskKeys(store) });
});
// Masked status for the admin page (never the raw values).
app.get("/admin/keys/status", async (req, res) => {
  try { await authAdmin(req); } catch (e) { return res.status(e.status || 500).json({ error: String((e && e.message) || e) }); }
  res.json({ status: maskKeys(readDevKeys()), names: DEV_KEY_NAMES });
});
// Raw keys for the harness only (harness token / Bearer). Never for the browser.
app.get("/admin/keys", (req, res) => {
  if (!leaderboardAuthed(req)) return res.status(401).json({ error: "unauthorized" });
  res.json(readDevKeys());
});

// ---- Which BYOK models the benchmark tests (managed on /admin) ---------------
const BENCH_MODELS_FILE = path.join(__dirname, "benchmark-models.json");
const BENCH_PROVIDERS = ["anthropic", "openai", "google"]; // BYOK providers with model lists
const BENCH_DEFAULTS = {
  anthropic: ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"],
  openai: ["gpt-5", "gpt-5-mini"],
  google: ["gemini-3.1-pro-preview", "gemini-3.1-flash-lite"],
};
function readBenchModels() {
  let stored = {};
  try { stored = JSON.parse(fs.readFileSync(BENCH_MODELS_FILE, "utf8")); } catch (e) { stored = {}; }
  const out = {};
  BENCH_PROVIDERS.forEach(function (p) {
    out[p] = Array.isArray(stored[p]) ? stored[p] : BENCH_DEFAULTS[p].slice();
  });
  return out;
}
function writeBenchModels(o) { fs.writeFileSync(BENCH_MODELS_FILE, JSON.stringify(o)); }

// Read the model lists — admin (browser) OR the harness (token).
app.get("/admin/models", async (req, res) => {
  const okToken = leaderboardAuthed(req);
  if (!okToken) { try { await authAdmin(req); } catch (e) { return res.status(e.status || 500).json({ error: String((e && e.message) || e) }); } }
  res.json({ providers: BENCH_PROVIDERS, models: readBenchModels() });
});
// Save the model lists (admin only).
app.post("/admin/models", async (req, res) => {
  try { await authAdmin(req); } catch (e) { return res.status(e.status || 500).json({ error: String((e && e.message) || e) }); }
  const body = (req.body && req.body.models) || {};
  const store = readBenchModels();
  BENCH_PROVIDERS.forEach(function (p) {
    if (Array.isArray(body[p])) {
      store[p] = body[p].map(function (x) { return String(x || "").trim(); }).filter(Boolean).slice(0, 40);
    }
  });
  try { writeBenchModels(store); } catch (e) { return res.status(500).json({ error: String((e && e.message) || e) }); }
  res.json({ ok: true, models: store });
});
// Quick availability check: does this model still respond with the stored key?
app.post("/admin/check-model", async (req, res) => {
  try { await authAdmin(req); } catch (e) { return res.status(e.status || 500).json({ error: String((e && e.message) || e) }); }
  const provider = String((req.body && req.body.provider) || "");
  const model = String((req.body && req.body.model) || "").trim();
  if (BENCH_PROVIDERS.indexOf(provider) < 0 || !model) return res.status(400).json({ error: "provider and model required" });
  const envMap = { anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY", google: "GOOGLE_API_KEY" };
  const key = readDevKeys()[envMap[provider]];
  if (!key) return res.json({ available: null, detail: "set the " + provider + " key first to check" });
  try {
    await callLLM({ provider: provider, key: key, model: model, messages: [{ role: "user", content: "hi" }] });
    res.json({ available: true, detail: "responded OK" });
  } catch (e) {
    const msg = String((e && e.message) || e);
    const retired = /not found|does not exist|end of life|decommission|deprecat|invalid model|unknown model|model_not_found|no such model/i.test(msg);
    res.json({ available: false, detail: retired ? "unavailable / retired" : msg.slice(0, 180) });
  }
});

// Compile-check arbitrary files (used by the frontend's loop / testbenches).
app.post("/compile", async (req, res) => {
  const { files, top } = req.body || {};
  if (!Array.isArray(files) || !files.length) {
    return res.status(400).json({ error: "files: [{name, code}] required" });
  }
  try {
    const result = await compileVerilog(files, top);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
});

// Per-file compile report: compiles each file on its own so one broken file
// can't mask the rest. Returns { combined, perFile:[{name, ok, kind, output}] }.
app.post("/compile/report", async (req, res) => {
  const { files } = req.body || {};
  if (!Array.isArray(files) || !files.length) {
    return res.status(400).json({ error: "files: [{name, code}] required" });
  }
  try {
    res.json(await compileReport(files));
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
});

// Whole-project testbench: the Verifier writes a self-checking testbench for the
// top module against the spec, then we run it. Returns { name, code, passed, output }.
app.post("/testbench", async (req, res) => {
  const { files, spec, provider, key, model } = req.body || {};
  if (!Array.isArray(files) || !files.length || !provider || !key || !model) {
    return res.status(400).json({ error: "files, provider, key, model are required" });
  }
  try {
    const vfiles = files.filter((f) => f && /\.s?v$/i.test(f.name));
    if (!vfiles.length) return res.json({ error: "no Verilog files in the project" });
    let tb = await generateProjectTestbench({ provider, key, model }, spec || "", vfiles);
    if (!tb || !tb.code) return res.json({ error: "could not generate a testbench" });

    // Run it against the whole design. If the TESTBENCH won't compile, repair the
    // testbench (feed the iverilog error back) and retry — up to a few times —
    // before reporting. The design modules aren't touched.
    const maxTbTries = 3;
    let sim = null;
    for (let tbTry = 1; tbTry <= maxTbTries; tbTry++) {
      const simFiles = vfiles.slice();
      simFiles.push({ name: tb.name, code: tb.code });
      sim = await runTestbench(simFiles, tb.top);
      if (!sim.compileFailed) break;
      if (tbTry < maxTbTries) {
        const repaired = await repairProjectTestbench({ provider, key, model }, spec || "", vfiles, tb.code, sim.output);
        if (repaired && repaired.code) { tb = repaired; continue; }
      }
      break; // couldn't repair, or out of tries — report the compile error below
    }
    if (sim && sim.compileFailed) {
      return res.json({ name: tb.name, code: tb.code, passed: null, output: "testbench won't compile: " + sim.output.slice(0, 400) });
    }
    const markers = ((sim.output.match(/PROJECT_[A-Z]+[^\n]*/g) || []).join("; ") || sim.output.slice(0, 300)).slice(0, 600);
    const passed = /PROJECT_PASS/.test(sim.output) && !/PROJECT_FAIL/.test(sim.output)
      ? true
      : /PROJECT_FAIL/.test(sim.output) ? false : null;
    res.json({ name: tb.name, code: tb.code, passed: passed, output: markers });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
});

// Run an EXISTING (e.g. imported) testbench against the design with the simulator.
// Compiles the project + testbench and runs vvp, returning the RAW simulation
// output plus a best-effort pass/fail read from common markers. Unlike /testbench,
// this does NOT generate a testbench — it runs the one already in the files.
// Runs ONLY the file(s) provided (the frontend sends just the current file), with
// no cross-project top-module detection — iverilog auto-picks the file's root.
//   body: { files:[{name,code}] }
//   -> { passed:true|false|null, compileFailed, output }
app.post("/testbench/run", async (req, res) => {
  const { files } = req.body || {};
  if (!Array.isArray(files) || !files.length) {
    return res.status(400).json({ error: "files: [{name, code}] required" });
  }
  try {
    const vfiles = files.filter((f) => f && /\.s?v$/i.test(f.name));
    if (!vfiles.length) return res.json({ error: "no Verilog files provided" });

    const sim = await runTestbench(vfiles); // no tbTop → iverilog auto-picks the root
    if (sim.compileFailed) {
      return res.json({ passed: null, compileFailed: true, output: (sim.output || "").slice(0, 8000) });
    }
    // Best-effort verdict from common markers (user testbenches vary); FAIL wins
    // over PASS. When nothing clear is printed, leave it null and show raw output.
    const out = sim.output || "";
    let passed = null;
    if (/\b(FAIL(ED)?|MISMATCH|ASSERTION\s+FAILED)\b/i.test(out) || /\berrors?\s*=\s*[1-9]/i.test(out)) passed = false;
    else if (/\b(PASS(ED)?|SUCCESS|ALL\s+TESTS?\s+PASSED)\b/i.test(out) || /\berrors?\s*=\s*0\b/i.test(out)) passed = true;
    // Return the full log (bounded generously) — a 200-result scoreboard needs
    // far more than the old 4 KB, which cut off mid-line around line ~67. If it
    // STILL exceeds the cap, flag it so the UI can say "truncated" rather than
    // looking frozen.
    const CAP = 500000;
    res.json({ passed, compileFailed: false, output: out.slice(0, CAP), truncated: out.length > CAP, fullBytes: out.length });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
});

// FINAL WHOLE-PROJECT SYNTHESIS with yosys — run this after the LLMs have
// finished building and verifying. Runs the full `synth` flow on the assembled
// design (testbenches excluded automatically) and returns the gate-level netlist
// plus area/cell statistics. No LLM involved, so no API key is needed.
//   body: { files:[{name,code}], top? }
//   -> { ok, top, stats, longestPath, netlist, warnings, errors, output }
app.post("/synthesize", async (req, res) => {
  const { files, top } = req.body || {};
  if (!Array.isArray(files) || !files.length) {
    return res.status(400).json({ error: "files: [{name, code}] required" });
  }
  try {
    res.json(await synthesizeProject(files, { top }));
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
});

// Guest (anonymous) free-tier status. Ensures the anon cookie exists and returns
// the browser's remaining free tokens, so the frontend can show a guest badge.
app.get("/billing/anon-account", async (req, res) => {
  if (!anonEnabled()) return res.json({ enabled: false });
  try {
    const anonId = ensureAnonId(req, res);
    const st = await anonStatus(anonId);
    res.json({
      enabled: true,
      tokens_remaining: Number(st.tokens_remaining || 0),
      monthly_token_cap: Number(st.monthly_token_cap || 0),
      tokens_used: Number(st.tokens_used || 0),
      siteOpen: await freeTierOpen(), // false once the month's $500 pool is spent
    });
  } catch (e) { res.status(500).json({ error: String((e && e.message) || e) }); }
});

// Single chat turn through Bedrock (server creds), metered against credits.
// The browser sends its Supabase JWT (Authorization: Bearer …) instead of a key.
//   body: { model, system?, messages:[{role,content,images?}] }
//   -> { reply, balance }   (402 when out of credits)
app.post("/bedrock/chat", async (req, res) => {
  const { model, system, messages } = req.body || {};
  if (!model || !Array.isArray(messages)) {
    return res.status(400).json({ error: "model and messages[] are required" });
  }
  try {
    const { result, balance, anonTokensRemaining } = await withBilling(req, res, "bedrock", "chat", () =>
      callLLM({ provider: "bedrock", model, system, messages })
    );
    res.json({ reply: result, balance, anonTokensRemaining });
  } catch (e) {
    res.status(e.status || 500).json({ error: String((e && e.message) || e), code: e && e.code });
  }
});

// Full bottom-up build from a spec/prompt.
app.post("/build", async (req, res) => {
  const { spec, provider, key, model } = req.body || {};
  // Bedrock uses the server's creds (no BYOK key); everyone else must send one.
  if (!spec || !provider || !model || (provider !== "bedrock" && !key)) {
    return res.status(400).json({ error: "spec, provider, model (and key for BYOK) are required" });
  }
  try {
    const { result: out, balance, anonTokensRemaining } = await withBilling(req, res, provider, "build", async () => {
      const log = [];
      const built = await buildDesign({ provider, key, model }, spec, (ev) => {
        log.push(ev);
        console.log("[build]", JSON.stringify(ev));
      });
      return { ...built, log };
    });
    res.json({ ...out, balance, anonTokensRemaining });
  } catch (e) {
    res.status(e.status || 500).json({ error: String((e && e.message) || e), code: e && e.code });
  }
});

// User-triggered RE-FIX from the final review: rewrite the modules the review
// flagged as mismatched, then re-verify (complexity + functional testbench).
// Streams NDJSON progress like /flow/approve, then a final { done, files, manifest,
// review, passed, fixed } line. Metered for the Bedrock provider.
//   body: { spec, manifest:[...], review, provider, key?, verifierModel?, builderModel?, model? }
app.post("/refix", async (req, res) => {
  const { spec, manifest, review, provider, key, verifierModel, builderModel, model } = req.body || {};
  if (!spec || !Array.isArray(manifest) || !manifest.length || !provider || (provider !== "bedrock" && !key)) {
    return res.status(400).json({ error: "spec, manifest[], provider (and key for BYOK) are required" });
  }
  // Gate + set the anon cookie BEFORE streaming so a 401/402 returns as JSON.
  let bill;
  try { bill = await prepareBilling(req, res, provider); }
  catch (e) { return res.status(e.status || 500).json({ error: String((e && e.message) || e), code: e && e.code }); }
  res.setHeader("Content-Type", "application/x-ndjson");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  const send = (obj) => { res.write(JSON.stringify(obj) + "\n"); };
  try {
    const builder = { provider, key, model: builderModel || model };
    const verifier = { provider, key, model: verifierModel || builderModel || model };
    const { result, balance, anonTokensRemaining } = await runBilled(bill, "refix", () =>
      refixFromReview(builder, verifier, spec, manifest, review || "", (ev) => send({ type: "progress", event: ev }))
    );
    send({ done: true, ...result, balance, anonTokensRemaining });
  } catch (e) {
    send({ error: String((e && e.message) || e) });
  }
  res.end();
});

// --- Two-agent flow (Verifier -> approval -> Builder) via LangGraph ---------

// Start: Verifier writes the spec, then the run pauses for the user's approval.
// Returns { threadId, done:false, spec }.
app.post("/flow/start", async (req, res) => {
  const { prompt, images, provider, key, verifierModel, builderModel } = req.body || {};
  if (!prompt || !provider || !(verifierModel || builderModel) || (provider !== "bedrock" && !key)) {
    return res.status(400).json({ error: "prompt, provider, a model (and key for BYOK) are required" });
  }
  try {
    const threadId = crypto.randomUUID();
    const { result: out, balance, anonTokensRemaining } = await withBilling(req, res, provider, "flow", () =>
      startFlow(
        {
          prompt: prompt,
          images: images,
          provider: provider,
          key: key,
          verifierModel: verifierModel || builderModel,
          builderModel: builderModel || verifierModel,
        },
        threadId
      )
    );
    res.json({ threadId, ...out, balance, anonTokensRemaining });
  } catch (e) {
    res.status(e.status || 500).json({ error: String((e && e.message) || e), code: e && e.code });
  }
});

// Approve/reject the spec. Streams newline-delimited JSON (NDJSON): each build
// event (plan / building / attempt / built) is written as its own line as it
// happens, then a final line carries the result:
//   { approved:true }            -> ...events..., { done:true, files, log }
//   { approved:false, changes }  -> { done:false, spec }   (no build events)
// The frontend reads the stream and logs each event live.
// Resolve a mid-build "budget decision" the build is waiting on (see the
// budgetDecision event). choice: "continue" | "buildOnly" | "raiseCutoff".
app.post("/flow/decision", (req, res) => {
  const { threadId, choice } = req.body || {};
  if (!threadId || !choice) return res.status(400).json({ error: "threadId and choice required" });
  const ok = resolveDecision(threadId, choice);
  res.json({ ok });
});

// Stop an in-progress build. The build checks this between modules and returns
// its partial result. (The client hitting Stop / disconnecting also triggers it.)
app.post("/flow/stop", (req, res) => {
  const { threadId } = req.body || {};
  if (!threadId) return res.status(400).json({ error: "threadId required" });
  requestStop(threadId);
  res.json({ ok: true });
});

// Resume/continue a build from the current project files (no spec re-approval).
// Runs the build seeded with the files already built, skipping done modules and
// building the rest. Streams NDJSON like /flow/approve.
//   body: { spec, files:[{name,code}], provider, key?, verifierModel?, builderModel?, model?, threadId? }
app.post("/flow/continue", async (req, res) => {
  const { spec, files, provider, key, verifierModel, builderModel, model, threadId } = req.body || {};
  if (!spec || !provider || (provider !== "bedrock" && !key)) {
    return res.status(400).json({ error: "spec, provider (and key for BYOK) are required" });
  }
  const tid = threadId || crypto.randomUUID();
  let bill;
  try { bill = await prepareBilling(req, res, provider); }
  catch (e) { return res.status(e.status || 500).json({ error: String((e && e.message) || e), code: e && e.code }); }
  res.setHeader("Content-Type", "application/x-ndjson");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  const send = (obj) => { res.write(JSON.stringify(obj) + "\n"); };
  res.on("close", () => requestStop(tid));
  send({ threadId: tid }); // let the client target this build with /flow/stop
  try {
    const builder = { provider, key, model: builderModel || model };
    const verifier = { provider, key, model: verifierModel || builderModel || model };
    const seedFiles = (files || []).filter((f) => f && /\.s?v$/i.test(f.name));
    const control = { seedFiles, shouldStop: () => isStopped(tid) };
    const { result: out, balance, anonTokensRemaining } = await runBilled(bill, "flow", () =>
      buildDesign(builder, spec, (ev) => send({ type: "progress", event: ev }), verifier, null, control)
    );
    send({ threadId: tid, done: true, ...out, balance, anonTokensRemaining });
  } catch (e) {
    send({ error: String((e && e.message) || e) });
  }
  res.end();
});

app.post("/flow/approve", async (req, res) => {
  const { threadId, approved, changes, provider } = req.body || {};
  if (!threadId) return res.status(400).json({ error: "threadId required" });

  // Gate + set the anon cookie BEFORE streaming so a 401/402 returns as JSON.
  let bill;
  try { bill = await prepareBilling(req, res, provider || "byok"); }
  catch (e) { return res.status(e.status || 500).json({ error: String((e && e.message) || e), code: e && e.code }); }
  res.setHeader("Content-Type", "application/x-ndjson");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("X-Accel-Buffering", "no"); // disable proxy buffering if present
  res.flushHeaders();
  const send = (obj) => { res.write(JSON.stringify(obj) + "\n"); };
  res.on("close", () => requestStop(threadId)); // client hit Stop / navigated away

  try {
    // The Builder (the token-heavy phase) runs here, so meter/charge here too.
    const { result: out, balance, anonTokensRemaining } = await runBilled(bill, "flow", () =>
      resumeFlow(
        threadId,
        { approved: !!approved, changes: changes || "" },
        (ev) => send({ type: "progress", event: ev }) // live build events
      )
    );
    send({ threadId, ...out, balance, anonTokensRemaining }); // final: {done, files, log} or {done:false, spec}
  } catch (e) {
    send({ error: String((e && e.message) || e) });
  }
  res.end();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Verilog build backend listening on :" + PORT));
