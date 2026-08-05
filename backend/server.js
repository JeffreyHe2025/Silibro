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
const { buildDesign, generateProjectTestbench, repairProjectTestbench } = require("./build");
const { compileVerilog, compileReport, runTestbench, findTopModule } = require("./compile");
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
//   body: { files:[{name,code}], tbFile?, tbTop? }
//   -> { top, passed:true|false|null, compileFailed, output }
app.post("/testbench/run", async (req, res) => {
  const { files, tbFile, tbTop } = req.body || {};
  if (!Array.isArray(files) || !files.length) {
    return res.status(400).json({ error: "files: [{name, code}] required" });
  }
  try {
    const vfiles = files.filter((f) => f && /\.s?v$/i.test(f.name));
    if (!vfiles.length) return res.json({ error: "no Verilog files provided" });

    // Pick the testbench top: caller-given, else detect from the named tb file,
    // else detect across all files.
    let top = tbTop;
    if (!top && tbFile) {
      const tf = vfiles.find((f) => f.name === tbFile);
      if (tf) top = findTopModule(tf.code);
    }
    if (!top) top = findTopModule(vfiles.map((f) => f.code || "").join("\n"));
    if (!top) return res.json({ error: "could not determine the testbench's top module" });

    const sim = await runTestbench(vfiles, top);
    if (sim.compileFailed) {
      return res.json({ top, passed: null, compileFailed: true, output: (sim.output || "").slice(0, 4000) });
    }
    // Best-effort verdict from common markers (user testbenches vary); FAIL wins
    // over PASS. When nothing clear is printed, leave it null and show raw output.
    const out = sim.output || "";
    let passed = null;
    if (/\b(FAIL(ED)?|MISMATCH|ASSERTION\s+FAILED)\b/i.test(out)) passed = false;
    else if (/\b(PASS(ED)?|SUCCESS|ALL\s+TESTS?\s+PASSED)\b/i.test(out)) passed = true;
    res.json({ top, passed, compileFailed: false, output: out.slice(0, 4000) });
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
