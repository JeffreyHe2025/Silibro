// HTTP backend for the bottom-up Verilog builder.
//
//   POST /build   { spec, provider, key, model }
//     -> plans modules, builds bottom-up, iverilog-checks each one,
//        returns the built files + a per-module log.
//   POST /compile { files: [{name, code}], top? }
//     -> just compile-check a set of files (handy for the frontend loop).
//   GET  /health

const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const { buildDesign, generateProjectTestbench } = require("./build");
const { compileVerilog, compileReport, runTestbench } = require("./compile");
const { startFlow, resumeFlow } = require("./flow");

const app = express();
app.use(cors()); // allow the browser frontend to call this
app.use(express.json({ limit: "4mb" }));

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
    const tb = await generateProjectTestbench({ provider, key, model }, spec || "", vfiles);
    if (!tb || !tb.code) return res.json({ error: "could not generate a testbench" });
    // Run it against the whole design.
    const simFiles = vfiles.slice();
    simFiles.push({ name: tb.name, code: tb.code });
    const sim = await runTestbench(simFiles, tb.top);
    const markers = ((sim.output.match(/PROJECT_[A-Z]+[^\n]*/g) || []).join("; ") || sim.output.slice(0, 300)).slice(0, 600);
    const passed = /PROJECT_PASS/.test(sim.output) && !/PROJECT_FAIL/.test(sim.output)
      ? true
      : /PROJECT_FAIL/.test(sim.output) ? false : null;
    res.json({ name: tb.name, code: tb.code, passed: passed, output: markers });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
});

// Full bottom-up build from a spec/prompt.
app.post("/build", async (req, res) => {
  const { spec, provider, key, model } = req.body || {};
  if (!spec || !provider || !key || !model) {
    return res.status(400).json({ error: "spec, provider, key, model are required" });
  }
  try {
    const log = [];
    const out = await buildDesign({ provider, key, model }, spec, (ev) => {
      log.push(ev);
      console.log("[build]", JSON.stringify(ev));
    });
    res.json({ ...out, log });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
});

// --- Two-agent flow (Verifier -> approval -> Builder) via LangGraph ---------

// Start: Verifier writes the spec, then the run pauses for the user's approval.
// Returns { threadId, done:false, spec }.
app.post("/flow/start", async (req, res) => {
  const { prompt, images, provider, key, verifierModel, builderModel } = req.body || {};
  if (!prompt || !provider || !key || !(verifierModel || builderModel)) {
    return res.status(400).json({ error: "prompt, provider, key and a model are required" });
  }
  try {
    const threadId = crypto.randomUUID();
    const out = await startFlow(
      {
        prompt: prompt,
        images: images,
        provider: provider,
        key: key,
        verifierModel: verifierModel || builderModel,
        builderModel: builderModel || verifierModel,
      },
      threadId
    );
    res.json({ threadId, ...out });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
});

// Approve/reject the spec. Streams newline-delimited JSON (NDJSON): each build
// event (plan / building / attempt / built) is written as its own line as it
// happens, then a final line carries the result:
//   { approved:true }            -> ...events..., { done:true, files, log }
//   { approved:false, changes }  -> { done:false, spec }   (no build events)
// The frontend reads the stream and logs each event live.
app.post("/flow/approve", async (req, res) => {
  const { threadId, approved, changes } = req.body || {};
  if (!threadId) return res.status(400).json({ error: "threadId required" });

  res.setHeader("Content-Type", "application/x-ndjson");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("X-Accel-Buffering", "no"); // disable proxy buffering if present
  res.flushHeaders();
  const send = (obj) => { res.write(JSON.stringify(obj) + "\n"); };

  try {
    const out = await resumeFlow(
      threadId,
      { approved: !!approved, changes: changes || "" },
      (ev) => send({ type: "progress", event: ev }) // live build events
    );
    send({ threadId, ...out }); // final line: {done, files, log} or {done:false, spec}
  } catch (e) {
    send({ error: String((e && e.message) || e) });
  }
  res.end();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Verilog build backend listening on :" + PORT));
