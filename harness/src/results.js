// Aggregate per-model results and write them out (results.json + a dated archive),
// and optionally POST them to your site's leaderboard endpoint.
const fs = require("fs");
const path = require("path");

function monthStamp(d) {
  d = d || new Date();
  return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0");
}

// rows: [{ model, provider, problem, attempt, pass, ms, outputTokens, compiled, reason, skipped, error }]
// Scoring: each problem is attempted K times. Per-problem accuracy = passes / attempts
// that ran. The model's leaderboard accuracy = the AVERAGE of the per-problem
// accuracies (so every problem weighs equally, not every attempt). Speed = average
// latency over ALL runs that ran (failed generations still cost time).
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

function aggregate(rows, problems, models) {
  const byModel = {};
  models.forEach((m) => (byModel[m.name] = { name: m.name, provider: m.provider, model: m.model, prob: {}, latencies: [], tps: [], skipped: 0 }));
  rows.forEach((r) => {
    const g = byModel[r.model];
    if (!g) return;
    if (r.skipped) { g.skipped++; return; }
    const p = (g.prob[r.problem] = g.prob[r.problem] || { problem: r.problem, attempts: 0, passes: 0, latencies: [], reasons: [] });
    p.attempts++;
    if (r.pass) p.passes++;
    p.reasons.push(r.reason || (r.error ? "error" : ""));
    if (typeof r.ms === "number") { p.latencies.push(r.ms); g.latencies.push(r.ms); }
    if (typeof r.ms === "number" && r.ms > 0 && typeof r.outputTokens === "number") g.tps.push(r.outputTokens / (r.ms / 1000));
  });

  const models_out = Object.values(byModel).map((g) => {
    const probs = Object.values(g.prob);
    // per-problem accuracy (0..1), then average across problems
    const perProblem = probs.map((p) => ({
      problem: p.problem,
      attempts: p.attempts,
      passes: p.passes,
      accuracyPct: p.attempts ? Math.round((p.passes / p.attempts) * 1000) / 10 : null,
      avgLatencyMs: avg(p.latencies) != null ? Math.round(avg(p.latencies)) : null,
      reasons: p.reasons,
    }));
    const probAccs = perProblem.filter((p) => p.accuracyPct != null).map((p) => p.accuracyPct);
    return {
      name: g.name, provider: g.provider, model: g.model,
      problemsTested: perProblem.length,
      attemptsPerProblem: probs.length ? Math.max.apply(null, probs.map((p) => p.attempts)) : 0,
      accuracyPct: probAccs.length ? Math.round(avg(probAccs) * 10) / 10 : null, // avg of per-problem accuracies
      avgLatencyMs: avg(g.latencies) != null ? Math.round(avg(g.latencies)) : null, // avg over all runs
      avgTokensPerSec: avg(g.tps) != null ? Math.round(avg(g.tps) * 10) / 10 : null,
      skipped: g.skipped,
      perProblem: perProblem,
    };
  });
  return { month: monthStamp(), generatedAt: new Date().toISOString(), problems: problems.map((p) => p.name), models: models_out };
}

function writeResults(summary, outDir) {
  outDir = outDir || path.join(__dirname, "..", "results");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "results.json"), JSON.stringify(summary, null, 2));           // latest
  fs.writeFileSync(path.join(outDir, "results-" + summary.month + ".json"), JSON.stringify(summary, null, 2)); // archive
  return path.join(outDir, "results.json");
}

async function postResults(summary, cfg) {
  let url = process.env.LEADERBOARD_POST_URL;
  if (!url && cfg) {
    const base = (process.env.HARNESS_BACKEND_URL || cfg.backendUrl || "").replace(/\/+$/, "");
    if (base) url = base + "/leaderboard/results";
  }
  if (!url) return { posted: false };
  try {
    const headers = { "content-type": "application/json" };
    // Auth: prefer the shared harness token (same one used for Bedrock); a
    // dedicated LEADERBOARD_POST_TOKEN Bearer also works.
    if (process.env.HARNESS_ADMIN_TOKEN) headers["x-harness-token"] = process.env.HARNESS_ADMIN_TOKEN;
    if (process.env.LEADERBOARD_POST_TOKEN) headers.authorization = "Bearer " + process.env.LEADERBOARD_POST_TOKEN;
    const r = await fetch(url, { method: "POST", headers, body: JSON.stringify(summary) });
    return { posted: r.ok, status: r.status };
  } catch (e) { return { posted: false, error: String((e && e.message) || e) }; }
}

module.exports = { aggregate, writeResults, postResults, monthStamp };
