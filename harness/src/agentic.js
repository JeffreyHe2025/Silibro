// Drive YOUR agentic pipeline (the backend's Verifier -> approval -> Builder flow)
// for one problem, and return the modules it produced. The Verifier's spec is
// AUTO-APPROVED (no human gate) by calling /flow/approve with approved:true
// immediately after /flow/start — so this measures the full pipeline unattended.
//
// Returns { files, ms, error?, skipped?, offTopic?, redirect? }:
//   files    : { "<name>.v": "<code>", ... } — the DUT modules the pipeline built
//   ms       : total pipeline wall-clock (start -> final result line)
//   skipped  : true if the model's key isn't set
//   offTopic : true if the guardrail rejected the prompt as non-hardware
//
// Timing note: `ms` is the whole pipeline (verifier spec + builder + internal
// verify/refix), i.e. how long your product takes to answer — the honest number
// for an "agentic pipeline" leaderboard.

function backendBase(cfg) {
  const b = (process.env.HARNESS_BACKEND_URL || cfg.backendUrl || "http://localhost:3000").trim();
  return b.replace(/\/+$/, "");
}

// Read an NDJSON response to completion and return the LAST parseable JSON object
// (the flow's final line: {done,files,log} or {done:false,spec} or {error}).
async function lastNdjsonObject(res) {
  const text = await res.text();
  const lines = text.split("\n").map((s) => s.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try { return JSON.parse(lines[i]); } catch (e) { /* skip non-JSON */ }
  }
  return null;
}

async function runAgentic(model, systemPrompt, userPrompt, cfg) {
  const flow = model.flow || {};
  const provider = flow.provider;
  const flowModel = flow.model || model.model;
  const keyEnv = flow.keyEnv || model.keyEnv;
  const key = keyEnv ? process.env[keyEnv] : undefined;
  const harnessToken = process.env.HARNESS_ADMIN_TOKEN;
  if (!provider) return { error: 'model "' + model.name + '" has no flow.provider in config', skipped: true };
  if (provider === "bedrock") {
    // Bedrock uses the backend's AWS creds; the harness authenticates with the
    // admin token (bypasses the user/credit billing gate). No BYOK key needed.
    if (!harnessToken) return { error: "HARNESS_ADMIN_TOKEN not set (needed for Bedrock)", skipped: true };
  } else if (!key) {
    return { error: "no API key (" + keyEnv + " not set)", skipped: true };
  }

  const base = backendBase(cfg);
  const headers = { "content-type": "application/json" };
  if (harnessToken) headers["x-harness-token"] = harnessToken;
  // The flow has its own internal system prompts; fold any extra guidance into the task.
  const prompt = systemPrompt ? systemPrompt + "\n\n" + userPrompt : userPrompt;
  const t0 = Date.now();
  try {
    // 1) Verifier writes the spec, run pauses at approval.
    const startBody = { prompt, provider, verifierModel: flowModel, builderModel: flowModel };
    if (provider !== "bedrock") startBody.key = key;
    const sRes = await fetch(base + "/flow/start", {
      method: "POST",
      headers: headers,
      body: JSON.stringify(startBody),
    });
    if (!sRes.ok) throw new Error("/flow/start HTTP " + sRes.status + ": " + (await sRes.text()).slice(0, 300));
    const started = await sRes.json();
    if (started.error) throw new Error(started.error);
    if (started.done && started.offTopic) return { offTopic: true, redirect: started.redirect, ms: Date.now() - t0 };
    const threadId = started.threadId;
    if (!threadId) throw new Error("no threadId returned from /flow/start");

    // 2) AUTO-APPROVE the spec — this is the human-in-the-loop bypass. The Builder
    //    (and internal verify/refix) run now; the final NDJSON line carries files.
    const aRes = await fetch(base + "/flow/approve", {
      method: "POST",
      headers: headers,
      body: JSON.stringify({ threadId, approved: true, provider }),
    });
    if (!aRes.ok) throw new Error("/flow/approve HTTP " + aRes.status + ": " + (await aRes.text()).slice(0, 300));
    const fin = await lastNdjsonObject(aRes);
    const ms = Date.now() - t0;
    if (!fin) throw new Error("no result line from /flow/approve");
    if (fin.error) return { error: fin.error, ms };
    if (fin.offTopic) return { offTopic: true, redirect: fin.redirect, ms };
    return { files: fin.files || {}, log: fin.log || [], ms };
  } catch (e) {
    return { error: String((e && e.message) || e), ms: Date.now() - t0 };
  }
}

// Merge the pipeline's file map into one Verilog string (all built modules), so
// forceHeader can pick the top (opt_model / root) and keep the submodules.
function mergeFiles(files) {
  if (!files) return "";
  return Object.keys(files)
    .map((k) => files[k])
    .filter((c) => typeof c === "string" && c.trim())
    .join("\n\n");
}

module.exports = { runAgentic, mergeFiles, backendBase };
