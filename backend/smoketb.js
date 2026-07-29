// Floor-tier SMOKE testbench generator — pure code, NO oracle.
//
// It parses a module's interface and emits a Verilog testbench that:
//   * generates a clock (if the module is sequential),
//   * applies a reset sequence (right polarity/async),
//   * drives inputs with seeded-random (LFSR) vectors, and
//   * asserts oracle-free properties: outputs are never X after reset
//     (catches uninitialized regs, undriven outputs, inferred latches,
//      incomplete case/if), plus a soft "stuck output" warning.
//
// It does NOT check functional correctness (that needs an oracle → other tiers).

function stripComments(code) {
  return String(code || "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}

// name -> numeric default for parameters (from #(...) and body declarations).
function parseParams(code) {
  const src = stripComments(code);
  const params = {};
  const re = /\b(?:parameter|localparam)\b[^;]*?(\w+)\s*=\s*([^,;)\n]+)/g;
  let m;
  while ((m = re.exec(src))) {
    const name = m[1];
    const val = parseInt(String(m[2]).trim(), 10);
    if (!isNaN(val)) params[name] = val;
  }
  return params;
}

// Evaluate a width like [7:0] or [W-1:0] to a bit count. Falls back to 8 if it
// can't be resolved to a plain number.
function resolveWidth(range, params) {
  if (!range) return 1;
  const inner = range.replace(/^\[|\]$/g, "");
  const parts = inner.split(":");
  if (parts.length !== 2) return 8;
  const evalExpr = (e) => {
    let s = e;
    Object.keys(params).forEach((p) => {
      s = s.replace(new RegExp("\\b" + p + "\\b", "g"), String(params[p]));
    });
    if (!/^[0-9+\-*/() ]+$/.test(s)) return null;
    try { return Function('"use strict";return (' + s + ')')(); } catch (e) { return null; }
  };
  const msb = evalExpr(parts[0]);
  const lsb = evalExpr(parts[1]);
  if (msb == null || lsb == null) return 8;
  return Math.abs(msb - lsb) + 1;
}

// Parse the ANSI/non-ANSI module header into { module, params, ports, clock, reset }.
function parseInterface(code) {
  const src = stripComments(code);
  const params = parseParams(code);
  const head = src.match(/\bmodule\s+(\w+)\s*(?:#\s*\([\s\S]*?\))?\s*\(([\s\S]*?)\)\s*;/);
  if (!head) return null;
  const moduleName = head[1];
  const portList = head[2];

  const ports = [];
  let cur = { dir: null, isReg: false, range: null };
  portList.split(",").forEach((tokRaw) => {
    const tok = tokRaw.trim();
    if (!tok) return;
    const dirM = tok.match(/\b(input|output|inout)\b/);
    if (dirM) {
      cur = { dir: dirM[1], isReg: /\b(reg|logic)\b/.test(tok), range: (tok.match(/\[[^\]]*\]/) || [null])[0] };
    }
    // the port name is the last identifier in the token
    const names = tok.replace(/\b(input|output|inout|reg|wire|logic|signed|unsigned)\b/g, "")
      .replace(/\[[^\]]*\]/g, "").trim();
    const name = (names.match(/(\w+)\s*$/) || [])[1];
    if (!name || !cur.dir) return;
    ports.push({ name: name, dir: cur.dir, isReg: cur.isReg, width: resolveWidth(cur.range, params) });
  });

  // Non-ANSI fallback: directions declared in the body.
  if (ports.length && ports.every((p) => p.dir)) {
    // ANSI already gave us directions — good.
  } else {
    // (rare) leave as-is; ANSI covers the LLM-generated common case.
  }

  // Identify clock + reset among the inputs.
  const inputs = ports.filter((p) => p.dir === "input");
  const clock = (inputs.find((p) => /clk|clock/i.test(p.name)) || null);
  const rstPort = inputs.find((p) => /rst|reset/i.test(p.name)) || null;
  let reset = null;
  if (rstPort) {
    const activeLow = /(_n$|n$|_ni$)/i.test(rstPort.name) || new RegExp("negedge\\s+" + rstPort.name).test(src) || new RegExp("!\\s*" + rstPort.name).test(src);
    const async = new RegExp("negedge\\s+" + rstPort.name).test(src) || new RegExp("posedge\\s+" + rstPort.name).test(src);
    reset = { name: rstPort.name, activeLow: !!activeLow, async: !!async };
  }
  return { module: moduleName, params: params, ports: ports, clock: clock, reset: reset };
}

function decl(width, name, kind) {
  const w = width > 1 ? "[" + (width - 1) + ":0] " : "";
  return kind + " " + w + name + ";";
}

// Generate the smoke testbench source + its top module name.
function genSmokeTestbench(iface) {
  const tb = "tb_" + iface.module;
  const clk = iface.clock;
  const rst = iface.reset;
  const outs = iface.ports.filter((p) => p.dir === "output");
  const stimIns = iface.ports.filter(
    (p) => p.dir === "input" && (!clk || p.name !== clk.name) && (!rst || p.name !== rst.name)
  );

  const L = [];
  L.push("`timescale 1ns/1ps");
  L.push("module " + tb + ";");
  // declarations: inputs as reg, outputs as wire
  iface.ports.forEach((p) => {
    if (p.dir === "input") L.push("  " + decl(p.width, p.name, "reg"));
    else L.push("  " + decl(p.width, p.name, "wire"));
  });
  L.push("  integer i; integer errors = 0;");
  L.push("  reg [31:0] lfsr = 32'hACE12345;");
  L.push("  reg [" + (Math.max(1, outs.reduce((a, p) => a + p.width, 0)) - 1) + ":0] prev_out; reg toggled = 0; reg first = 1;");

  // DUT instance
  const conns = iface.ports.map((p) => "." + p.name + "(" + p.name + ")").join(", ");
  L.push("  " + iface.module + " dut(" + conns + ");");

  // clock
  if (clk) {
    L.push("  initial " + clk.name + " = 0;");
    L.push("  always #5 " + clk.name + " = ~" + clk.name + ";");
  }

  const outConcat = outs.length ? "{" + outs.map((p) => p.name).join(", ") + "}" : "1'b0";

  L.push("  task step; begin");
  if (clk) L.push("    @(posedge " + clk.name + "); #1;");
  else L.push("    #5;");
  L.push("  end endtask");

  L.push("  initial begin");
  // init inputs
  stimIns.forEach((p) => L.push("    " + p.name + " = 0;"));
  // reset sequence
  if (rst) {
    L.push("    " + rst.name + " = " + (rst.activeLow ? "1'b0" : "1'b1") + "; // assert reset");
    L.push("    repeat (3) step;");
    L.push("    " + rst.name + " = " + (rst.activeLow ? "1'b1" : "1'b0") + "; // release reset");
    L.push("    step;");
  } else {
    L.push("    step;");
  }
  // main stimulus loop with X-check
  L.push("    for (i = 0; i < 64; i = i + 1) begin");
  stimIns.forEach((p) => {
    L.push("      " + p.name + " = lfsr[" + (p.width - 1) + ":0];");
    L.push("      lfsr = {lfsr[30:0], lfsr[31]^lfsr[21]^lfsr[1]^lfsr[0]};");
  });
  L.push("      step;");
  if (outs.length) {
    L.push("      if (^(" + outConcat + ") === 1'bx) begin errors = errors + 1; if (errors <= 3) $display(\"SMOKE_X: undefined output at i=%0d\", i); end");
    L.push("      if (first) begin prev_out <= " + outConcat + "; first <= 0; end");
    L.push("      else if (" + outConcat + " !== prev_out) toggled <= 1;");
  }
  L.push("    end");
  if (outs.length) L.push("    if (!toggled) $display(\"SMOKE_WARN: outputs never changed (possible stuck/undriven)\");");
  L.push("    if (errors == 0) $display(\"SMOKE_PASS\"); else $display(\"SMOKE_FAIL errors=%0d\", errors);");
  L.push("    $finish;");
  L.push("  end");
  // timeout guard
  L.push("  initial begin #200000; $display(\"SMOKE_FAIL timeout\"); $finish; end");
  L.push("endmodule");
  return { code: L.join("\n"), top: tb };
}

module.exports = { parseInterface, genSmokeTestbench, resolveWidth, parseParams };
