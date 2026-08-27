// Score a generated module against a Pluto problem's testbench with iverilog.
// Compiles [generated + the problem's harness files], runs vvp, and reads the
// verdict. Non-compiling / non-running counts as a fail (that's the benchmark
// convention). Returns { pass, compiled, ran, reason, output }.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const pexec = promisify(execFile);
const { firstModuleName } = require("./extract");

// Find the testbench top: a module that self-runs (has initial + $finish/$dumpvars),
// preferring names that look like a testbench. Returns null to let iverilog auto-pick.
function findTbTop(harnessFiles) {
  const candidates = [];
  harnessFiles.forEach((f) => {
    const re = /\bmodule\s+(\w+)/g;
    let m;
    while ((m = re.exec(f.code))) {
      const name = m[1];
      // crude scope: does this file drive a sim? good enough — problem files are small
      const drives = /\binitial\b/.test(f.code) && /(\$finish|\$dumpvars|\$display)/.test(f.code);
      candidates.push({ name, drives, tbName: /(^|_)(tb|testbench|test)(_|$)/i.test(name) || /^tb/i.test(name) });
    }
  });
  const driving = candidates.filter((c) => c.drives);
  const named = (driving.length ? driving : candidates).filter((c) => c.tbName);
  return (named[0] || driving[0] || null) && (named[0] || driving[0]).name;
}

async function scoreModule(generatedCode, problem, cfg) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lbcov-"));
  const cleanup = () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {} };
  try {
    const genName = firstModuleName(generatedCode);
    // Include the problem's harness files, but drop any that define the SAME module
    // as the generated one (e.g. a golden reference of the DUT) to avoid a redefinition.
    const harness = (problem.harnessFiles || []).filter((f) => {
      const n = firstModuleName(f.code);
      return !(genName && n === genName);
    });

    const files = [{ name: "generated.v", code: generatedCode }, ...harness];
    const paths = files.map((f) => { const p = path.join(dir, f.name); fs.writeFileSync(p, f.code || ""); return p; });

    const tbTop = findTbTop(harness);
    const out = path.join(dir, "sim.out");
    const args = ["-g2012", "-o", out];
    if (tbTop) args.push("-s", tbTop);
    args.push(...paths);

    // 1) Compile
    try {
      await pexec("iverilog", args, { timeout: cfg.iverilogTimeoutMs || 20000, maxBuffer: 8 * 1024 * 1024 });
    } catch (e) {
      cleanup();
      return { pass: false, compiled: false, ran: false, reason: "compile error", output: String((e.stderr || e.stdout || e.message || e)).slice(0, 1200) };
    }

    // 2) Run
    let simOut = "";
    try {
      const r = await pexec("vvp", [out], { timeout: cfg.vvpTimeoutMs || 30000, maxBuffer: 32 * 1024 * 1024, cwd: dir });
      simOut = (r.stdout || "") + (r.stderr || "");
    } catch (e) {
      simOut = String((e.stdout || "") + (e.stderr || "")); // $finish/nonzero exit still yields output
      if (!simOut.trim()) { cleanup(); return { pass: false, compiled: true, ran: false, reason: "sim did not run", output: String(e.message || e).slice(0, 600) }; }
    }

    const verdict = parseVerdict(simOut);
    cleanup();
    return { pass: verdict.pass, compiled: true, ran: true, reason: verdict.reason, output: simOut.slice(0, 2000) };
  } catch (e) {
    cleanup();
    return { pass: false, compiled: false, ran: false, reason: String((e && e.message) || e) };
  }
}

// Read a pass/fail verdict from simulation output. Pluto testbenches print
// "Total mismatches: N out of M samples"; also handle common PASS/FAIL markers.
function parseVerdict(out) {
  const s = String(out || "");
  const pl = /Total mismatches:\s*(\d+)\s+out of\s+(\d+)/i.exec(s);
  if (pl) {
    const mism = parseInt(pl[1], 10), total = parseInt(pl[2], 10);
    if (total === 0) return { pass: false, reason: "0 samples compared (test exercised nothing)" };
    return mism === 0 ? { pass: true, reason: "0/" + total + " mismatches" } : { pass: false, reason: mism + "/" + total + " mismatches" };
  }
  if (/\b(FAIL(ED)?|MISMATCH|ASSERTION\s+FAILED)\b/i.test(s) || /\berrors?\s*[:=]\s*[1-9]/i.test(s)) return { pass: false, reason: "failure marker in output" };
  if (/\b(PASS(ED)?|SUCCESS|ALL\s+TESTS?\s+PASSED)\b/i.test(s) || /\berrors?\s*[:=]\s*0\b/i.test(s)) return { pass: true, reason: "pass marker in output" };
  return { pass: false, reason: "no clear verdict in output (counted as fail)" };
}

module.exports = { scoreModule, parseVerdict, findTbTop };
