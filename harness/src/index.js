// Monthly leaderboard run:
//   1. pick N random problems from Pluto's medium set (same set for every model)
//   2. for each model × problem: prompt the model (timed), extract the Verilog,
//      score it with the problem's testbench via iverilog
//   3. aggregate accuracy + speed, write results.json (+ dated archive), optionally
//      POST to your site's leaderboard endpoint.
// Runs sequentially to stay friendly to provider rate limits.
const fs = require("fs");
const path = require("path");
const { loadEnv } = require("./env");
const { callModel } = require("./llm");
const { extractVerilog, forceHeader } = require("./extract");
const { runAgentic, mergeFiles, backendBase } = require("./agentic");
const { listProblems, pickRandom, loadProblem } = require("./problems");
const { scoreModule } = require("./score");
const { aggregate, writeResults, postResults } = require("./results");

function loadConfig() {
  const p = path.join(__dirname, "..", "config.json");
  return JSON.parse(fs.readFileSync(p, "utf8"));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Combine the natural-language spec with Pluto's required interface (header.v) so
// the model produces a module named `opt_model` with the exact ports the testbench
// instantiates. Without this the model invents its own name and the testbench
// won't compile (a false failure).
function buildUserPrompt(prob) {
  let u = prob.prompt;
  if (prob.header && prob.header.trim()) {
    u += "\n\nImplement the module with EXACTLY this name and port interface, completing the body:\n\n" +
      "```verilog\n" + prob.header.trim() + "\n```\n\n" +
      "Keep the module name and ports exactly as above and end with `endmodule`.";
  }
  return u;
}

// Pull the developer's BYOK keys from the backend admin store (set on the /admin
// page) and fill any that aren't already in the local env. Lets the monthly run
// use Claude/GPT/Gemini keys managed on the site instead of the harness .env.
async function loadDevKeys(cfg) {
  const tok = process.env.HARNESS_ADMIN_TOKEN;
  if (!tok) return;
  try {
    const r = await fetch(backendBase(cfg) + "/admin/keys", { headers: { "x-harness-token": tok } });
    if (!r.ok) return;
    const keys = await r.json();
    let n = 0;
    Object.keys(keys || {}).forEach((k) => { if (keys[k] && !process.env[k]) { process.env[k] = keys[k]; n++; } });
    if (n) console.log("Loaded " + n + " developer BYOK key(s) from the backend admin store.");
  } catch (e) { /* backend unreachable -> just use local env */ }
}

// Rebuild the BYOK model list from what the developer selected on /admin (falls
// back to the config's models if the backend is unreachable). Keeps Bedrock models.
async function loadBenchModels(cfg) {
  const tok = process.env.HARNESS_ADMIN_TOKEN;
  if (!tok) return;
  const map = {
    anthropic: { keyEnv: "ANTHROPIC_API_KEY", direct: "anthropic" },
    openai: { keyEnv: "OPENAI_API_KEY", direct: "openai-compatible", baseURL: "https://api.openai.com/v1" },
    google: { keyEnv: "GOOGLE_API_KEY", direct: "google" },
  };
  try {
    const r = await fetch(backendBase(cfg) + "/admin/models", { headers: { "x-harness-token": tok } });
    if (!r.ok) return;
    const lists = ((await r.json()) || {}).models || {};
    const models = [];
    Object.keys(map).forEach((p) => {
      (lists[p] || []).forEach((id) => {
        models.push({ name: id, provider: map[p].direct, model: id, baseURL: map[p].baseURL, keyEnv: map[p].keyEnv,
          flow: { provider: p, model: id, keyEnv: map[p].keyEnv } });
      });
    });
    ["deepseek", "llama"].forEach((p) => { // Bedrock — no key, runs on our AWS
      (lists[p] || []).forEach((id) => { models.push({ name: id, provider: "bedrock", model: id, flow: { provider: "bedrock", model: id } }); });
    });
    if (models.length) {
      const bedrockN = models.filter((m) => m.flow.provider === "bedrock").length;
      cfg.models = models;
      console.log("Model list from /admin: " + (models.length - bedrockN) + " BYOK + " + bedrockN + " Bedrock.");
    }
  } catch (e) { /* keep config models */ }
}

// Pull the run size (problems/attempts) the developer set on /admin.
async function loadRunSettings(cfg) {
  const tok = process.env.HARNESS_ADMIN_TOKEN;
  if (!tok) return;
  try {
    const r = await fetch(backendBase(cfg) + "/admin/run-settings", { headers: { "x-harness-token": tok } });
    if (!r.ok) return;
    const s = await r.json();
    if (s.problemsPerRun) cfg.problemsPerRun = s.problemsPerRun;
    if (s.attemptsPerProblem) cfg.attemptsPerProblem = s.attemptsPerProblem;
    console.log("Run size from /admin: " + cfg.problemsPerRun + " problems × " + cfg.attemptsPerProblem + " attempts.");
  } catch (e) { /* keep config values */ }
}

async function main() {
  loadEnv();
  const cfg = loadConfig();
  if (process.env.PLUTO_REPO) cfg.plutoRepo = process.env.PLUTO_REPO;
  await loadDevKeys(cfg);
  await loadBenchModels(cfg);
  await loadRunSettings(cfg);

  // Optional dry-run controls (env, no config edits):
  //   HARNESS_ONLY="Haiku"  -> only models whose name contains this (case-insensitive)
  //   HARNESS_LIMIT=1       -> override problemsPerRun (e.g. a single problem)
  const only = (process.env.HARNESS_ONLY || "").trim().toLowerCase();
  const limit = process.env.HARNESS_LIMIT ? parseInt(process.env.HARNESS_LIMIT, 10) : null;
  const mode = (process.env.HARNESS_MODE || cfg.mode || "direct").toLowerCase(); // "agentic" | "direct"
  const attempts = process.env.HARNESS_ATTEMPTS ? Math.max(1, parseInt(process.env.HARNESS_ATTEMPTS, 10)) : (cfg.attemptsPerProblem || 1);
  let models = cfg.models;
  if (only) {
    models = models.filter((m) => (m.name || "").toLowerCase().includes(only) || (m.model || "").toLowerCase().includes(only));
    if (!models.length) throw new Error('HARNESS_ONLY="' + process.env.HARNESS_ONLY + '" matched no model in config.json');
  }
  const n = limit && limit > 0 ? limit : (cfg.problemsPerRun || 5);

  const all = listProblems(cfg.plutoRepo, cfg.problemsSubdir);
  if (!all.length) throw new Error("No problems found under " + path.join(cfg.plutoRepo, cfg.problemsSubdir));
  const picked = pickRandom(all, n).map(loadProblem);
  console.log("Selected " + picked.length + " problem(s): " + picked.map((p) => p.name).join(", "));
  console.log("Mode: " + mode + (mode === "agentic" ? " (backend: " + (process.env.HARNESS_BACKEND_URL || cfg.backendUrl || "http://localhost:3000") + ", specs auto-approved)" : ""));
  console.log("Testing " + models.length + " model(s)" + (only ? ' (filter="' + process.env.HARNESS_ONLY + '")' : "") + ", " + attempts + " attempt(s)/problem.\n");

  const rows = [];
  for (const m of models) {
    console.log("=== " + m.name + " (" + m.provider + ":" + m.model + ") ===");
    for (const prob of picked) {
     for (let attempt = 1; attempt <= attempts; attempt++) {
      // --- get the candidate Verilog, either from the raw model or the pipeline ---
      let code = "", ms = 0, outputTokens = null, gerr = null, gskip = false, offTopic = false;
      if (mode === "agentic") {
        const r = await runAgentic(m, cfg.systemPrompt, buildUserPrompt(prob), cfg);
        ms = r.ms; gerr = r.error; gskip = r.skipped; offTopic = r.offTopic;
        if (!gskip && !gerr && !offTopic) code = mergeFiles(r.files);
      } else {
        const gen = await callModel(m, cfg.systemPrompt, buildUserPrompt(prob));
        ms = gen.ms; gerr = gen.error && !gen.skipped ? gen.error : null; gskip = gen.skipped; outputTokens = gen.outputTokens;
        if (!gskip && !gerr) code = extractVerilog(gen.text);
      }

      const tag = "  - " + prob.name + " [" + attempt + "/" + attempts + "]: ";
      if (gskip) { console.log(tag + "SKIP (" + gerr + ")"); rows.push({ model: m.name, problem: prob.name, attempt: attempt, skipped: true }); continue; }
      if (gerr) { console.log(tag + (mode === "agentic" ? "pipeline error — " : "API error — ") + gerr); rows.push({ model: m.name, problem: prob.name, attempt: attempt, pass: false, ms: ms, compiled: false, reason: (mode === "agentic" ? "pipeline error" : "api error"), error: gerr }); continue; }
      if (offTopic) { console.log(tag + "FAIL (guardrail rejected as non-hardware) | " + ms + "ms"); rows.push({ model: m.name, problem: prob.name, attempt: attempt, pass: false, ms: ms, compiled: false, reason: "off-topic" }); continue; }

      // Force Pluto's exact header onto the top module so name + ports + params always
      // match the testbench (submodules kept verbatim). A wrong declaration can't cause
      // a false fail; wrong logic still fails honestly.
      const forced = forceHeader(code, prob.header);
      if (forced) code = forced;
      const s = await scoreModule(code, prob, cfg);
      console.log(tag + (s.pass ? "PASS" : "FAIL") + " (" + s.reason + ") | " + ms + "ms" + (outputTokens ? ", " + outputTokens + " out-tok" : ""));
      rows.push({ model: m.name, problem: prob.name, attempt: attempt, pass: s.pass, ms: ms, outputTokens: outputTokens, compiled: s.compiled, reason: s.reason });
      await sleep(300); // gentle pacing between calls
     } // attempts
    } // problems
    console.log("");
  }

  const summary = aggregate(rows, picked, models);
  const file = writeResults(summary);
  const posted = await postResults(summary, cfg);

  console.log("── Summary (" + summary.month + ") ──");
  summary.models
    .slice()
    .sort((a, b) => (b.accuracyPct || 0) - (a.accuracyPct || 0))
    .forEach((m) => {
      const acc = m.accuracyPct == null ? "N/A" : m.accuracyPct + "%";
      const spd = m.avgLatencyMs == null ? "N/A" : m.avgLatencyMs + "ms";
      console.log("  " + m.name.padEnd(32) + " acc=" + String(acc).padStart(6) + "  speed=" + String(spd).padStart(8) + (m.skipped ? "  (" + m.skipped + " skipped)" : ""));
    });
  console.log("\nWrote " + file + (posted.posted ? "  |  posted to leaderboard endpoint" : posted.error ? "  |  POST failed: " + posted.error : ""));
}

main().catch((e) => { console.error("Harness failed:", e && e.stack || e); process.exit(1); });
