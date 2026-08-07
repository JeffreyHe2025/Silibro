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
          // compileFailed distinguishes "the testbench/interface won't build" from
          // "it ran and reported a result" — the caller uses this to tell a broken
          // testbench apart from a real module failure.
          resolve({ ok: false, compileFailed: true, output: "compile error: " + (cstderr || cstdout || String(cerr)).trim() });
          return;
        }
        execFile("vvp", [out], { timeout: 20000 }, (rerr, rstdout, rstderr) => {
          try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
          const simOut = ((rstdout || "") + (rstderr || "")).trim();
          resolve({ ok: !rerr || simOut.length > 0, compileFailed: false, output: simOut });
        });
      });
    } catch (e) {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
      resolve({ ok: false, compileFailed: true, output: String((e && e.message) || e) });
    }
  });
}

// --- Whole-project synthesis (final step, after build + verification) --------

// Split Verilog source into its modules: [{name, body}] where body is everything
// between the module name and endmodule (so it starts with the port list, or ';'
// when the module is portless). Comments are stripped first.
function parseModules(code) {
  const src = String(code || "").replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const mods = [];
  const re = /\bmodule\s+(\w+)\b([\s\S]*?)\bendmodule\b/g;
  let m;
  while ((m = re.exec(src))) mods.push({ name: m[1], body: m[2] });
  return mods;
}

// Is this module a TESTBENCH rather than part of the design? A testbench has no
// ports (nothing drives it from outside) or generates its own clock with delays.
// Testbenches must be excluded before synthesis — they're full of the sim-only
// constructs (#delays, $display, initial) that synthesis cannot map to hardware.
function isTestbenchModule(mod) {
  const portless = /^\s*;/.test(mod.body) || /^\s*\(\s*\)\s*;/.test(mod.body);
  const tbName = /^(tb|testbench)$/i.test(mod.name) || /(_tb$|^tb_|_test$|bench)/i.test(mod.name);
  const simClock = /always\s*#/.test(mod.body) || /forever\s*#/.test(mod.body);
  return portless || (tbName && simClock);
}

// Pick the top-level DESIGN module for synthesis: the design module that no other
// design module instantiates. Testbenches are ignored entirely (they'd otherwise
// look like the root). Returns { top, roots, designFiles, excluded }.
//   roots — every design root found. More than one means the project has several
//           unconnected designs, so the caller must ask which to synthesize.
//   excluded — files dropped as testbenches.
function findTopDesignModule(files) {
  const designFiles = [];
  const excluded = [];
  files.forEach((f) => {
    const mods = parseModules(f.code);
    // A file is testbench INFRASTRUCTURE if it contains a testbench TOP — a
    // portless module, or a tb-named clock generator. Its OTHER modules (a
    // stimulus generator, a scoreboard) have ports and look like design, but they
    // only exist to drive the testbench, so the whole file must be excluded.
    // (Also exclude a file that is entirely testbench modules.)
    const hasTbTop = mods.some((m) => {
      const portless = /^\s*;/.test(m.body) || /^\s*\(\s*\)\s*;/.test(m.body);
      const simClock = /always\s*#/.test(m.body) || /forever\s*#/.test(m.body);
      return portless || (/^(tb|testbench)$/i.test(m.name) && simClock);
    });
    if (mods.length && (hasTbTop || mods.every(isTestbenchModule))) excluded.push(f.name);
    else designFiles.push(f);
  });

  const mods = [];
  designFiles.forEach((f) => parseModules(f.code).forEach((m) => {
    if (!isTestbenchModule(m)) mods.push(m);
  }));
  if (!mods.length) return { top: "", roots: [], designFiles, excluded };

  // A module is INSTANTIATED if another module references it as an instance:
  //   Name [#(...params...)] instName (   — the #(...) may contain nested parens.
  const names = mods.map((x) => x.name);
  const instantiated = new Set();
  mods.forEach((host) => {
    names.forEach((n) => {
      if (n === host.name) return;
      const rx = new RegExp("\\b" + n + "\\b\\s*(?:#\\s*\\([^)]*(?:\\([^)]*\\)[^)]*)*\\))?\\s*\\w+\\s*\\(");
      if (rx.test(host.body)) instantiated.add(n);
    });
  });
  const roots = mods.filter((x) => !instantiated.has(x.name)).map((x) => x.name);
  return { top: roots.length === 1 ? roots[0] : "", roots, designFiles, excluded };
}

// Parse a `stat` block out of the yosys log into numbers. Yosys prints either a
// "=== design hierarchy ===" summary (multi-module, counts INCLUDING submodules)
// or a single "=== <module> ===" block. Both use the same "<count> <label>" rows,
// with cell types indented under the "cells" row. Missing counts print as '-'.
function parseYosysStat(log) {
  const text = String(log || "");
  const hier = text.lastIndexOf("=== design hierarchy ===");
  const start = hier >= 0 ? hier : text.lastIndexOf("\n=== ");
  if (start < 0) return null;
  // The block ends at the next yosys pass header ("N. Executing ...") or EOF.
  const rest = text.slice(start);
  const end = rest.search(/\n\s*\d+(\.\d+)*\.\s+(Executing|Printing)/);
  const block = end > 0 ? rest.slice(0, end) : rest;

  const stats = { cellTypes: [], submoduleUses: [] };
  const LABELS = {
    wires: "wires", "wire bits": "wireBits", "public wires": "publicWires",
    "public wire bits": "publicWireBits", ports: "ports", "port bits": "portBits",
    memories: "memories", "memory bits": "memoryBits", processes: "processes",
    cells: "cells", submodules: "submodules",
  };
  // The indented breakdown rows belong to whichever totals row came last: the
  // "cells" row is followed by cell types, the "submodules" row by instance
  // counts. Without tracking that, submodules get counted as gates.
  let section = "";
  block.split("\n").forEach((line) => {
    // Totals row: "       47 cells"  ('-' means zero)
    let m = line.match(/^\s*(\d+|-)\s+([a-z ]+?)\s*$/);
    if (m && LABELS[m[2]]) {
      stats[LABELS[m[2]]] = m[1] === "-" ? 0 : parseInt(m[1], 10);
      section = m[2] === "cells" ? "cells" : m[2] === "submodules" ? "submodules" : "";
      return;
    }
    // Breakdown row: "        9   $_DFF_PN0_"  (two+ spaces before the name)
    m = line.match(/^\s*(\d+)\s{2,}([\w$\\.]+)\s*$/);
    if (m) {
      const row = { name: m[2], count: parseInt(m[1], 10) };
      if (section === "submodules") stats.submoduleUses.push(row);
      else if (section === "cells") stats.cellTypes.push(row);
      return;
    }
    // With -liberty: "Chip area for top module '\top': 1234.56"
    m = line.match(/Chip area for (?:top )?module .*?:\s*([\d.]+)/);
    if (m) stats.area = parseFloat(m[1]);
  });

  // Sequential elements, so the report can say "N flip-flops" — generic yosys
  // gate names ($_DFF_P_, $_SDFFE_PP0P_, $_DLATCH_N_) and liberty cell names.
  stats.flipFlops = stats.cellTypes
    .filter((c) => /^\$_(S?DFFE?|DFFSR|ADFF|ALDFF|DLATCH|SR)/i.test(c.name) || /\b(dff|dlatch|sdff)/i.test(c.name))
    .reduce((n, c) => n + c.count, 0);
  return stats;
}

// FINAL WHOLE-PROJECT SYNTHESIS. Unlike synthCheck (a light per-module "can this
// become hardware?" gate run during the build), this runs the FULL yosys `synth`
// flow on the assembled design — proc, fsm, memory inference, techmap and gate
// mapping — and reports the resulting netlist plus area/cell statistics. This is
// what you run once, at the end, after the LLMs have finished building and
// verifying. ($0 — local tool, no API.)
//
// @param files  [{name, code}] — the whole project; testbenches are auto-excluded
// @param opts   { top?, liberty?, timeout? }
//   top      explicit top module (otherwise detected; ambiguity is an error)
//   liberty  path to a .lib standard-cell library — maps to real cells and gives
//            a true chip-area number instead of generic gate counts
// @returns {Promise<{ok, top, roots, excluded, stats, longestPath, netlist,
//                    warnings, errors, output}>}
function synthesizeProject(files, opts) {
  opts = opts || {};
  return new Promise((resolve) => {
    const vfiles = (files || []).filter((f) => f && /\.s?v$/i.test(f.name));
    if (!vfiles.length) {
      resolve({ ok: false, errors: ["no Verilog files to synthesize"], output: "" });
      return;
    }

    const detected = findTopDesignModule(vfiles);
    const top = opts.top || detected.top;
    if (!top) {
      resolve({
        ok: false,
        roots: detected.roots,
        excluded: detected.excluded,
        errors: [
          detected.roots.length > 1
            ? "the project has more than one top-level design module (" +
              detected.roots.join(", ") + ") — pass `top` to choose one"
            : "could not find a top-level design module to synthesize",
        ],
        output: "",
      });
      return;
    }

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vsynthproj-"));
    try {
      // Only the design files go in — a testbench would drag $display/#delay into
      // synthesis and fail (or be silently stripped, which is worse).
      const names = detected.designFiles.map((f) => {
        fs.writeFileSync(path.join(dir, f.name), f.code || "");
        return f.name;
      });

      // Yosys IGNORES some sim-only constructs (notably #delays) instead of
      // erroring, so a design containing them would synthesize "clean" into
      // hardware that doesn't match simulation. Scan for them separately — same
      // check the per-module synthCheck does, applied to the whole design.
      const simOnly = detected.designFiles
        .map((f) => ({ file: f.name, reason: nonSynthConstructs(f.code) }))
        .filter((x) => x.reason);

      const lib = opts.liberty ? '"' + opts.liberty + '"' : "";
      const script = [
        "read_verilog -sv " + names.map((n) => '"' + n + '"').join(" "),
        "hierarchy -check -top " + top,
        "synth -top " + top,                       // the full generic flow
        ...(lib ? ["dfflibmap -liberty " + lib, "abc -liberty " + lib, "opt_clean"] : []),
        "write_verilog -noattr netlist.v",         // gate-level netlist
        "write_json netlist.json",                 // machine-readable (nextpnr etc.)
        "stat -top " + top + (lib ? " -liberty " + lib : ""),
        "check -assert",                           // undriven / multi-driver / loops
        "flatten",                                 // depth across the hierarchy...
        "opt_clean",
        "ltp -noff",                               // ...combinational path length
      ].join("\n");
      fs.writeFileSync(path.join(dir, "synth.ys"), script);

      execFile(
        "yosys",
        ["-s", "synth.ys"],
        { cwd: dir, timeout: opts.timeout || 180000, maxBuffer: 32 * 1024 * 1024 },
        (err, stdout, stderr) => {
          const log = (stdout || "") + "\n" + (stderr || "");
          let netlist = "";
          try { netlist = fs.readFileSync(path.join(dir, "netlist.v"), "utf8"); } catch (_) {}
          try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}

          if (err && err.code === "ENOENT") {
            resolve({
              ok: false, top: top, available: false,
              errors: ["yosys is not installed on the backend (brew install yosys)"],
              output: "",
            });
            return;
          }

          const errors = (log.match(/^ERROR:.*$/gm) || []).map((s) => s.trim());
          const warnings = (log.match(/^Warning:.*$/gm) || []).map((s) => s.trim());
          const ltp = log.match(/Longest topological path in [^(]*\(length=(\d+)\)/);
          // Sim-only constructs don't stop yosys, but they DO mean the netlist
          // won't behave like the simulation — so they fail the run.
          simOnly.forEach((x) =>
            errors.unshift("non-synthesizable in " + x.file + ": " + x.reason + " (yosys silently ignores it)")
          );

          resolve({
            ok: !err && !errors.length,
            available: true,
            top: top,
            roots: detected.roots,
            excluded: detected.excluded,
            stats: parseYosysStat(log),
            longestPath: ltp ? parseInt(ltp[1], 10) : null,
            netlist: netlist,
            warnings: warnings.slice(0, 40),
            errors: errors.slice(0, 20),
            // Tail of the log: where the failure is, when there is one.
            output: log.trim().slice(-6000),
          });
        }
      );
    } catch (e) {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
      resolve({ ok: false, top: top, errors: [String((e && e.message) || e)], output: "" });
    }
  });
}

// Find the top module to simulate for a (possibly multi-module) testbench file.
// The TOP is the module that no other module instantiates (the root) — NOT just
// any module with $finish (a scoreboard/checker often has $finish too). Returns a
// name or "". body[i] is everything between the module name and endmodule, so it
// starts with the port list (or ';' when the module is portless — a classic
// testbench-top trait).
function findTopModule(code) {
  const src = String(code || "").replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const mods = [];
  const re = /\bmodule\s+(\w+)\b([\s\S]*?)\bendmodule\b/g;
  let m;
  while ((m = re.exec(src))) mods.push({ name: m[1], body: m[2] });
  if (!mods.length) return "";
  if (mods.length === 1) return mods[0].name;

  // A module is INSTANTIATED if another module references it as an instance:
  //   Name [#(...params...)] instName (   — the #(...) may contain nested parens.
  const names = mods.map((x) => x.name);
  const instantiated = new Set();
  mods.forEach((host) => {
    names.forEach((n) => {
      if (n === host.name) return;
      const rx = new RegExp("\\b" + n + "\\b\\s*(?:#\\s*\\([^)]*(?:\\([^)]*\\)[^)]*)*\\))?\\s*\\w+\\s*\\(");
      if (rx.test(host.body)) instantiated.add(n);
    });
  });
  const roots = mods.filter((x) => !instantiated.has(x.name));
  const pool = roots.length ? roots : mods;

  const portless = (x) => /^\s*;/.test(x.body) || /^\s*\(\s*\)\s*;/.test(x.body); // module tb;  / module tb();
  const tbName = (x) => /^(tb|testbench|top)$/i.test(x.name) || /(_tb|tb_|test|bench)/i.test(x.name);
  const hasClockGen = (x) => /always\s*#/.test(x.body) || /forever\s*#/.test(x.body); // generates its own clock

  return (
    pool.find((x) => portless(x) && tbName(x)) ||
    pool.find((x) => portless(x)) ||          // a testbench top has no ports
    pool.find((x) => hasClockGen(x)) ||        // it makes its own clock
    pool.find((x) => tbName(x)) ||
    pool[pool.length - 1]                      // last root as a final fallback
  ).name;
}

module.exports = { compileVerilog, compileReport, lintVerilog, synthCheck, synthesizeProject, findTopDesignModule, runTestbench, findTopModule };
