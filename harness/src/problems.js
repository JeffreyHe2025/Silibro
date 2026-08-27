// Discover Pluto problems and pick N at random. A "problem" is any subdirectory of
// problems/<tier> that contains a prompt.txt. Each problem also ships one or more
// .v/.sv files (the testbench + golden reference) used to score correctness.
const fs = require("fs");
const path = require("path");

function listProblems(plutoRepo, subdir) {
  const root = path.join(plutoRepo, subdir);
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); }
  catch (e) { throw new Error("Can't read problems dir " + root + " — check config.plutoRepo/problemsSubdir. " + e.message); }
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => path.join(root, e.name))
    .filter((dir) => fs.existsSync(path.join(dir, "prompt.txt")))
    .map((dir) => ({ name: path.basename(dir), dir }));
}

function pickRandom(arr, n) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {           // Fisher–Yates
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, Math.min(n, a.length));
}

// Load a problem following Pluto's convention:
//   - prompt.txt  : the natural-language spec
//   - header.v    : the required interface — module `opt_model(...)` (given to the LLM
//                   so it produces the exact name + ports the testbench expects)
//   - scoring files = the problem's .v/.sv files EXCEPT header.v and Pluto's own
//     answers (opt_area/opt_delay/opt_power.v). That leaves unopt.v (golden
//     reference) + testbench.v, which is exactly what `bash.sh` compiles alongside
//     the model's opt_model.
function loadProblem(p) {
  const read = (f) => fs.readFileSync(path.join(p.dir, f), "utf8");
  const prompt = read("prompt.txt");
  let header = "";
  try { header = read("header.v"); } catch (e) { /* some problems may not have one */ }

  const harnessFiles = fs.readdirSync(p.dir)
    .filter((f) => /\.s?v$/i.test(f))
    .filter((f) => f.toLowerCase() !== "header.v")        // interface stub — LLM writes this
    .filter((f) => !/^opt_/i.test(f))                     // Pluto's own reference solutions
    .map((f) => ({ name: f, code: read(f) }));

  return { name: p.name, dir: p.dir, prompt, header, harnessFiles };
}

module.exports = { listProblems, pickRandom, loadProblem };
