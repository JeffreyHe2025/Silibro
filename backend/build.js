// Bottom-up Verilog build:
//   1. Ask the LLM to decompose the spec into a module dependency graph.
//   2. Topologically sort it (dependencies first).
//   3. Build each module IN ORDER; after each one, compile-check it with
//      iverilog together with its already-built dependencies. On a compile
//      failure, feed the error back to the LLM and retry.
//
// Because we go bottom-up, every module can be checked the moment it's built
// (all the modules it instantiates already exist and have compiled).

const { callLLM } = require("./llm");
const { compileVerilog, lintVerilog, synthCheck, runTestbench } = require("./compile");
const { parseInterface, genSmokeTestbench } = require("./smoketb");

// Pull the Verilog out of a ```verilog / ```systemverilog / ```file:... block
// (or fall back to the whole reply).
function extractVerilog(text) {
  const m = (text || "").match(
    /```(?:verilog|systemverilog|file:[^\n]*)?\r?\n([\s\S]*?)```/i
  );
  return (m ? m[1] : text || "").trim();
}

// Dependencies before dependents. Returns { order, cycle }.
function topoSort(modules) {
  const byName = {};
  modules.forEach((m) => (byName[m.name] = m));
  const order = [];
  const built = {};
  let remaining = modules.slice();
  let progress = true;
  while (remaining.length && progress) {
    progress = false;
    remaining = remaining.filter((m) => {
      const ready = (m.dependsOn || []).every((d) => !byName[d] || built[d]);
      if (ready) {
        order.push(m);
        built[m.name] = true;
        progress = true;
        return false;
      }
      return true;
    });
  }
  return { order, cycle: remaining }; // cycle = modules that couldn't be ordered
}

// Step 1: LLM decomposes the spec into modules + dependencies.
async function planGraph(llm, spec) {
  const sys =
    "You are a Verilog design planner. Decompose the request into synthesizable modules. " +
    'Return ONLY JSON in this shape, no prose: ' +
    '{"modules":[{"name":"<verilog_module_name>","purpose":"<one line>","dependsOn":["<names of modules in this list it directly instantiates>"]}]} ' +
    "Leaf modules have an empty dependsOn. Do NOT include testbenches.";
  const reply = await callLLM({
    ...llm,
    system: sys,
    messages: [{ role: "user", content: spec }],
  });
  const s = reply.replace(/```json|```/g, "");
  const obj = JSON.parse(s.slice(s.indexOf("{"), s.lastIndexOf("}") + 1));
  return (obj.modules || [])
    .map((m) => ({
      name: String((m && m.name) || "").trim(),
      purpose: String((m && m.purpose) || ""),
      dependsOn: Array.isArray(m && m.dependsOn) ? m.dependsOn.map(String) : [],
    }))
    .filter((m) => m.name);
}

// Render the module manifest as a compact reference block for the LLMs, so they
// know the whole design and the status of every module (built / testbenched).
function manifestReference(manifest) {
  if (!manifest || !manifest.length) return "";
  const vlabel = (v) =>
    v === "functional" ? "functionally verified"
      : v === "smoke" ? "smoke-checked (structure only, function unproven)"
      : "unverified";
  const lines = manifest.map(
    (m) =>
      "- " +
      m.name +
      ": " +
      (m.built ? "BUILT" : "not built yet") +
      ", " +
      vlabel(m.verification) +
      (m.tier ? " [" + m.tier + " tier]" : "") +
      (m.complexity != null ? ", complexity " + m.complexity + "/100" : "") +
      (m.effectiveComplexity != null && m.effectiveComplexity !== m.complexity
        ? " (effective " + m.effectiveComplexity + " incl. unverified deps)"
        : "")
  );
  return (
    "\n\nPROJECT MODULE STATUS (reference — the full module list and where this one fits):\n" +
    lines.join("\n")
  );
}

// Step 3: build one module, compile-checking it (with retries).
// onAttempt(ev) (optional) is called after each compile so callers can stream
// retries live: { type:'attempt', module, attempt, maxTries, ok, error }.
// manifest (optional) is the whole-design status list, passed as LLM reference.
async function buildModule(llm, spec, mod, builtFiles, maxTries, onAttempt, manifest) {
  maxTries = maxTries || 3;
  const depNames = (mod.dependsOn || []).filter((n) => builtFiles[n]);
  const depContext = depNames
    .map((n) => "--- " + n + ".v (already built) ---\n" + builtFiles[n])
    .join("\n\n");
  const statusRef = manifestReference(manifest);

  let lastErr = "";
  for (let attempt = 1; attempt <= maxTries; attempt++) {
    const sys =
      "You are a Verilog module writer. Write exactly ONE synthesizable Verilog module named '" +
      mod.name +
      "'. Output ONLY that module inside a ```verilog code block — no prose, no testbench.";
    let user =
      "Design spec:\n" +
      spec +
      "\n\nWrite the module '" +
      mod.name +
      "' — " +
      mod.purpose +
      ".";
    if (statusRef) user += statusRef;
    if (depContext)
      user +=
        "\n\nIt may instantiate these already-built modules (do not redefine them):\n\n" +
        depContext;
    if (lastErr)
      user +=
        "\n\nYour previous version FAILED to compile with Icarus Verilog:\n" +
        lastErr +
        "\n\nReturn a corrected version of module '" +
        mod.name +
        "'.";

    const reply = await callLLM({
      ...llm,
      system: sys,
      messages: [{ role: "user", content: user }],
    });
    const code = extractVerilog(reply);

    // Compile-check: this module + every module built so far (all its deps
    // are present); elaborate THIS module as the top.
    const files = Object.keys(builtFiles).map((n) => ({
      name: n + ".v",
      code: builtFiles[n],
    }));
    files.push({ name: mod.name + ".v", code });
    const res = await compileVerilog(files, mod.name);

    if (onAttempt)
      onAttempt({
        type: "attempt",
        module: mod.name,
        attempt: attempt,
        maxTries: maxTries,
        ok: res.ok,
        error: res.ok ? "" : String(res.output || "").slice(0, 300),
      });

    if (res.ok) return { name: mod.name, code, attempts: attempt, ok: true };
    lastErr = res.output;
  }
  return { name: mod.name, code: null, ok: false, attempts: maxTries, error: lastErr };
}

// --- Complexity: code computes the evidence, the LLM produces the verdict -----

// Step 1 of the pipeline: deterministic static feature vector from the code.
// Regex-based (no extra deps) — approximate but reproducible, so scores are
// comparable across modules and stable across re-runs.
function computeFeatures(code) {
  // Strip comments so they don't inflate counts.
  const src = String(code || "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
  const count = (re) => (src.match(re) || []).length;

  const edges = src.match(/(?:pos|neg)edge\s+(\w+)/g) || [];
  const clockSignals = {};
  let asyncReset = false;
  edges.forEach((e) => {
    const sig = e.replace(/(?:pos|neg)edge\s+/, "");
    if (/rst|reset/i.test(sig)) asyncReset = true; // async reset, not a clock
    else clockSignals[sig] = true;
  });

  // Rough submodule instantiations: "Name inst (" at statement start, minus keywords.
  const KEYWORDS = /^(if|for|while|case|casez|casex|always|initial|assign|module|function|task|begin|generate|else|posedge|negedge|input|output|inout|wire|reg|logic|parameter|localparam|integer|genvar)$/;
  const instMatches = src.match(/(?:^|\n)\s*([A-Za-z_]\w*)\s+(?:#\([^)]*\)\s*)?[A-Za-z_]\w*\s*\(/g) || [];
  const submodules = instMatches.filter((m) => {
    const first = (m.trim().match(/^([A-Za-z_]\w*)/) || [])[1] || "";
    return !KEYWORDS.test(first);
  }).length;

  // Widest bus [N:0] -> N+1 bits.
  let maxWidth = 1;
  (src.match(/\[\s*(\d+)\s*:\s*0\s*\]/g) || []).forEach((w) => {
    const n = parseInt((w.match(/(\d+)/) || [])[1], 10);
    if (n + 1 > maxWidth) maxWidth = n + 1;
  });

  // Rough FSM state count: items inside case…endcase blocks.
  let caseItems = 0;
  (src.match(/\bcase[xz]?\b([\s\S]*?)\bendcase\b/g) || []).forEach((blk) => {
    caseItems += (blk.match(/(?:^|\n)\s*[^:\n]+:/g) || []).length;
  });

  // Does the module COMPUTE/transform data? Strip bus ranges first so [WIDTH-1:0]
  // doesn't count the '-' as arithmetic. Over-flagging is the safe side (it routes
  // a module to functional testing, which is what we want for anything that computes).
  const noRanges = src.replace(/\[[^\]]*\]/g, "");
  const addSub = (noRanges.match(/[+\-]/g) || []).length;
  const shifts = (src.match(/<<|>>/g) || []).length;
  const mulDiv = count(/[*/%]/g);
  const hasComputation = mulDiv > 0 || addSub > 0 || shifts > 0;

  return {
    loc: (src.split("\n").filter((l) => l.trim())).length,
    alwaysBlocks: count(/\balways\b/g),
    hasClock: edges.length > 0,
    clocks: Object.keys(clockSignals).length,
    asyncReset: asyncReset,
    ifCount: count(/\bif\s*\(/g),
    caseCount: count(/\bcase[xz]?\b/g),
    caseItems: caseItems,
    mulDiv: mulDiv,
    addSub: addSub,
    shifts: shifts,
    hasComputation: hasComputation,
    submodules: submodules,
    maxWidth: maxWidth,
    hasMemory: /\breg\s*(?:\[[^\]]*\])?\s*\w+\s*\[/.test(src),
  };
}

// Floor-tier routing: does this module need a functional (oracle) test, or is the
// code-only floor tier enough? Anything that COMPUTES gets functional testing
// regardless of score (that's where silent calculation errors hide); otherwise a
// numeric cutoff separates trivial select/wiring/register logic (smoke) from the
// rest (functional). Cutoff is configurable via FLOOR_CUTOFF (default 22).
const FLOOR_CUTOFF = parseInt(process.env.FLOOR_CUTOFF, 10) || 22;
function routeTier(score, features) {
  if (features && features.hasComputation) return "functional"; // computes data → needs an oracle
  if (score >= FLOOR_CUTOFF) return "functional";
  return "smoke"; // trivial, non-computing → code-only floor tier is enough
}

// Step 3 (fallback): pure-code weighted baseline on a 1–100 scale. Used when the
// LLM is unavailable so there's always a number.
function baselineScore(f) {
  let s = 5; // base
  if (f.hasClock) s += 10;                          // sequential logic
  if (f.clocks > 1) s += 15;                         // multiple clock domains (CDC risk)
  if (f.asyncReset) s += 5;                          // async reset adds care
  s += Math.min(30, (f.ifCount + f.caseItems) * 3);  // branchiness
  if (f.mulDiv > 0) s += 15;                          // multipliers/dividers
  s += Math.min(20, f.submodules * 5);               // hierarchy
  if (f.hasMemory) s += 15;                           // memories/RAM
  if (f.maxWidth >= 32) s += 10;                      // wide datapaths
  else if (f.maxWidth >= 16) s += 5;
  s += Math.min(15, Math.floor(f.loc / 10));         // sheer size
  return Math.max(1, Math.min(100, Math.round(s)));
}

// After a module is built, the Builder describes it for the Verifier — the
// INTERFACE + CONVENTIONS, deliberately WITHOUT the source code, so the Verifier
// reviews it against the spec's intent (not by re-reading the implementation).
// Also produces the LLM's OWN 1–5 complexity rating from the full code — with NO
// code baseline shown, so it's an independent estimate. buildDesign then averages
// it with the code-computed score.
// Returns a structured summary object (complexity = the LLM's own estimate).
async function summarizeModule(llm, mod, code) {
  const sys =
    "You are the Builder describing a Verilog module you just wrote, for a separate Verifier " +
    "who will NOT see the source code. Read the FULL code and report its interface and conventions. " +
    "Also give your OWN internal-logic complexity rating from 1 to 100 (1=trivial, 100=extremely complex), " +
    "judging the whole module — datapath width, branching, FSM depth, arithmetic, clock domains, " +
    "resets, and conceptual difficulty. Rate ONLY this module's own logic, not modules it instantiates. " +
    "Do NOT include any Verilog code. Return ONLY JSON in exactly this shape:\n" +
    '{"module":"<name>",' +
    '"ports":[{"name":"<port>","direction":"input|output|inout","width":"<e.g. 1, [7:0], [WIDTH-1:0]>"}],' +
    '"parameters":[{"name":"<param>","default":"<value or n/a>"}],' +
    '"intendedFunction":"<1-3 sentences on what the module does>",' +
    '"clockReset":{' +
    '"clockTrigger":"<e.g. posedge clk, negedge clk, or none (purely combinational)>",' +
    '"clockRate":"<how fast the clock advances work, e.g. one result per clock; or none if combinational>",' +
    '"clocks":"<single (clk) or multiple (list them)>",' +
    '"resetType":"<synchronous | asynchronous | none>",' +
    '"resetTrigger":"<e.g. active-low rst_n, active-high rst, or none>"},' +
    '"complexity":<integer 1-100>,' +
    '"complexityRationale":"<one line justifying the score>"}';
  const user =
    "Module '" + mod.name + "' (intended purpose: " + (mod.purpose || "") + "):\n\n" +
    "```verilog\n" + code + "\n```";
  try {
    const reply = await callLLM({ ...llm, system: sys, messages: [{ role: "user", content: user }] });
    const s = reply.replace(/```json|```/g, "");
    const obj = JSON.parse(s.slice(s.indexOf("{"), s.lastIndexOf("}") + 1));
    obj.module = obj.module || mod.name;
    const c = parseInt(obj.complexity, 10);
    obj.complexity = c >= 1 && c <= 100 ? c : null; // null => LLM value unusable
    return obj;
  } catch (e) {
    // Fallback: never block the build on a summary parse failure. complexity=null
    // means "no LLM estimate"; buildDesign falls back to the code score alone.
    return {
      module: mod.name,
      intendedFunction: mod.purpose || "",
      complexity: null,
      complexityRationale: "LLM rating unavailable",
      note: "summary unavailable",
    };
  }
}

// Full run. onProgress(ev) is called as modules start/finish (for streaming).
async function buildDesign(llm, spec, onProgress) {
  const modules = await planGraph(llm, spec);
  const { order, cycle } = topoSort(modules);
  if (onProgress)
    onProgress({ type: "plan", order: order.map((m) => m.name), cycle: cycle.map((m) => m.name) });

  // Manifest of EVERY planned module (built order + any that couldn't be ordered),
  // tracking build + testbench status. Kept as LLM reference, not user-facing.
  // testbenched stays false until the simulation layer is wired to run testbenches.
  const manifest = order.concat(cycle).map((m) => ({
    name: m.name,
    built: false,
    testbenched: false,
    dependsOn: (m.dependsOn || []).slice(),
  }));
  const manifestByName = {};
  manifest.forEach((x) => (manifestByName[x.name] = x));

  const builtFiles = {};
  const results = [];
  const summaries = [];
  for (const mod of order) {
    if (onProgress) onProgress({ type: "building", module: mod.name });
    const r = await buildModule(llm, spec, mod, builtFiles, 3, onProgress, manifest);
    if (r.ok) {
      builtFiles[r.name] = r.code;
      // Complexity: TWO independent estimates, then averaged.
      //   codeScore  — deterministic formula over the static feature vector
      //   llmScore   — the LLM's own 1–100 from reading the full module (no baseline shown)
      const features = computeFeatures(r.code);
      const codeScore = baselineScore(features);
      // Builder hands the Verifier a description of the module (NOT the code).
      const summary = await summarizeModule(llm, mod, r.code);
      summaries.push(summary);
      const llmScore = summary.complexity != null ? summary.complexity : codeScore;
      // Average the two (one decimal). If the LLM estimate is missing, this is just codeScore.
      const finalScore = Math.round(((llmScore + codeScore) / 2) * 10) / 10;
      // Route to a verification tier: smoke (code-only floor) vs functional (oracle).
      const tier = routeTier(finalScore, features);
      const entry = manifestByName[mod.name];
      if (entry) {
        entry.built = true;
        entry.complexity = finalScore;
        entry.llmComplexity = summary.complexity; // may be null
        entry.codeComplexity = codeScore;
        entry.complexityRationale = summary.complexityRationale || "";
        entry.features = features;
        entry.hasComputation = features.hasComputation;
        entry.tier = tier;
      }
      if (onProgress)
        onProgress({ type: "summary", module: mod.name, summary, complexity: finalScore });

      // FLOOR-TIER TEST (code-only, no testbench, no oracle): structural lint.
      // Only for smoke-tier modules. Functional-tier modules await the oracle
      // testbench (not built yet), so they stay 'unverified' for now.
      //   verification: 'unverified' | 'smoke' | 'functional'
      //   Only 'functional' counts as trusted for pruning / fault isolation.
      if (entry) {
        if (tier === "smoke") {
          const floorFiles = Object.keys(builtFiles).map((n) => ({ name: n + ".v", code: builtFiles[n] }));
          // Floor tier = structural lint + GENERIC SYNTHESIS (default for every
          // floor-level module). Run both; they're local tools ($0, no API).
          const lint = await lintVerilog(floorFiles, mod.name);
          const synth = await synthCheck(floorFiles, mod.name);
          entry.lintClean = lint.clean;
          entry.lintOutput = lint.output ? lint.output.slice(0, 500) : "";
          entry.synthesizable = synth.synthesizable; // true | false | null (yosys absent)
          entry.synthAvailable = synth.available;
          entry.synthOutput = synth.output ? synth.output.slice(0, 500) : "";

          // Floor SMOKE TESTBENCH (code-generated, NO oracle): clock/reset gen +
          // random stimulus + X-check on outputs. Catches undriven/uninitialized
          // outputs, incomplete logic. Runs the module + its built deps + the TB.
          let smokePassed = null, smokeMarkers = "";
          try {
            const iface = parseInterface(r.code);
            if (iface) {
              const stb = genSmokeTestbench(iface);
              const simFiles = Object.keys(builtFiles).map((n) => ({ name: n + ".v", code: builtFiles[n] }));
              simFiles.push({ name: "smoke_tb.v", code: stb.code });
              const sim = await runTestbench(simFiles, stb.top);
              smokeMarkers = (sim.output.match(/SMOKE_[A-Z]+[^\n]*/g) || []).join("; ").slice(0, 400);
              if (/SMOKE_PASS/.test(sim.output)) smokePassed = true;
              else if (/SMOKE_FAIL|SMOKE_X/.test(sim.output)) smokePassed = false;
              else smokePassed = sim.ok ? null : false; // inconclusive vs couldn't run
            }
          } catch (e) { smokeMarkers = String((e && e.message) || e); }
          entry.smokeSimPassed = smokePassed;   // true | false | null (inconclusive)
          entry.smokeSimOutput = smokeMarkers;

          // Floor passes => 'smoke' only if lint is clean AND generic synthesis
          // succeeds AND the smoke sim didn't hard-fail. Missing tools / inconclusive
          // sim don't block (they degrade), only a real failure does.
          const synthOk = synth.available ? synth.synthesizable === true : true;
          const smokeOk = smokePassed !== false;
          entry.verification = lint.clean && synthOk && smokeOk ? "smoke" : "unverified";
        } else {
          // functional tier — the oracle testbench isn't built yet (TODO).
          entry.verification = "unverified";
        }
        // 'functional' is set only by the (future) oracle tier; testbenched mirrors it.
        entry.testbenched = entry.verification === "functional";
        if (onProgress)
          onProgress({
            type: "floor",
            module: mod.name,
            tier: tier,
            verification: entry.verification,
            lintClean: entry.lintClean,
            lintReason: entry.lintOutput ? String(entry.lintOutput).split("\n")[0] : "",
            synthesizable: entry.synthesizable,
            synthAvailable: entry.synthAvailable,
            synthReason: entry.synthOutput ? String(entry.synthOutput).split("\n")[0] : "",
            smokeSimPassed: entry.smokeSimPassed,
            smokeSimReason: entry.smokeSimOutput || "",
          });
      }
    }
    results.push(r);
    if (onProgress)
      onProgress({
        type: "built",
        module: mod.name,
        ok: r.ok,
        attempts: r.attempts,
        error: r.error,
      });
    if (!r.ok) break; // stop the run if a module can't be made to compile
  }

  // Effective complexity: a module's own complexity PLUS the effective complexity
  // of every module it instantiates that is NOT FUNCTIONALLY verified — because
  // that unverified logic also runs when this module runs. Only a FUNCTIONALLY
  // verified child (passed an oracle testbench) is trusted and pruned to a black
  // box; a smoke-passed child is structurally OK but its function is unproven, so
  // it still counts. Computed bottom-up (order is dependencies-first).
  const isTrusted = (m) => m && m.verification === "functional";
  for (const mod of order) {
    const entry = manifestByName[mod.name];
    if (!entry || !entry.built || entry.complexity == null) continue;
    let eff = entry.complexity;
    const added = [];
    (mod.dependsOn || []).forEach((dep) => {
      const child = manifestByName[dep];
      if (child && child.built && !isTrusted(child) && child.complexity != null) {
        const childEff = child.effectiveComplexity != null ? child.effectiveComplexity : child.complexity;
        eff += childEff;
        added.push({ name: dep, added: childEff });
      }
    });
    entry.effectiveComplexity = Math.round(eff * 10) / 10;
    entry.complexityDeps = added; // not-yet-functionally-verified children that contributed
  }

  return { results, cycle: cycle.map((m) => m.name), files: builtFiles, summaries, manifest };
}

module.exports = { buildDesign, planGraph, topoSort, buildModule, summarizeModule, computeFeatures, baselineScore };
