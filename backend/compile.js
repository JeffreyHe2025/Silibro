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

module.exports = { compileVerilog, compileReport };
