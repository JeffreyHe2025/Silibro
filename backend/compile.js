// Compile-check Verilog with Icarus Verilog (iverilog).
//
// Given a set of files and the name of the module to elaborate as the top,
// runs `iverilog` and reports whether it compiled, plus any error output.

const { execFile } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

/**
 * @param {{name: string, code: string}[]} files  all files to include (module + its deps)
 * @param {string} [topModule]  the module to elaborate as top (usually the one being checked)
 * @returns {Promise<{ok: boolean, output: string}>}
 */
function compileVerilog(files, topModule) {
  return new Promise((resolve) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vbuild-"));
    try {
      const paths = files.map((f) => {
        const p = path.join(dir, f.name);
        fs.writeFileSync(p, f.code || "");
        return p;
      });
      const out = path.join(dir, "a.out");

      // -g2012: allow SystemVerilog-2012 constructs.  -s <top>: elaborate this module.
      const args = ["-g2012"];
      if (topModule) args.push("-s", topModule);
      args.push("-o", out, ...paths);

      execFile("iverilog", args, { timeout: 20000 }, (err, stdout, stderr) => {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
        if (err) {
          resolve({ ok: false, output: (stderr || stdout || String(err)).trim() });
        } else {
          resolve({ ok: true, output: (stderr || "").trim() }); // stderr may hold warnings
        }
      });
    } catch (e) {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
      resolve({ ok: false, output: String(e && e.message || e) });
    }
  });
}

// Floor-tier structural lint: elaborate with warnings, no output binary. Catches
// implicit nets, port/width mismatches and similar structural issues that a plain
// compile ignores. Uses the already-installed iverilog (-Wall, null target) — no
// new dependency. (verilator --lint-only is a stronger upgrade if you install it.)
// Returns { clean, output }. NOTE: this is structural only — NO functional oracle.
function lintVerilog(files, topModule) {
  return new Promise((resolve) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vlint-"));
    try {
      const paths = files.map((f) => {
        const p = path.join(dir, f.name);
        fs.writeFileSync(p, f.code || "");
        return p;
      });
      const args = ["-g2012", "-Wall", "-t", "null"];
      if (topModule) args.push("-s", topModule);
      args.push(...paths);
      execFile("iverilog", args, { timeout: 20000 }, (err, stdout, stderr) => {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
        const out = (stderr || stdout || "").trim();
        resolve({ clean: !err && !out, output: out });
      });
    } catch (e) {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
      resolve({ clean: false, output: String((e && e.message) || e) });
    }
  });
}

// Scan for simulation-only constructs that Yosys SILENTLY strips (so generic
// synthesis alone won't flag them) — the classic LLM mistakes. Comments/strings
// are removed first. Returns a reason string, or "" if clean.
function nonSynthConstructs(code) {
  const src = String(code || "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""');
  const checks = [
    [/#\s*\d/, "procedural delay (#N)"],           // #10 — not #( which is a param override
    [/\bfork\b/, "fork/join"],
    [/\bwait\s*\(/, "wait statement"],
    // simulation system tasks (NOT $signed/$unsigned/$clog2/$bits — those synthesize)
    [/\$(display|write|fdisplay|fwrite|monitor|strobe|finish|stop|time|realtime|dumpfile|dumpvars|fopen|fclose|readmemb|readmemh)\b/, "simulation system task"],
  ];
  for (const [re, why] of checks) if (re.test(src)) return why;
  return "";
}

// Floor-tier GENERIC SYNTHESIS check. Answers "can this become hardware?" which
// compile/iverilog-lint can't. Two layers, because Yosys silently strips some
// sim-only constructs (delays!) instead of erroring:
//   1) regex pre-scan for sim-only constructs Yosys ignores (delays, $display…)
//   2) Yosys generic synthesis (light flow, no techmap) for STRUCTURAL synth
//      errors (undriven, multi-driver, comb loops, unbounded loops, elaboration).
// Graceful if yosys isn't installed: { available:false } — the regex layer still
// runs. Returns { available, synthesizable, output }.  ($0 — local tool, no API.)
function synthCheck(files, topModule) {
  return new Promise((resolve) => {
    // Layer 1: sim-only construct scan on the target module.
    const target = topModule ? files.find((f) => f.name === topModule + ".v") : null;
    const scanCode = target ? target.code : files.map((f) => f.code).join("\n");
    const simOnly = nonSynthConstructs(scanCode);
    if (simOnly) {
      resolve({ available: true, synthesizable: false, output: "non-synthesizable: " + simOnly });
      return;
    }

    // Layer 2: Yosys generic synthesis.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vsynth-"));
    try {
      const paths = files.map((f) => {
        const p = path.join(dir, f.name);
        fs.writeFileSync(p, f.code || "");
        return p;
      });
      const script =
        "read_verilog -sv " + paths.map((p) => '"' + p + '"').join(" ") + "; " +
        (topModule ? "hierarchy -check -top " + topModule + "; " : "hierarchy -check; ") +
        "proc; opt; memory -nomap; check -assert";
      execFile("yosys", ["-p", script], { timeout: 30000 }, (err, stdout, stderr) => {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
        if (err && err.code === "ENOENT") {
          // yosys absent — layer 1 already passed, so report that (don't block).
          resolve({ available: false, synthesizable: null, output: "yosys not installed (sim-only scan passed)" });
          return;
        }
        const out = ((stdout || "") + "\n" + (stderr || "")).trim();
        resolve({ available: true, synthesizable: !err, output: out.slice(0, 800) });
      });
    } catch (e) {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
      resolve({ available: true, synthesizable: false, output: String((e && e.message) || e) });
    }
  });
}

// Compile each file on its own so ONE broken file can't mask the others.
// All files are written to the same dir (so cross-file references resolve),
// but we elaborate each file individually. Errors that only come from missing
// modules defined elsewhere are classified as "needs-deps" rather than a fault
// of the file itself, so the report stays meaningful per file.
//
// @returns {Promise<{combined:{ok,output}, perFile:[{name,ok,kind,output}]}>}
//   kind: "ok" | "syntax" | "needs-deps" | "error"
async function compileReport(files) {
  const combined = await compileVerilog(files);
  const perFile = [];
  for (const f of files) {
    // Compile just this one file (parse + elaborate its own modules).
    const res = await compileVerilog([{ name: f.name, code: f.code }]);
    if (res.ok) {
      perFile.push({ name: f.name, ok: true, kind: "ok", output: res.output || "" });
      continue;
    }
    const low = (res.output || "").toLowerCase();
    const hasSyntax = /syntax error|error: syntax|malformed|unexpected/.test(low);
    // Elaboration failures caused only by modules defined in OTHER files.
    const onlyMissingDeps =
      !hasSyntax &&
      /(unknown module|unable to elaborate|unknown type|no such|does not exist)/.test(low);
    perFile.push({
      name: f.name,
      ok: onlyMissingDeps, // parses fine on its own; just references external modules
      kind: hasSyntax ? "syntax" : onlyMissingDeps ? "needs-deps" : "error",
      output: res.output || "",
    });
  }
  return { combined, perFile };
}

// Run a testbench: compile DUT files + the testbench, then simulate with vvp.
// Returns { ok, output } where output is the simulation's stdout (markers like
// SMOKE_PASS / SMOKE_FAIL / SMOKE_X are parsed by the caller). ok=false means it
// couldn't even compile/run. ($0 — local tools, no API.)
function runTestbench(files, tbTop) {
  return new Promise((resolve) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vsim-"));
    try {
      const paths = files.map((f) => {
        const p = path.join(dir, f.name);
        fs.writeFileSync(p, f.code || "");
        return p;
      });
      const out = path.join(dir, "sim.out");
      const args = ["-g2012", "-s", tbTop, "-o", out, ...paths];
      execFile("iverilog", args, { timeout: 20000 }, (cerr, cstdout, cstderr) => {
        if (cerr) {
          try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
          resolve({ ok: false, output: "compile error: " + (cstderr || cstdout || String(cerr)).trim() });
          return;
        }
        execFile("vvp", [out], { timeout: 20000 }, (rerr, rstdout, rstderr) => {
          try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
          const simOut = ((rstdout || "") + (rstderr || "")).trim();
          resolve({ ok: !rerr || simOut.length > 0, output: simOut });
        });
      });
    } catch (e) {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
      resolve({ ok: false, output: String((e && e.message) || e) });
    }
  });
}

module.exports = { compileVerilog, compileReport, lintVerilog, synthCheck, runTestbench };
