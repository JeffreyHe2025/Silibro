// Pull the Verilog out of a model's reply. Prefers a ```verilog / ```systemverilog
// fenced block; else the first module…endmodule; else the whole reply trimmed.
function extractVerilog(text) {
  const t = String(text || "");
  const fence = t.match(/```(?:verilog|systemverilog|sv)?\s*\r?\n([\s\S]*?)```/i);
  if (fence && fence[1].trim()) return fence[1].trim();
  const mod = t.match(/\bmodule\b[\s\S]*?\bendmodule\b/);
  if (mod) return mod[0].trim();
  return t.trim();
}

// First module name declared in some Verilog (for collision handling).
function firstModuleName(code) {
  const m = /\bmodule\s+(\w+)/.exec(String(code || ""));
  return m ? m[1] : null;
}

// Parse Verilog into its individual module blocks (Verilog modules don't nest, so
// each `module` pairs with the next `endmodule`). Returns [{ name, text, body }],
// where body is the content between the module's header-terminating ';' and its
// own 'endmodule'. Paren-depth aware so a #(...) param list doesn't fool it.
function parseModules(code) {
  const c = String(code || "");
  const blocks = [];
  const re = /\bmodule\b/g;
  let m;
  while ((m = re.exec(c))) {
    const start = m.index;
    const endKw = c.indexOf("endmodule", start);
    if (endKw < 0) break;
    const text = c.slice(start, endKw + "endmodule".length);
    const nameM = /\bmodule\s+(\w+)/.exec(text);
    // find this module's header-terminating ';'
    let depth = 0, seenOpen = false, hdr = -1;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === "(") { depth++; seenOpen = true; }
      else if (ch === ")") depth--;
      else if (ch === ";" && depth === 0) { hdr = i; break; } // ports or param-only or none
    }
    const body = hdr >= 0 ? text.slice(hdr + 1, text.length - "endmodule".length).trim() : "";
    blocks.push({ name: nameM ? nameM[1] : null, text: text.trim(), body });
    re.lastIndex = endKw + "endmodule".length;
  }
  return blocks;
}

// Force Pluto's authoritative header onto ONLY the TOP module the LLM wrote,
// leaving every other (submodule) verbatim. The top is the module named `opt_model`
// (per the instruction the LLM was given); if it named none that, fall back to the
// design ROOT (a module not instantiated by any other), else the last module.
// This guarantees the top's name + ports + params match the testbench while the
// hierarchy underneath keeps whatever names the LLM chose. Returns null if there is
// no parseable module (caller keeps the raw output — a real compile failure).
function forceHeader(generatedCode, headerV) {
  if (!headerV || !headerV.trim()) return null;
  const blocks = parseModules(generatedCode);
  if (!blocks.length) return null;

  let idx = blocks.findIndex((b) => b.name === "opt_model");
  if (idx < 0) {
    // no opt_model → pick the root: a named module not instantiated by any other block
    const instantiated = {};
    blocks.forEach((b) => {
      blocks.forEach((o) => {
        if (o !== b && o.name && new RegExp("\\b" + o.name + "\\b").test(b.body)) instantiated[o.name] = true;
      });
    });
    const rootIdxs = blocks.map((b, i) => i).filter((i) => blocks[i].name && !instantiated[blocks[i].name]);
    idx = rootIdxs.length ? rootIdxs[rootIdxs.length - 1] : blocks.length - 1;
  }

  let header = headerV.trim();
  if (!/;\s*$/.test(header)) header += ";";
  const forcedTop = header + "\n" + blocks[idx].body + "\nendmodule";
  return blocks.map((b, i) => (i === idx ? forcedTop : b.text)).join("\n\n") + "\n";
}

module.exports = { extractVerilog, firstModuleName, parseModules, forceHeader };
