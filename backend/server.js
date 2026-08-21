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
const express = require("express");
const cors = require("cors");
const { buildDesign, refixFromReview, generateProjectTestbench, repairProjectTestbench } = require("./build");
const { compileVerilog, compileReport, runTestbench, synthesizeProject } = require("./compile");
const { startFlow, resumeFlow, resolveDecision, requestStop, isStopped } = require("./flow");
const { runWithUsage, callLLM } = require("./llm");
const {
  billingReady, authUser, assertCredits, chargeUsage,
  billingRouter, billingWebhook,
} = require("./billing");

const app = express();
app.use(cors()); // allow the browser frontend to call this

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

async function withBilling(req, provider, kind, fn) {
  if (provider !== "bedrock") return { result: await fn(), balance: null };
  // Harness bypass: our own automated benchmark runs Bedrock on our AWS account
  // with no user session and no credit charge (the InvokeModel cost lands directly
  // on the AWS bill). Gated by a server-only secret; absent/blank env => disabled.
  const ht = process.env.HARNESS_ADMIN_TOKEN;
  if (ht && safeEqual(req.headers["x-harness-token"], ht)) {
    return { result: await fn(), balance: null };
  }
  if (!billingReady()) { const e = new Error("billing not configured"); e.status = 500; throw e; }
  const userId = await authUser(req);
  await assertCredits(userId);
  const { result, usage } = await runWithUsage(fn);
  const micros = await chargeUsage(userId, kind, usage);
  return { result, balance: micros / 1e6 };
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
    const { result, balance } = await withBilling(req, "bedrock", "chat", () =>
      callLLM({ provider: "bedrock", model, system, messages })
    );
    res.json({ reply: result, balance });
  } catch (e) {
    res.status(e.status || 500).json({ error: String((e && e.message) || e) });
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
    const { result: out, balance } = await withBilling(req, provider, "build", async () => {
      const log = [];
      const built = await buildDesign({ provider, key, model }, spec, (ev) => {
        log.push(ev);
        console.log("[build]", JSON.stringify(ev));
      });
      return { ...built, log };
    });
    res.json({ ...out, balance });
  } catch (e) {
    res.status(e.status || 500).json({ error: String((e && e.message) || e) });
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
  res.setHeader("Content-Type", "application/x-ndjson");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  const send = (obj) => { res.write(JSON.stringify(obj) + "\n"); };
  try {
    const builder = { provider, key, model: builderModel || model };
    const verifier = { provider, key, model: verifierModel || builderModel || model };
    const { result, balance } = await withBilling(req, provider, "refix", () =>
      refixFromReview(builder, verifier, spec, manifest, review || "", (ev) => send({ type: "progress", event: ev }))
    );
    send({ done: true, ...result, balance });
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
    const { result: out, balance } = await withBilling(req, provider, "flow", () =>
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
    res.json({ threadId, ...out, balance });
  } catch (e) {
    res.status(e.status || 500).json({ error: String((e && e.message) || e) });
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
    const { result: out, balance } = await withBilling(req, provider, "flow", () =>
      buildDesign(builder, spec, (ev) => send({ type: "progress", event: ev }), verifier, null, control)
    );
    send({ threadId: tid, done: true, ...out, balance });
  } catch (e) {
    send({ error: String((e && e.message) || e) });
  }
  res.end();
});

app.post("/flow/approve", async (req, res) => {
  const { threadId, approved, changes, provider } = req.body || {};
  if (!threadId) return res.status(400).json({ error: "threadId required" });

  res.setHeader("Content-Type", "application/x-ndjson");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("X-Accel-Buffering", "no"); // disable proxy buffering if present
  res.flushHeaders();
  const send = (obj) => { res.write(JSON.stringify(obj) + "\n"); };
  res.on("close", () => requestStop(threadId)); // client hit Stop / navigated away

  try {
    // The Builder (the token-heavy phase) runs here, so meter/charge here too.
    // The frontend forwards its JWT + provider so Bedrock runs get billed. Out of
    // credits surfaces as an { error } stream line (headers are already sent).
    const { result: out, balance } = await withBilling(req, provider || "byok", "flow", () =>
      resumeFlow(
        threadId,
        { approved: !!approved, changes: changes || "" },
        (ev) => send({ type: "progress", event: ev }) // live build events
      )
    );
    send({ threadId, ...out, balance }); // final line: {done, files, log} or {done:false, spec}
  } catch (e) {
    send({ error: String((e && e.message) || e) });
  }
  res.end();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Verilog build backend listening on :" + PORT));
