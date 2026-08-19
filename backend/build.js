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
    "You are a Verilog design planner. The design specification is ORGANIZED BY MODULE: it has one " +
    "'## <module_name>' section per module (plus a '## Overview'). Return the module dependency graph using " +
    "EXACTLY those modules — the SAME names and the SAME set. Do NOT invent, rename, merge, or split modules, " +
    "and do NOT add a module the spec doesn't define. The module names you return MUST match the spec's " +
    "'## <module_name>' headings verbatim. For each module, set dependsOn to the other listed modules it " +
    "directly instantiates.\n" +
    "If the request is NOT a digital-hardware / Verilog design (software, scripts, essays, general " +
    'questions), return exactly {"modules":[]} and nothing else.\n' +
    "ONLY IF the spec is NOT organized into '## <module>' sections: decompose it yourself into small " +
    "single-responsibility modules (separate datapath from control, factor out reusable blocks).\n" +
    'Return ONLY JSON in this shape, no prose: ' +
    '{"modules":[{"name":"<verilog_module_name>","purpose":"<one line>","dependsOn":["<names of modules in this list it directly instantiates>"]}]} ' +
    "Leaf modules have an empty dependsOn; the top module depends on the submodules it instantiates. " +
    "Do NOT include testbenches.";
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

// ---- Per-module spec slice -------------------------------------------------
// Specs are organized by module ('## <module_name>' sections), so the Builder only
// needs its own module's section (plus the title + Overview for minimal context)
// instead of the whole spec every time. Falls back to the full spec if the
// module's section can't be isolated.
function specSection(spec, matches) {
  const lines = String(spec || "").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const hm = /^(#{1,6})\s+(.*)$/.exec(lines[i]);
    if (hm && matches(hm[2])) {
      const level = hm[1].length;
      const out = [lines[i]];
      for (let j = i + 1; j < lines.length; j++) {
        const nh = /^(#{1,6})\s+/.exec(lines[j]);
        if (nh && nh[1].length <= level) break;
        out.push(lines[j]);
      }
      return out.join("\n").trim();
    }
  }
  return "";
}
function builderSpec(spec, name) {
  if (!spec || !name) return spec;
  const esc = String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const nameRe = new RegExp("\\b" + esc + "\\b");
  const modSec = specSection(spec, (t) => nameRe.test(t));
  if (!modSec) return spec; // couldn't isolate this module -> send the whole spec
  const title = (String(spec).match(/^#\s+.*$/m) || [""])[0];
  const overview = specSection(spec, (t) => /^overview$/i.test(t.trim()));
  return [title, overview, modSec].filter(Boolean).join("\n\n");
}

// ---- Deterministic module header (option 1) --------------------------------
// The Builder keeps hardcoding widths and dropping parameters, so we GENERATE the
// header (module decl + parameters + port list) from the spec's interface and let
// the model write only the body. The header can't be wrong because the model never
// writes it. Ports use SystemVerilog 'logic' (safe under -g2012 / read_verilog -sv
// for both combinational `assign` and sequential `always` outputs).

// Ask the LLM for just this module's interface as JSON (a small, reliable task).
async function genInterfaceContract(llm, spec, mod) {
  const sys =
    "Extract ONLY the interface of the Verilog module '" + mod.name + "' from the design spec. " +
    "Return JSON ONLY (no prose, no code), exactly this shape:\n" +
    '{"parameters":[{"name":"<PARAM>","default":"<value>"}],' +
    '"ports":[{"name":"<port>","direction":"input|output|inout","width":"1 | [MSB:LSB] | PARAM"}],' +
    '"reset":{"type":"synchronous|asynchronous|none","polarity":"active-low|active-high|none"}}\n' +
    "Use EXACTLY the parameter names/defaults and port names, directions and widths the spec states for " +
    "THIS module. If the spec lists no parameters, use []. width is \"1\" for a single bit, \"[7:0]\" for a " +
    "bus, or a parameter name like \"DATA_WIDTH\". For reset, report the EXACT type and polarity the spec " +
    "states (or none if the module has no reset).";
  const user = "Design spec:\n" + builderSpec(spec, mod.name) + "\n\nModule: " + mod.name + (mod.purpose ? " \u2014 " + mod.purpose : "");
  try {
    const reply = await callLLM({ ...llm, system: sys, messages: [{ role: "user", content: user }] });
    const t = reply.replace(/```json|```/g, "");
    const obj = JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1));
    const ports = Array.isArray(obj.ports) ? obj.ports.filter((p) => p && p.name) : [];
    const parameters = Array.isArray(obj.parameters) ? obj.parameters.filter((p) => p && p.name) : [];
    const reset = obj.reset && typeof obj.reset === "object" ? obj.reset : null;
    return { parameters, ports, reset }; // reset kept even when there are no ports
  } catch (e) { return null; }
}

// Normalize a width spec into Verilog range syntax ("" for 1 bit).
function normWidth(w) {
  if (w == null) return "";
  w = String(w).trim();
  if (!w || w === "1") return "";
  if (/^\[.*\]$/.test(w)) return w;                 // already [MSB:LSB]
  if (/^\d+$/.test(w)) { const n = parseInt(w, 10); return n > 1 ? "[" + (n - 1) + ":0]" : ""; }
  if (/^[A-Za-z_]\w*$/.test(w)) return "[" + w + "-1:0]"; // a parameter name
  return "[" + w + "]";
}

// Build the exact module header from the contract (module + params + ports).
function buildHeader(name, contract) {
  if (!contract || !contract.ports || !contract.ports.length) return null;
  let h = "module " + name;
  const params = contract.parameters || [];
  if (params.length) {
    h += " #(\n" + params.map((p) => {
      const d = (p.default != null && String(p.default).trim() !== "") ? p.default : "1";
      return "  parameter " + p.name + " = " + d;
    }).join(",\n") + "\n)";
  }
  h += " (\n" + contract.ports.map((p) => {
    const dir = /out/i.test(p.direction) ? "output" : (/inout/i.test(p.direction) ? "inout" : "input");
    const w = normWidth(p.width);
    return "  " + dir + " logic " + (w ? w + " " : "") + p.name;
  }).join(",\n") + "\n);";
  return h;
}

// Split a generated module into its body (between the header ';' and 'endmodule'),
// so we can force OUR header and keep only the model's body. Paren-depth aware, so
// it handles a '#(...)' parameter list. Returns null if it can't be parsed safely.
function splitHeaderBody(code) {
  const start = code.search(/\bmodule\b/);
  if (start < 0) return null;
  let depth = 0, seenOpen = false, headerEnd = -1;
  for (let i = start; i < code.length; i++) {
    const c = code[i];
    if (c === "(") { depth++; seenOpen = true; }
    else if (c === ")") { depth--; }
    else if (c === ";" && depth === 0 && seenOpen) { headerEnd = i; break; }
  }
  if (headerEnd < 0) return null;
  const endIdx = code.lastIndexOf("endmodule");
  if (endIdx < 0 || endIdx <= headerEnd) return null;
  return { body: code.slice(headerEnd + 1, endIdx).trim() };
}

// Step 3: build one module, compile-checking it (with retries).
// onAttempt(ev) (optional) is called after each compile so callers can stream
// retries live: { type:'attempt', module, attempt, maxTries, ok, error }.
// manifest (optional) is the whole-design status list, passed as LLM reference.
async function buildModule(llm, spec, mod, builtFiles, maxTries, onAttempt, manifest, header) {
  maxTries = maxTries || 3;
  const depNames = (mod.dependsOn || []).filter((n) => builtFiles[n]);
  const depContext = depNames
    .map((n) => "--- " + n + ".v (already built) ---\n" + builtFiles[n])
    .join("\n\n");
  const statusRef = manifestReference(manifest);

  let lastErr = "";
  for (let attempt = 1; attempt <= maxTries; attempt++) {
    const sys = (header ?
      ("You are a Verilog module writer. You are given the EXACT module header (name, parameters, ports) — " +
       "you MUST reproduce it VERBATIM and NOT change any parameter or port. Write ONLY the module BODY (the " +
       "internal logic) between the header and 'endmodule'. Match the spec's behavior, clock edge, and reset " +
       "style exactly. For a SYNCHRONOUS reset use 'always @(posedge clk)' with the reset checked INSIDE (do " +
       "NOT put reset in the sensitivity list); for ASYNCHRONOUS include the reset edge. Ports are declared " +
       "'logic'; drive sequential outputs in an always block and combinational outputs with assign. Output the " +
       "COMPLETE module (header + body + endmodule) inside one ```verilog code block — no prose, no testbench.") :
      ("You are a Verilog module writer. Write exactly ONE synthesizable Verilog module named '" +
      mod.name +
      "' that EXACTLY matches the design specification.\n" +
      "STRICT SPEC ADHERENCE — a mismatch with the spec is treated as an error and sent back to you, so get " +
      "these right the FIRST time:\n" +
      "- Port names, directions, and bit-widths exactly as the spec states.\n" +
      "- Clock edge (posedge vs negedge) as specified.\n" +
      "- Reset TYPE and POLARITY exactly. For a SYNCHRONOUS reset, sample it INSIDE 'always @(posedge clk)' " +
      "and do NOT put the reset in the sensitivity list. For an ASYNCHRONOUS reset, include the reset edge in " +
      "the sensitivity list (e.g. 'always @(posedge clk or negedge rst_n)'). Match active-high vs active-low.\n" +
      "- The behavior, parameters, and edge cases the spec describes for THIS module.\n" +
      "Re-read this module's section of the spec, then implement it precisely. Output ONLY the module inside a " +
      "```verilog code block — no prose, no testbench.")) + RESET_REF;
    let user =
      "Design spec:\n" +
      builderSpec(spec, mod.name) +
      "\n\nWrite the module '" +
      mod.name +
      "' — " +
      mod.purpose +
      ".";
    if (header)
      user += "\n\nUSE THIS EXACT MODULE HEADER (copy it verbatim; do NOT change any parameter or port):\n" +
        "```verilog\n" + header + "\n  // write the module body here\nendmodule\n```";
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
    let code = extractVerilog(reply);
    if (header) {
      // Force OUR header (guaranteed-correct params/ports) and keep only the body.
      const parts = splitHeaderBody(code);
      if (parts) code = header + "\n" + parts.body + "\nendmodule";
    }

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
// Low temperature for the BUILDER LLM (any model) — steadier instruction-following.
// The Verifier keeps its default temperature. Configurable via BUILDER_TEMPERATURE.
const BUILDER_TEMP = process.env.BUILDER_TEMPERATURE != null ? parseFloat(process.env.BUILDER_TEMPERATURE) : 0.2;

// Reset few-shot: show BOTH correct patterns and the specific wrong one, so the
// model matches the spec's reset type instead of defaulting to asynchronous.
const RESET_REF =
  "\n\nRESET STYLE \u2014 match the spec EXACTLY (this is the most common mistake). Examples:\n" +
  "  SYNCHRONOUS reset (reset is NOT in the sensitivity list):\n" +
  "    always @(posedge clk) begin\n" +
  "      if (!rst_n) q <= '0;   // active-low reset checked INSIDE the block\n" +
  "      else        q <= d;\n" +
  "    end\n" +
  "  ASYNCHRONOUS reset (the reset edge IS in the sensitivity list):\n" +
  "    always @(posedge clk or negedge rst_n) begin\n" +
  "      if (!rst_n) q <= '0; else q <= d;\n" +
  "    end\n" +
  "  WRONG: writing 'always @(posedge clk or negedge rst_n)' when the spec asks for a SYNCHRONOUS reset. " +
  "Do NOT default to asynchronous \u2014 use exactly the reset TYPE the spec states, and match active-low " +
  "(rst_n / !rst_n) vs active-high polarity.";
function routeTier(score, features, cutoff) {
  cutoff = cutoff || FLOOR_CUTOFF;
  if (features && features.hasComputation) return "functional"; // computes data → needs an oracle
  if (score >= cutoff) return "functional";
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

// Pick the testbench's top module name from generated TB code (the module that
// isn't the DUT), so we can elaborate it even if the LLM named it unexpectedly.
function tbTopName(code, dutName) {
  const names = [];
  const re = /\bmodule\s+(\w+)/g;
  let m;
  while ((m = re.exec(code || ""))) names.push(m[1]);
  return names.find((n) => n !== dutName) || "tb_" + dutName;
}

// FUNCTIONAL ORACLE TESTBENCH (higher tiers). The VERIFIER LLM (not the Builder)
// writes a self-checking testbench from the module's CONTRACT (spec + interface) —
// NOT its implementation — so the oracle is independent of the code AND of the
// model that wrote the code. Expected values come from the SPEC (authoritative);
// the summary is used only for the interface (ports/params/clock-reset). It drives
// representative + edge inputs and prints FUNC_PASS / FUNC_FAIL. Returns
// { code, top } or null.
async function genFunctionalTestbench(llm, mod, spec, summary) {
  const ports = (summary && summary.ports) || [];
  const params = (summary && summary.parameters) || [];
  const clockReset = (summary && summary.clockReset) || {};
  const intended = (summary && summary.intendedFunction) || mod.purpose || "";
  const sys =
    "You are a hardware verification engineer. Write a SELF-CHECKING Verilog testbench for a module you must " +
    "NOT modify or redefine. You are given ONLY the module's interface and its intended behavior (the spec) — " +
    "you do NOT see its implementation, so your test is an INDEPENDENT oracle. The testbench MUST: " +
    "(1) instantiate the module by its exact name and port names; " +
    "(2) generate a clock and apply the reset sequence if the module is sequential; " +
    "(3) drive a range of representative inputs AND edge cases; " +
    "(4) for each, compute the EXPECTED output FROM THE SPECIFICATION (the spec is authoritative — the " +
    "'intended function' summary is only a hint for the interface, do NOT trust it over the spec) and compare it to the actual output; " +
    "(5) on a mismatch, print a line starting with 'FUNC_FAIL' including inputs, expected, and actual; " +
    "(6) at the very end, print 'FUNC_PASS' only if every check passed; (7) call $finish. " +
    "Name the testbench module 'tb_" + mod.name + "'. Output ONLY the testbench inside a ```verilog code block — " +
    "no prose, and do NOT include the module under test.";
  const user =
    "Module under test: " + mod.name + "\n" +
    "Ports: " + JSON.stringify(ports) + "\n" +
    "Parameters: " + JSON.stringify(params) + "\n" +
    "Clock/reset: " + JSON.stringify(clockReset) + "\n" +
    "Intended function: " + intended + "\n\n" +
    "Full design specification (the source of truth for expected outputs):\n" + spec;
  const reply = await callLLM({ ...llm, system: sys, messages: [{ role: "user", content: user }] });
  const code = extractVerilog(reply);
  if (!code) return null;
  return { code: code, top: tbTopName(code, mod.name) };
}

// Verifier spec-conformance check for ONE module, from its summary (not the code).
// Checks ports/widths, intended behavior, and clock/reset style (sync vs async,
// active level) against the spec. Returns { conforms:bool, issues } or null.
async function checkConformance(llm, spec, mod, summary) {
  const sys =
    "You are the Verifier. You are given the relevant design-spec section and ONE module's summary " +
    "(interface, intended function, clock/reset). Decide whether the module CONFORMS to what the spec " +
    "requires for THIS module. Check ports/widths, intended behavior, and the clock/reset style " +
    "(synchronous vs asynchronous, active-high vs active-low).\n" +
    "CRITICAL: The module's NAME is assigned by the design plan and MAY differ from names used in the spec " +
    "(a design is split into sub-modules with their own names). Do NOT flag the module name as a violation " +
    "and NEVER ask to rename it — the Builder cannot and must not change the module name. Judge ONLY the " +
    "ports, behavior, and reset. Return ONLY JSON: " +
    '{"conforms": true|false, "issues": "<if false: the specific PORT/BEHAVIOR/RESET violations the Builder must fix; else empty>"}';
  const user =
    "Design spec (this module's section):\n" + builderSpec(spec, mod.name) +
    "\n\nModule '" + mod.name + "'" + (mod.purpose ? " \u2014 " + mod.purpose : "") +
    " summary:\n" + JSON.stringify(summary, null, 2);
  try {
    const reply = await callLLM({ ...llm, system: sys, messages: [{ role: "user", content: user }] });
    const s = reply.replace(/```json|```/g, "");
    const obj = JSON.parse(s.slice(s.indexOf("{"), s.lastIndexOf("}") + 1));
    return { conforms: obj.conforms === true, issues: String(obj.issues || "") };
  } catch (e) {
    return null; // inconclusive — don't loop on a parse failure
  }
}

// Rebuild a module to fix SPEC VIOLATIONS the Verifier found; compile-checked.
// Returns corrected code or null.
// Deterministic async->sync reset transform: drop the reset edge from an always
// sensitivity list, e.g. "@(posedge clk or negedge rst_n)" -> "@(posedge clk)".
// The "if (!rst_n) ..." logic already inside the block then acts as a SYNCHRONOUS
// reset. Leaves already-sync code and non-reset signals untouched.
// True if the code uses an ASYNCHRONOUS reset (a reset edge in the sensitivity list).
function hasAsyncReset(code) {
  const c = String(code || "");
  return /@\s*\(\s*(?:pos|neg)edge\s+\w+\s*(?:or|,)\s*(?:pos|neg)edge\s+\w*(?:rst|reset)\w*/i.test(c) ||
         /@\s*\(\s*(?:pos|neg)edge\s+\w*(?:rst|reset)\w*\s*(?:or|,)\s*(?:pos|neg)edge/i.test(c);
}
function stripAsyncReset(code) {
  return String(code)
    // clock first:  @(posedge clk <or|,> negedge rst)  ->  @(posedge clk)
    .replace(/(@\s*\(\s*(?:pos|neg)edge\s+\w+)\s*(?:or|,)\s*(?:pos|neg)edge\s+\w*(?:rst|reset)\w*\s*(\))/gi, "$1$2")
    // reset first:  @(negedge rst <or|,> posedge clk)  ->  @(posedge clk)
    .replace(/@\s*\(\s*(?:pos|neg)edge\s+\w*(?:rst|reset)\w*\s*(?:or|,)\s*((?:pos|neg)edge\s+\w+)\s*\)/gi, "@($1)");
}

async function fixModuleConformance(llm, spec, mod, builtFiles, issues) {
  const depNames = (mod.dependsOn || []).filter((n) => builtFiles[n]);
  const depContext = depNames
    .map((n) => "--- " + n + ".v (already built) ---\n" + builtFiles[n])
    .join("\n\n");
  const sys =
    "You are a Verilog module writer. A module you wrote VIOLATES the design specification. " +
    "Rewrite ONLY the module '" + mod.name + "' to fix the violation(s), matching the spec's required " +
    "ports and clock/reset style exactly. Output ONLY that module inside a ```verilog code block — no prose, no testbench." + RESET_REF;
  let base =
    "Design spec:\n" + builderSpec(spec, mod.name) +
    "\n\nModule '" + mod.name + "' — " + (mod.purpose || "") +
    " — has these SPEC VIOLATIONS to fix:\n" + issues +
    "\n\nReturn a corrected version of '" + mod.name + "' that conforms to the spec.";
  if (depContext)
    base += "\n\nIt instantiates these already-built modules (do NOT redefine them):\n\n" + depContext;

  // Fast path: a synchronous-reset requirement against async-reset code is a
  // mechanical edit — strip the reset from the sensitivity list, compile-check it,
  // and return WITHOUT spending an LLM call. \bsynchronous\b won't match the
  // "asynchronous" in the same sentence, so this only fires when the SPEC wants sync.
  if (/\bsynchronous\b/i.test(issues || "")) {
    const cur = builtFiles[mod.name] || "";
    const stripped = stripAsyncReset(cur);
    if (stripped && stripped !== cur) {
      const files = Object.keys(builtFiles).filter((n) => n !== mod.name)
        .map((n) => ({ name: n + ".v", code: builtFiles[n] }));
      files.push({ name: mod.name + ".v", code: stripped });
      const res = await compileVerilog(files, mod.name);
      if (res.ok) return stripped; // deterministic one-pass sync-reset fix
    }
  }

  let lastErr = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    const user = base + (lastErr ? "\n\nYour previous attempt failed to COMPILE:\n" + lastErr + "\n\nReturn a corrected, compiling version." : "");
    const reply = await callLLM({ ...llm, system: sys, messages: [{ role: "user", content: user }] });
    const code = extractVerilog(reply);
    const files = Object.keys(builtFiles)
      .filter((n) => n !== mod.name)
      .map((n) => ({ name: n + ".v", code: builtFiles[n] }));
    files.push({ name: mod.name + ".v", code });
    const res = await compileVerilog(files, mod.name);
    if (res.ok) return code;
    lastErr = res.output;
  }
  return null;
}

// Attribute a testbench-stage COMPILE error to the testbench or the module.
// iverilog reports errors as FILE:LINE; the module already compiled independently
// (buildModule), so an error in the tb file — or ambiguous — is the testbench's
// fault; an error in a module .v (and NOT the tb) is the module's. Returns
// "testbench" | "module".
function attributeCompile(output, tbName) {
  const files = String(output || "").match(/[\w./-]+\.s?v/gi) || [];
  const inTb = files.some((f) => f.endsWith(tbName));
  const inMod = files.some((f) => !f.endsWith(tbName));
  if (inMod && !inTb) return "module";
  return "testbench"; // default: the module already compiled on its own
}

// Repair a functional oracle testbench that FAILED TO COMPILE. Feeds the iverilog
// error + the previous testbench back to the LLM to fix the TESTBENCH ONLY (never
// the module under test). Returns { code, top } or null.
async function repairFunctionalTestbench(llm, mod, spec, summary, prevCode, compileError) {
  const ports = (summary && summary.ports) || [];
  const sys =
    "You are a hardware verification engineer. The self-checking Verilog testbench you wrote for module '" +
    mod.name + "' FAILED TO COMPILE. Fix ONLY the testbench so it compiles, keeping it a valid independent " +
    "oracle: instantiate the module by its EXACT name and port names, generate a clock + reset if sequential, " +
    "compute expected outputs from the spec, and print 'FUNC_FAIL' on a mismatch and 'FUNC_PASS' only if all " +
    "checks pass, then $finish. Do NOT modify or redefine the module under test. Name the testbench 'tb_" +
    mod.name + "'. Output ONLY the corrected testbench inside a ```verilog code block — no prose, no module under test.";
  const user =
    "Module under test: " + mod.name + "\nPorts (exact names/directions/widths): " + JSON.stringify(ports) +
    "\n\nThe iverilog COMPILE ERROR from your testbench:\n" + String(compileError || "").slice(0, 800) +
    "\n\nYour previous (non-compiling) testbench:\n```verilog\n" + prevCode + "\n```" +
    "\n\nDesign specification (source of truth for expected outputs):\n" + spec;
  const reply = await callLLM({ ...llm, system: sys, messages: [{ role: "user", content: user }] });
  const code = extractVerilog(reply);
  if (!code) return null;
  return { code: code, top: tbTopName(code, mod.name) };
}

// Run one module's functional oracle test. Returns
// { passed:true|false|null, details, tbBroken? }.
//   passed=true   -> FUNC_PASS (module conforms to the oracle)
//   passed=false  -> FUNC_FAIL (module produced a wrong value) — a real module bug
//   passed=null   -> inconclusive; tbBroken=true means the ORACLE itself couldn't
//                    be made to compile (not the module's fault).
// If the oracle testbench won't compile, we REPAIR the testbench (feed the compile
// error back to the LLM) and retry — up to a few times — before giving up.
// vllm = the VERIFIER LLM: it writes (and repairs) the oracle from the spec +
// interface summary — NOT the code — so the test is independent of the Builder.
async function funcTest(vllm, spec, entry, builtFiles) {
  const mod = { name: entry.name, purpose: entry.purpose };
  let ftb = await genFunctionalTestbench(vllm, mod, spec, entry.summary || {});
  if (!ftb || !ftb.code) return { passed: null, details: "no testbench generated", tbBroken: true };
  entry.funcTb = ftb.code; // keep the LLM-written oracle testbench for the Modules view

  const maxTbTries = 3;
  for (let tbTry = 1; tbTry <= maxTbTries; tbTry++) {
    const simFiles = Object.keys(builtFiles).map((n) => ({ name: n + ".v", code: builtFiles[n] }));
    simFiles.push({ name: "func_tb.v", code: ftb.code });
    const sim = await runTestbench(simFiles, ftb.top);

    if (sim.compileFailed) {
      const where = attributeCompile(sim.output, "func_tb.v");
      // The module already compiled independently, so a module-attributed error
      // here is unexpected — report it as inconclusive (don't chase it as a bug).
      if (where === "module") {
        return { passed: null, details: "module compile error under test: " + sim.output.slice(0, 200), tbBroken: false };
      }
      // Broken oracle testbench: repair it and retry, unless out of tries.
      if (tbTry < maxTbTries) {
        const repaired = await repairFunctionalTestbench(vllm, mod, spec, entry.summary || {}, ftb.code, sim.output);
        if (!repaired || !repaired.code) {
          return { passed: null, details: "testbench won't compile and repair failed: " + sim.output.slice(0, 160), tbBroken: true };
        }
        ftb = repaired;
        entry.funcTb = ftb.code;
        continue;
      }
      return { passed: null, details: "oracle testbench won't compile after " + maxTbTries + " tries: " + sim.output.slice(0, 160), tbBroken: true };
    }

    const markers = ((sim.output.match(/FUNC_[A-Z]+[^\n]*/g) || []).join("; ") || sim.output.slice(0, 160)).slice(0, 400);
    if (/FUNC_PASS/.test(sim.output) && !/FUNC_FAIL/.test(sim.output)) return { passed: true, details: markers };
    if (/FUNC_FAIL/.test(sim.output)) return { passed: false, details: markers };
    return { passed: null, details: markers }; // ran but printed no verdict
  }
  return { passed: null, details: "testbench could not be made to compile", tbBroken: true };
}

// Code-generated SMOKE test (no oracle): drive the module and confirm it RUNS
// without producing undefined (X) outputs. Run as a BASELINE on every module — a
// reliable, LLM-independent "does it run clean?" signal, so an oracle failure can
// be attributed (module vs testbench). Returns { passed:true|false|null, markers }.
//   passed=false -> the MODULE produced X / a real runtime problem
//   passed=null  -> inconclusive: the smoke testbench itself couldn't compile (a
//                   generator/interface issue), NOT the module's fault.
async function runSmokeBaseline(code, floorFiles) {
  try {
    const iface = parseInterface(code);
    if (!iface) return { passed: null, markers: "interface not parsed" };
    const stb = genSmokeTestbench(iface);
    const simFiles = floorFiles.slice();
    simFiles.push({ name: "smoke_tb.v", code: stb.code });
    const sim = await runTestbench(simFiles, stb.top);
    if (sim.compileFailed) {
      // A module-attributed error is a real fail; a smoke_tb error is our
      // generator's problem → inconclusive (don't penalize the module).
      const where = attributeCompile(sim.output, "smoke_tb.v");
      return {
        passed: where === "module" ? false : null,
        markers: "smoke tb " + (where === "module" ? "module error: " : "couldn't compile: ") + sim.output.slice(0, 160),
        tb: stb.code,
      };
    }
    const markers = (sim.output.match(/SMOKE_[A-Z]+[^\n]*/g) || []).join("; ").slice(0, 400);
    if (/SMOKE_PASS/.test(sim.output)) return { passed: true, markers: markers, tb: stb.code };
    if (/SMOKE_FAIL|SMOKE_X/.test(sim.output)) return { passed: false, markers: markers, tb: stb.code };
    return { passed: null, markers: markers || (sim.ok ? "no verdict" : "sim error"), tb: stb.code };
  } catch (e) {
    return { passed: null, markers: String((e && e.message) || e) };
  }
}

// Rebuild a module to fix a FUNCTIONAL bug, keeping its interface; compile-check
// with retries. Returns corrected code or null. Its verified deps are given as
// context (do-not-redefine), so the fix targets this module's own logic.
async function fixModuleFunctional(llm, spec, entry, builtFiles) {
  const depNames = (entry.dependsOn || []).filter((n) => builtFiles[n]);
  const depContext = depNames
    .map((n) => "--- " + n + ".v (already built, verified) ---\n" + builtFiles[n])
    .join("\n\n");
  const sys =
    "You are a Verilog module writer. A synthesizable module you wrote FAILED a functional test. " +
    "Rewrite ONLY the module '" + entry.name + "' to fix the bug, keeping the SAME interface (ports/params). " +
    "Output ONLY that module inside a ```verilog code block — no prose, no testbench.";
  let base =
    "Design spec:\n" + builderSpec(spec, entry.name) +
    "\n\nModule '" + entry.name + "' — " + (entry.purpose || "") +
    " — FAILED this functional test (expected vs actual):\n" + (entry.funcTbOutput || "") +
    "\n\nReturn a corrected version of '" + entry.name + "'.";
  if (depContext)
    base += "\n\nIt instantiates these already-built, verified modules (do NOT redefine them):\n\n" + depContext;
  let lastErr = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    const user = base + (lastErr ? "\n\nYour previous attempt failed to COMPILE:\n" + lastErr + "\n\nReturn a corrected, compiling version." : "");
    const reply = await callLLM({ ...llm, system: sys, messages: [{ role: "user", content: user }] });
    const code = extractVerilog(reply);
    const files = Object.keys(builtFiles)
      .filter((n) => n !== entry.name)
      .map((n) => ({ name: n + ".v", code: builtFiles[n] }));
    files.push({ name: entry.name + ".v", code });
    const res = await compileVerilog(files, entry.name);
    if (res.ok) return code;
    lastErr = res.output;
  }
  return null;
}

// Cost cut: only NOT-yet-functional built children are suspects; order them by
// suspicion (computing modules first, then higher complexity) so the likely
// culprit is tested first.
function suspectChildren(entry, modByName) {
  return (entry.dependsOn || [])
    .map((n) => modByName[n])
    .filter((c) => c && c.built && c.verification !== "functional")
    .sort((a, b) => {
      const ac = a.hasComputation ? 1 : 0, bc = b.hasComputation ? 1 : 0;
      if (bc !== ac) return bc - ac;
      return (b.complexity || 0) - (a.complexity || 0);
    });
}

// Fault localization + ONE-BUG-AT-A-TIME correction. On a functional failure:
// test the not-yet-verified direct children (suspicion-ordered, STOP at the first
// that fails); a failing child → recurse into it; all children pass → the bug is
// this module's own logic → rebuild it. Re-test after each fix. `budget` counts
// test/fix operations across the whole build and warns past a threshold (no hard cap).
// Returns true if `entry` ends up functionally verified.
// llm = BUILDER (rebuilds broken code). vllm = VERIFIER (writes/runs the oracle
// via funcTest) — kept separate so the test that judges the code is written by a
// different model than the one that wrote (and fixes) the code.
// The verification/fix pass is NOT hard-capped — complex or buggy projects can
// legitimately need many corrections. We COUNT operations and, once they pass a
// soft threshold, flag a one-time decision point (handled in the build loop: the
// interactive flow asks the user, the plain /build endpoint just warns). Still
// bounded by maxRounds per module × the module tree, so it can't loop forever.
function chargeBudget(budget) {
  budget.used = (budget.used || 0) + 1;
  const step = budget.warnAt || 20;
  const nextAt = budget.nextAt || step;
  if (budget.used > nextAt) {
    budget.needsDecision = true;
    budget.nextAt = nextAt + step; // re-ask at every further multiple of the threshold
  }
}

async function localizeAndFix(llm, vllm, spec, entry, builtFiles, modByName, onProgress, budget, depth) {
  depth = depth || 0;
  const emit = (o) => { if (onProgress) onProgress(Object.assign({ type: "drill", depth: depth }, o)); };
  const maxRounds = 3;
  for (let round = 1; round <= maxRounds; round++) {
    chargeBudget(budget);
    const res = await funcTest(vllm, spec, entry, builtFiles); // Verifier's oracle
    entry.funcTbPassed = res.passed;
    entry.funcTbOutput = res.details;
    if (res.passed === true) {
      entry.verification = "functional"; entry.testbenched = true;
      emit({ module: entry.name, result: "functional" });
      return true;
    }
    if (res.passed === null) { emit({ module: entry.name, result: "inconclusive", details: res.details }); return false; }

    emit({ module: entry.name, result: "failed", details: res.details });
    // Localize: test suspects, stop at the first failure (one bug at a time).
    const candidates = suspectChildren(entry, modByName);
    let culprit = null;
    for (const child of candidates) {
      chargeBudget(budget);
      emit({ module: child.name, msg: "testing child of " + entry.name });
      const cres = await funcTest(vllm, spec, child, builtFiles); // Verifier's oracle
      child.funcTbPassed = cres.passed; child.funcTbOutput = cres.details;
      if (cres.passed === true) {
        child.verification = "functional"; child.testbenched = true;
        emit({ module: child.name, result: "functional" });
      } else if (cres.passed === false) {
        culprit = child; // stop at first failure
        emit({ module: child.name, result: "failed", details: cres.details });
        break;
      } // inconclusive child → skip
    }
    if (culprit) {
      emit({ module: culprit.name, msg: "localized culprit — correcting it" });
      await localizeAndFix(llm, vllm, spec, culprit, builtFiles, modByName, onProgress, budget, depth + 1);
      // loop: re-test `entry` now that the child is (hopefully) fixed
    } else {
      emit({ module: entry.name, msg: "bug is in own logic — rebuilding" });
      const fixed = await fixModuleFunctional(llm, spec, entry, builtFiles);
      if (fixed) builtFiles[entry.name] = fixed;
      else { emit({ module: entry.name, result: "unfixable" }); return false; }
      // loop: re-test `entry` with the corrected code
    }
  }
  return false;
}

// Full run. onProgress(ev) is called as modules start/finish (for streaming).
// Holistic conformance review: the Verifier judges EVERY built module at once,
// from all summaries + the spec, and returns a per-module verdict. Seeing the whole
// design together catches spec violations the one-module-at-a-time check can miss
// (e.g. a reset style that only reads as wrong against the spec's global rules).
async function reviewAllConformance(llm, spec, summaries) {
  const sys =
    "You are the Verifier. Given the design spec and a STRUCTURED SUMMARY for each built module " +
    "(interface, intended function, clock/reset conventions — NOT the source code), decide for EACH " +
    "module whether it CONFORMS to the spec. Check ports/widths, intended behavior, and the clock/reset " +
    "style (synchronous vs asynchronous, active-high vs active-low).\n" +
    "Module NAMES are assigned by the design plan and may differ from names in the spec (the design is " +
    "split into sub-modules). Do NOT flag module names as violations and never ask to rename — judge ONLY " +
    "ports, behavior, and reset. Return ONLY JSON: " +
    '{"modules":[{"module":"<name>","conforms":true|false,"issues":"<if false: the specific PORT/BEHAVIOR/RESET violations to fix; else empty>"}]}';
  const user =
    "Design spec:\n" + spec + "\n\nModule summaries:\n\n" +
    summaries.map((x) => "```json\n" + JSON.stringify(x, null, 2) + "\n```").join("\n\n");
  try {
    const reply = await callLLM({ ...llm, system: sys, messages: [{ role: "user", content: user }] });
    const t = reply.replace(/```json|```/g, "");
    const obj = JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1));
    return Array.isArray(obj.modules)
      ? obj.modules.map((m) => ({ module: String((m && m.module) || ""), conforms: m && m.conforms === true, issues: String((m && m.issues) || "") }))
      : [];
  } catch (e) {
    return [];
  }
}

// FINAL CONFORMANCE SWEEP: run the holistic review, then loop any flagged module
// back to the Builder to FIX (re-summarize + re-check once) — so a violation the
// per-module pass missed is corrected, not just reported at the end. Charged to the
// same fix budget, so the op-count policy still governs it.
async function finalConformanceSweep(ctx) {
  const { llm, verifierLLM, spec, manifestByName, builtFiles, summaries, results, onProgress, fixBudget } = ctx;
  if (!summaries.length) return;
  const verdicts = await reviewAllConformance(verifierLLM, spec, summaries);
  for (const v of verdicts) {
    if (!v || v.conforms || !v.module || !builtFiles[v.module]) continue; // only real, fixable violations
    const info = manifestByName[v.module] || {};
    const mod = { name: v.module, purpose: info.purpose || "", dependsOn: info.dependsOn || [] };
    chargeBudget(fixBudget);
    if (onProgress) onProgress({ type: "conformance", module: v.module, ok: false, issues: v.issues, phase: "final" });
    const fixed = await fixModuleConformance(llm, spec, mod, builtFiles, v.issues);
    if (!fixed) { if (onProgress) onProgress({ type: "conformance", module: v.module, ok: false, issues: v.issues, phase: "final" }); continue; }
    builtFiles[v.module] = fixed;
    const rr = results.find((x) => x && x.name === v.module);
    if (rr) rr.code = fixed;
    const newSummary = await summarizeModule(llm, mod, fixed);
    const idx = summaries.findIndex((x) => x && x.module === v.module);
    if (idx >= 0) summaries[idx] = newSummary; // so the displayed final review reflects the fix
    const recheck = await checkConformance(verifierLLM, spec, mod, newSummary);
    const ok = !recheck || recheck.conforms;
    if (manifestByName[v.module]) manifestByName[v.module].conformance = { ok, issues: ok ? "" : (recheck && recheck.issues) || v.issues };
    if (onProgress) onProgress({ type: "conformance", module: v.module, ok, phase: "final" });
  }
}

// USER-TRIGGERED RE-FIX from the final review: rewrite the modules the Verifier
// flagged as mismatched (guided by the review text), then re-verify each one —
// recompute complexity and re-run the functional oracle testbench. Works from the
// manifest the frontend already holds (name/purpose/dependsOn/code/summary), so no
// fragile re-parsing of files. Streams progress via onProgress. Returns updated
// files + manifest + a fresh review + overall pass/fail.
async function refixFromReview(llm, verifierLLM, spec, manifest, review, onProgress) {
  verifierLLM = verifierLLM || llm;
  llm = Object.assign({}, llm, { temperature: llm.temperature != null ? llm.temperature : BUILDER_TEMP });
  onProgress = onProgress || function () {};
  const list = (manifest || []).filter((m) => m && m.name && m.code);
  if (!list.length) return { files: {}, manifest: manifest || [], summaries: [], review: "", passed: null, fixed: [] };
  const byName = {}, builtFiles = {};
  list.forEach((m) => { byName[m.name] = m; builtFiles[m.name] = m.code; });

  // Fresh summaries (reuse the stored one; else describe the current code).
  const summaries = [];
  for (const m of list) {
    const summary = m.summary || (await summarizeModule(llm, { name: m.name, purpose: m.purpose || "" }, m.code));
    m.summary = summary;
    summaries.push(summary);
  }

  // Which modules mismatch the spec? Ask the Verifier for a per-module verdict.
  const verdicts = await reviewAllConformance(verifierLLM, spec, summaries);
  const bad = verdicts.filter((v) => v && !v.conforms && builtFiles[v.module]);
  onProgress({ type: "refixPlan", modules: bad.map((v) => v.module) });

  const fixed = [];
  for (const v of bad) {
    const info = byName[v.module] || {};
    const mod = { name: v.module, purpose: info.purpose || "", dependsOn: info.dependsOn || [] };
    onProgress({ type: "conformance", module: v.module, ok: false, issues: v.issues, phase: "refix" });
    // Rewrite guided by BOTH the structured issue and the full prose review.
    const guidance = (v.issues || "") + (review ? "\n\nFull design review from the Verifier:\n" + review : "");
    const code = await fixModuleConformance(llm, spec, mod, builtFiles, guidance);
    if (!code) { onProgress({ type: "conformance", module: v.module, ok: false, issues: "could not rewrite", phase: "refix" }); continue; }
    builtFiles[v.module] = code;

    // Re-verify: complexity + functional oracle testbench (as requested).
    const summary = await summarizeModule(llm, mod, code);
    const idx = summaries.findIndex((x) => x && x.module === v.module);
    if (idx >= 0) summaries[idx] = summary;
    const features = computeFeatures(code);
    const codeScore = baselineScore(features);
    const llmScore = summary.complexity != null ? summary.complexity : codeScore;
    const finalScore = Math.round(((llmScore + codeScore) / 2) * 10) / 10;
    const entry = { name: v.module, purpose: mod.purpose, dependsOn: mod.dependsOn, summary };
    const ft = await funcTest(verifierLLM, spec, entry, builtFiles); // sets entry.funcTb
    onProgress({ type: "floor", module: v.module, tier: "functional", complexity: finalScore, funcTbPassed: ft.passed, funcTbReason: ft.details, verification: ft.passed === true ? "functional" : "unverified", phase: "refix" });

    Object.assign(byName[v.module], {
      code: code, summary: summary, complexity: finalScore, tier: "functional",
      funcTb: entry.funcTb || byName[v.module].funcTb || "",
      funcTbPassed: ft.passed, verification: ft.passed === true ? "functional" : "unverified",
    });
    fixed.push(v.module);
  }

  // Fresh overall verdict on the updated summaries.
  const finalVerdicts = await reviewAllConformance(verifierLLM, spec, summaries);
  const allConform = finalVerdicts.length ? finalVerdicts.every((v) => v.conforms) : true;
  const reviewText =
    "**Overall Verdict: " + (allConform ? "PASSED" : "FAILED") + "**\n\n" +
    finalVerdicts.map((v) => "- **" + v.module + "**: " + (v.conforms ? "conforms" : "MISMATCH \u2014 " + v.issues)).join("\n");

  return { files: builtFiles, manifest: list, summaries, review: reviewText, passed: allConform, fixed };
}

// llm = the BUILDER (writes/fixes code). verifierLLM = the VERIFIER (writes the
// functional oracle testbench + reviews spec conformance) — a DIFFERENT model, so
// the oracle is independent of the code it checks. Falls back to the builder LLM
// when no verifier is given (e.g. the single-model /build endpoint).
// decide (optional) is an async fn ({ used }) -> "continue" | "buildOnly" |
// "raiseCutoff", called ONCE when verification passes the soft threshold, so the
// interactive flow can ask the user how to proceed. Without it (e.g. /build), the
// build just continues and warns.
async function buildDesign(llm, spec, onProgress, verifierLLM, decide, control) {
  verifierLLM = verifierLLM || llm;
  llm = Object.assign({}, llm, { temperature: llm.temperature != null ? llm.temperature : BUILDER_TEMP }); // steadier Builder
  control = control || {};
  const shouldStop = control.shouldStop || function () { return false; }; // cooperative cancel
  const seedFiles = control.seedFiles || null; // resume: modules already built (name.v -> code)
  let stopped = false;
  const modules = await planGraph(llm, spec);
  const { order, cycle } = topoSort(modules);
  if (onProgress)
    onProgress({ type: "plan", order: order.map((m) => m.name), cycle: cycle.map((m) => m.name) });

  // Manifest of EVERY planned module (built order + any that couldn't be ordered),
  // tracking build + testbench status. Kept as LLM reference, not user-facing.
  // testbenched stays false until the simulation layer is wired to run testbenches.
  const manifest = order.concat(cycle).map((m) => ({
    name: m.name,
    purpose: m.purpose || "",
    built: false,
    testbenched: false,
    dependsOn: (m.dependsOn || []).slice(),
  }));
  const manifestByName = {};
  manifest.forEach((x) => (manifestByName[x.name] = x));
  // Build-wide budget for functional-correction operations (test/fix), so a
  // pathological design can't spawn unbounded LLM calls.
  // Fresh per build — a new /flow run (e.g. re-prompt with modifications) always
  // starts buildDesign again, so the counter resets on its own. Re-asks at each
  // multiple of warnAt (20, 40, 60, …).
  const fixBudget = { used: 0, warnAt: 20, nextAt: 20, needsDecision: false };
  // Mutable verification policy — a mid-build decision (or the plain warn path)
  // can change these for the REMAINING modules.
  let stopTests = false;   // "buildOnly": skip LLM verification (conformance + oracle)
  let raisedCutoff = false; // whether the user already chose "raiseCutoff"
  let cutoff = FLOOR_CUTOFF; // "raiseCutoff": bump so fewer modules hit the functional tier

  const builtFiles = {};
  // Resume: seed already-built modules so we skip them and only build the rest.
  if (seedFiles && seedFiles.length) {
    order.forEach((m) => {
      const sf = seedFiles.find((f) => f && new RegExp("\\bmodule\\s+" + m.name + "\\b").test(f.code || ""));
      if (sf) builtFiles[m.name] = sf.code;
    });
  }
  const results = [];
  const summaries = [];
  for (const mod of order) {
    // Cooperative stop: bail cleanly between modules if the client cancelled.
    if (shouldStop()) { stopped = true; if (onProgress) onProgress({ type: "stopped", module: mod.name }); break; }
    // Resume: if this module is already built (from seedFiles) and still compiles,
    // keep it and skip the rebuild + verification entirely.
    if (seedFiles && builtFiles[mod.name]) {
      const chk = await compileVerilog(Object.keys(builtFiles).map((n) => ({ name: n + ".v", code: builtFiles[n] })), mod.name);
      if (chk.ok) {
        const e0 = manifestByName[mod.name]; if (e0) e0.built = true;
        if (onProgress) onProgress({ type: "skipped", module: mod.name, reason: "already built" });
        continue;
      }
    }
    // Verification passed the soft threshold last iteration → resolve the policy
    // before doing any more verification. Interactive flow asks; else just warn.
    // Re-ask only offers the reduce-LLM-call options not already taken.
    if (fixBudget.needsDecision) {
      fixBudget.needsDecision = false;
      if (decide) {
        let choice = "continue";
        try { choice = await decide({ used: fixBudget.used, allowRaise: !raisedCutoff }); } catch (_) {}
        if (choice === "buildOnly") { stopTests = true; if (onProgress) onProgress({ type: "budgetDecided", choice: "buildOnly" }); }
        else if (choice === "raiseCutoff" && !raisedCutoff) { raisedCutoff = true; cutoff = 50; if (onProgress) onProgress({ type: "budgetDecided", choice: "raiseCutoff", cutoff: cutoff }); }
        else if (onProgress) onProgress({ type: "budgetDecided", choice: "continue" });
      } else if (onProgress) {
        onProgress({ type: "budgetWarn", used: fixBudget.used, threshold: fixBudget.warnAt });
      }
    }
    if (onProgress) onProgress({ type: "building", module: mod.name });
    // Option 1: generate this module's header (params + ports) from the spec so the
    // Builder can't drop parameters or hardcode widths — it only writes the body.
    // The Verifier LLM extracts the interface (it owns the spec); null -> the Builder
    // writes the whole module as before (graceful fallback).
    let header = null, contract = null;
    try {
      contract = await genInterfaceContract(verifierLLM, spec, mod);
      header = (contract && contract.ports && contract.ports.length) ? buildHeader(mod.name, contract) : null;
    } catch (e) { header = null; }
    const r = await buildModule(llm, spec, mod, builtFiles, 3, onProgress, manifest, header);
    if (r.ok) {
      builtFiles[r.name] = r.code;

      // DETERMINISTIC RESET FIX (no LLM): if the spec requires a SYNCHRONOUS reset
      // but the Builder wrote an ASYNCHRONOUS one, strip the reset from the always
      // sensitivity list in code — before any conformance LLM call sees it.
      if (contract && contract.reset && /^sync/i.test(contract.reset.type || "") && hasAsyncReset(r.code)) {
        const fixedCode = stripAsyncReset(r.code);
        if (fixedCode !== r.code) {
          const chkFiles = Object.keys(builtFiles).filter((n) => n !== mod.name)
            .map((n) => ({ name: n + ".v", code: builtFiles[n] }));
          chkFiles.push({ name: mod.name + ".v", code: fixedCode });
          const chk = await compileVerilog(chkFiles, mod.name);
          if (chk.ok) {
            r.code = fixedCode;
            builtFiles[r.name] = fixedCode;
            if (onProgress) onProgress({ type: "resetFix", module: mod.name });
          }
        }
      }
      const entry = manifestByName[mod.name];

      // Builder describes the module for the Verifier (summary, NOT the code).
      let summary = await summarizeModule(llm, mod, r.code);
      if (onProgress) onProgress({ type: "summary", module: mod.name, summary: summary }); // logged the moment it happens

      // SPEC-CONFORMANCE CHECK + immediate correction. The Verifier checks this
      // module's summary against the spec (ports, behavior, and especially
      // clock/reset style) AS IT IS BUILT — and any violation is sent straight
      // back to the Builder to fix, instead of only being reported at the end.
      let conformed = true, confIssues = "";
      if (!stopTests) {
        for (let cround = 1; cround <= 2; cround++) {
          let conf = await checkConformance(verifierLLM, spec, mod, summary); // Verifier reviews
          if (!conf) conf = await checkConformance(verifierLLM, spec, mod, summary); // retry once on inconclusive
          if (!conf) break;                       // still inconclusive — don't force a rewrite
          if (conf.conforms) { conformed = true; confIssues = ""; break; }
          conformed = false; confIssues = conf.issues; // a real violation stands until fixed
          chargeBudget(fixBudget);
          if (onProgress) onProgress({ type: "conformance", module: mod.name, ok: false, issues: conf.issues });
          const fixed = await fixModuleConformance(llm, spec, mod, builtFiles, conf.issues);
          if (!fixed) break;
          builtFiles[mod.name] = fixed;
          r.code = fixed;
          summary = await summarizeModule(llm, mod, fixed); // re-describe the corrected module
        }
        // Report the HONEST result — only ✓ if it actually conforms after the rounds.
        if (onProgress) onProgress({ type: "conformance", module: mod.name, ok: conformed, issues: conformed ? "" : confIssues });
      }
      if (entry) entry.conformance = stopTests ? null : { ok: conformed, issues: confIssues };

      summaries.push(summary);

      // Complexity (on the FINAL, conforming code): two independent estimates averaged.
      //   codeScore — deterministic feature-vector formula
      //   llmScore  — the LLM's own 1–100 from reading the full module
      const features = computeFeatures(r.code);
      const codeScore = baselineScore(features);
      const llmScore = summary.complexity != null ? summary.complexity : codeScore;
      const finalScore = Math.round(((llmScore + codeScore) / 2) * 10) / 10;
      // Route to a verification tier: smoke (code-only floor) vs functional (oracle).
      const tier = routeTier(finalScore, features, cutoff);
      if (entry) {
        entry.built = true;
        entry.complexity = finalScore;
        entry.llmComplexity = summary.complexity; // may be null
        entry.codeComplexity = codeScore;
        entry.complexityRationale = summary.complexityRationale || "";
        entry.features = features;
        entry.hasComputation = features.hasComputation;
        entry.tier = tier;
        entry.summary = summary; // used by the functional oracle + drill-down
      }
      // (the "summary"/described event was already emitted right after the describe)

      // STRUCTURAL + VERIFICATION on every built module: lint + generic synthesis,
      // then a code-generated smoke baseline (runs clean?), then — for functional-
      // tier modules — the LLM oracle testbench with fault localization & correction.
      //   verification: 'unverified' | 'smoke' | 'functional'
      //   Only 'functional' counts as trusted for pruning / fault isolation.
      if (entry) {
        const floorFiles = Object.keys(builtFiles).map((n) => ({ name: n + ".v", code: builtFiles[n] }));
        if (onProgress) onProgress({ type: "verifyStart", module: mod.name, tier: tier });

        // STRUCTURAL checks on EVERY module (both tiers) — lint + GENERIC SYNTHESIS.
        // Synthesizability is universal, so it runs for all built modules. $0, local.
        const lint = await lintVerilog(floorFiles, mod.name);
        if (onProgress) onProgress({ type: "check", module: mod.name, name: "lint", ok: lint.clean === true, reason: lint.output ? String(lint.output).split("\n")[0] : "" });
        const synth = await synthCheck(floorFiles, mod.name);
        if (onProgress) onProgress({ type: "check", module: mod.name, name: "synth", synthesizable: synth.synthesizable, available: synth.available, reason: synth.output ? String(synth.output).split("\n")[0] : "" });
        entry.lintClean = lint.clean;
        entry.lintOutput = lint.output ? lint.output.slice(0, 500) : "";
        entry.synthesizable = synth.synthesizable; // true | false | null (yosys absent)
        entry.synthAvailable = synth.available;
        entry.synthOutput = synth.output ? synth.output.slice(0, 500) : "";
        const synthOk = synth.available ? synth.synthesizable === true : true;
        const structuralOk = lint.clean && synthOk;

        // SMOKE BASELINE on EVERY module (both tiers): a code-generated X-check
        // confirming the module RUNS without producing undefined outputs. It's
        // independent of the LLM oracle, so it gives a reliable "the module itself
        // runs clean" signal used to attribute functional failures (module vs
        // testbench). For smoke-tier modules it's also the verification gate.
        const smoke = await runSmokeBaseline(r.code, floorFiles);
        if (onProgress) onProgress({ type: "check", module: mod.name, name: "smoke", passed: smoke.passed, reason: smoke.markers || "", tier: tier });
        entry.smokeSimPassed = smoke.passed;
        entry.smokeSimOutput = smoke.markers;
        entry.smokeTb = smoke.tb || "";  // code-generated smoke testbench (for the Modules view)
        entry.code = r.code;             // the module's Verilog RTL (for the Modules view)
        const smokeOk = smoke.passed !== false; // fail only on a real X/module failure

        if (stopTests) {
          // "buildOnly" chosen at the decision point: no more LLM verification —
          // keep the free structural signal (lint/synth/smoke) but skip the oracle.
          entry.verification = structuralOk && smokeOk ? "smoke" : "unverified";
        } else if (tier === "smoke") {
          entry.verification = structuralOk && smokeOk ? "smoke" : "unverified";
        } else {
          // FUNCTIONAL ORACLE TESTBENCH + fault localization & correction.
          // Runs the oracle test; on failure it localizes the culprit (one bug at a
          // time, skipping verified children, suspicion-ordered) and rebuilds it,
          // then re-tests. Only runs if the module is structurally sound. The smoke
          // baseline above lets this path tell a broken testbench from a broken module.
          if (structuralOk) {
            try {
              await localizeAndFix(llm, verifierLLM, spec, entry, builtFiles, manifestByName, onProgress, fixBudget, 0);
            } catch (e) { entry.funcTbOutput = String((e && e.message) || e); }
            entry.verification = entry.verification === "functional" ? "functional" : "unverified";
          } else {
            entry.verification = "unverified"; // not synthesizable/lint-clean → can't be functional
          }
        }
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
            funcTbPassed: entry.funcTbPassed,
            funcTbReason: entry.funcTbOutput || "",
          });
      }
    }
    results.push(r);
    if (onProgress) {
      if (r.ok && builtFiles[mod.name]) // stream the final code so a stop preserves progress
        onProgress({ type: "file", name: mod.name + ".v", code: builtFiles[mod.name] });
      onProgress({
        type: "built",
        module: mod.name,
        ok: r.ok,
        attempts: r.attempts,
        error: r.error,
      });
    }
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

  // Final safety net: one holistic conformance review over all modules, looping
  // any flagged violation back to the Builder to fix (skipped if the user chose
  // "build only" at the budget prompt).
  if (!stopTests && !stopped) {
    await finalConformanceSweep({ llm, verifierLLM, spec, manifestByName, builtFiles, summaries, results, onProgress, fixBudget });
  }

  return {
    results,
    cycle: cycle.map((m) => m.name),
    files: builtFiles,
    summaries,
    manifest,
    dependencyGraph: dependencyGraphMd(manifest),
    stopped: stopped,
  };
}

// Build a Markdown dependency graph (module list + a Mermaid diagram) from the
// manifest, so the frontend can render it with its Mermaid viewer. Edge "A --> B"
// means module A instantiates (depends on) module B.
function dependencyGraphMd(manifest) {
  if (!manifest || !manifest.length) return "";
  const lines = ["# Dependency Graph", "", "## Modules", ""];
  manifest.forEach((m) => {
    const deps = m.dependsOn || [];
    const info = [];
    if (m.complexity != null) info.push("complexity " + m.complexity + "/100");
    if (m.verification) info.push(m.verification);
    lines.push(
      "- **" + m.name + "**" + (info.length ? " (" + info.join(", ") + ")" : "") +
        (deps.length ? " → instantiates: " + deps.join(", ") : " — leaf")
    );
  });
  lines.push("", "## Diagram", "", "```mermaid", "graph TD");
  let edges = 0;
  manifest.forEach((m) => {
    (m.dependsOn || []).forEach((d) => {
      lines.push("  " + m.name + " --> " + d);
      edges++;
    });
  });
  if (!edges) manifest.forEach((m) => lines.push("  " + m.name)); // lone nodes so it's not empty
  lines.push("```");
  return lines.join("\n");
}

// User-triggered WHOLE-PROJECT testbench: the Verifier writes one self-checking
// testbench for the top-level module (the one nothing else instantiates), checking
// the assembled design against the spec. Returns { name, code, top } or null.
async function generateProjectTestbench(llm, spec, files) {
  const design = files.map((f) => "// === FILE: " + f.name + " ===\n" + (f.code || "")).join("\n\n");
  const sys =
    "You are a verification engineer. Given a design specification and ALL the Verilog modules of a " +
    "project, write ONE self-checking testbench that verifies the TOP-LEVEL module (the module that is " +
    "not instantiated by any other) against the spec. Instantiate the top module by its exact name; " +
    "generate a clock and reset if it is sequential; drive representative AND edge-case inputs; compute " +
    "the EXPECTED outputs from the SPEC and check them. Print a line starting with 'PROJECT_FAIL' " +
    "(with inputs, expected, actual) on any mismatch, and 'PROJECT_PASS' at the very end only if every " +
    "check passed; then call $finish. Name the testbench module 'project_tb'. Output ONLY the testbench " +
    "inside a ```verilog code block — no prose, and do NOT redefine the design modules.";
  const user =
    "Design specification:\n" +
    (spec ? spec : "(no spec provided — infer the intended behavior from the modules)") +
    "\n\nProject modules:\n\n" + design;
  const reply = await callLLM({ ...llm, system: sys, messages: [{ role: "user", content: user }] });
  const code = extractVerilog(reply);
  if (!code) return null;
  return { name: "project_tb.v", code: code, top: tbTopName(code, "") };
}

// Repair a whole-project testbench that FAILED TO COMPILE — fix the TESTBENCH only,
// feeding the iverilog error + previous testbench back. Returns { name, code, top }.
async function repairProjectTestbench(llm, spec, files, prevCode, compileError) {
  const design = files.map((f) => "// === FILE: " + f.name + " ===\n" + (f.code || "")).join("\n\n");
  const sys =
    "You are a verification engineer. The self-checking whole-project testbench you wrote FAILED TO " +
    "COMPILE. Fix ONLY the testbench so it compiles: instantiate the top module by its exact name and " +
    "port names, generate a clock + reset if sequential, compute expected outputs from the spec, print " +
    "'PROJECT_FAIL' on a mismatch and 'PROJECT_PASS' only if all checks pass, then $finish. Do NOT " +
    "redefine or modify the design modules. Name the testbench 'project_tb'. Output ONLY the corrected " +
    "testbench inside a ```verilog code block — no prose.";
  const user =
    "The iverilog COMPILE ERROR from your testbench:\n" + String(compileError || "").slice(0, 800) +
    "\n\nYour previous (non-compiling) testbench:\n```verilog\n" + prevCode + "\n```" +
    "\n\nDesign specification:\n" + (spec || "(infer from modules)") +
    "\n\nProject modules (do NOT redefine):\n\n" + design;
  const reply = await callLLM({ ...llm, system: sys, messages: [{ role: "user", content: user }] });
  const code = extractVerilog(reply);
  if (!code) return null;
  return { name: "project_tb.v", code: code, top: tbTopName(code, "") };
}

module.exports = { buildDesign, refixFromReview, planGraph, topoSort, buildModule, summarizeModule, computeFeatures, baselineScore, generateProjectTestbench, repairProjectTestbench };
