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
const { compileVerilog } = require("./compile");

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

// Step 3: build one module, compile-checking it (with retries).
// onAttempt(ev) (optional) is called after each compile so callers can stream
// retries live: { type:'attempt', module, attempt, maxTries, ok, error }.
async function buildModule(llm, spec, mod, builtFiles, maxTries, onAttempt) {
  maxTries = maxTries || 3;
  const depNames = (mod.dependsOn || []).filter((n) => builtFiles[n]);
  const depContext = depNames
    .map((n) => "--- " + n + ".v (already built) ---\n" + builtFiles[n])
    .join("\n\n");

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

// Full run. onProgress(ev) is called as modules start/finish (for streaming).
async function buildDesign(llm, spec, onProgress) {
  const modules = await planGraph(llm, spec);
  const { order, cycle } = topoSort(modules);
  if (onProgress)
    onProgress({ type: "plan", order: order.map((m) => m.name), cycle: cycle.map((m) => m.name) });

  const builtFiles = {};
  const results = [];
  for (const mod of order) {
    if (onProgress) onProgress({ type: "building", module: mod.name });
    const r = await buildModule(llm, spec, mod, builtFiles, 3, onProgress);
    if (r.ok) builtFiles[r.name] = r.code;
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

  return { results, cycle: cycle.map((m) => m.name), files: builtFiles };
}

module.exports = { buildDesign, planGraph, topoSort, buildModule };
