// Two-agent LangGraph flow: Verifier -> (human approval) -> Builder.
//
//   START -> verifier -> approval --(approved)--> builder -> END
//                          ^                 |
//                          └──(rejected)─────┘   (loop back with the user's changes)
//
// * Verifier: turns the user's prompt into a design spec (Markdown).
// * approval: pauses via LangGraph's interrupt() so the frontend can ask the
//   user "happy with this spec?". Resumed with { approved, changes }.
// * Builder: reuses build.js (bottom-up build + iverilog compile check).
//
// LangGraph only orchestrates the graph + the human-in-the-loop pause; the
// actual model calls go through our existing BYOK llm.js, and the build through
// build.js. The checkpointer (MemorySaver) keeps each run's state in memory
// keyed by threadId, so /flow/start and /flow/approve resume the same run.

const { callLLM } = require("./llm");
const { buildDesign } = require("./build");

// LangGraph ships as ESM; load it lazily so this CommonJS backend can use it.
let _lg = null;
async function lg() {
  if (!_lg) _lg = await import("@langchain/langgraph");
  return _lg;
}

// Live progress listeners, keyed by threadId. The builder node emits build
// events (plan / building / attempt / built) here so the HTTP handler can
// stream them to the browser as they happen, instead of one dump at the end.
const progressListeners = new Map();

// Mid-build decision channel, keyed by threadId. When the build passes the
// verification threshold it emits a "budgetDecision" event and awaits the user's
// choice; POST /flow/decision resolves the pending promise here so the build (which
// is still running inside the open stream) can continue.
const pendingDecisions = new Map(); // threadId -> resolve(choice)
function resolveDecision(threadId, choice) {
  const r = pendingDecisions.get(threadId);
  if (r) { pendingDecisions.delete(threadId); r(choice); return true; }
  return false;
}

let _graph = null;
async function getGraph() {
  if (_graph) return _graph;
  const { StateGraph, Annotation, MemorySaver, interrupt, START, END } = await lg();

  const S = Annotation.Root({
    prompt: Annotation(),
    images: Annotation(),
    feedback: Annotation(),
    spec: Annotation(),
    approved: Annotation(),
    provider: Annotation(),
    key: Annotation(),
    verifierModel: Annotation(),
    builderModel: Annotation(),
    threadId: Annotation(),
    files: Annotation(),
    log: Annotation(),
    summaries: Annotation(),
    manifest: Annotation(),
    dependencyGraph: Annotation(),
    review: Annotation(),
    offTopic: Annotation(),
    redirect: Annotation(),
  });

  // The Verifier writes (or rewrites) the spec.
  async function verifier(state) {
    const sys =
      "You are the Verifier in a DIGITAL HARDWARE design pipeline. You ONLY handle digital hardware " +
      "designs implementable in Verilog/SystemVerilog (RTL modules, FSMs, datapaths, arithmetic units, " +
      "memories, bus/interface logic, testbenches, and the like).\n" +
      "SCOPE GUARD: If the user's request is NOT a digital-hardware / Verilog design task — e.g. software " +
      "apps, web/mobile code, scripts, essays, general questions, math homework, images, or anything not " +
      "synthesizable to hardware — do NOT write a specification and do NOT attempt it. Instead output " +
      "EXACTLY one line: 'NOT_HARDWARE: ' followed by one friendly sentence redirecting them to describe a " +
      "digital hardware / Verilog design. Output nothing else in that case.\n" +
      "Otherwise, turn the request into a clear, complete, unambiguous design specification for a Verilog " +
      "design. Cover: overview, module list with one-line purposes, I/O ports (name, direction, width), " +
      "behavior, and any parameters or edge cases. Write it in Markdown. Output ONLY the specification — " +
      "no preamble, no code.";
    let user = "User request:\n" + state.prompt;
    if (state.feedback) {
      user +=
        "\n\nThe user reviewed your previous specification and asked for these changes:\n" +
        state.feedback +
        "\n\nRewrite the FULL specification incorporating them.";
    }
    const spec = await callLLM({
      provider: state.provider,
      key: state.key,
      model: state.verifierModel,
      system: sys,
      messages: [{ role: "user", content: user, images: state.images || [] }],
    });
    const text = (spec || "").trim();
    const m = /^NOT_HARDWARE:\s*(.*)$/i.exec(text.split("\n")[0] || "");
    if (m) {
      return {
        offTopic: true,
        redirect: (m[1] || "").trim() || "This tool only designs digital hardware in Verilog. Please describe a hardware / Verilog design and I'll build it.",
        spec: "",
        approved: false,
      };
    }
    return { spec: text, approved: false, offTopic: false };
  }

  // Human-in-the-loop gate: pause and surface the spec for approval.
  async function approval(state) {
    const decision = interrupt({ spec: state.spec });
    return {
      approved: !!(decision && decision.approved),
      feedback: (decision && decision.changes) || "",
    };
  }

  // The Builder builds the approved spec bottom-up, iverilog-checking each module.
  // It also produces a per-module summary (interface + conventions, NOT code)
  // to hand to the Verifier for review.
  async function builder(state) {
    const log = [];
    const emit = progressListeners.get(state.threadId); // live stream, if attached
    // Pause once past the verification threshold and ask the user how to proceed.
    // Awaits a promise resolved by POST /flow/decision; defaults to "continue" if
    // nothing answers within a few minutes so a closed tab can't hang the build.
    const decide = (info) => new Promise((resolve) => {
      let done = false;
      const finish = (choice) => { if (done) return; done = true; pendingDecisions.delete(state.threadId); resolve(choice); };
      pendingDecisions.set(state.threadId, finish);
      if (emit) emit({ type: "budgetDecision", used: info.used, allowRaise: info.allowRaise !== false });
      setTimeout(() => finish("continue"), 300000); // 5-min fallback
    });
    const out = await buildDesign(
      { provider: state.provider, key: state.key, model: state.builderModel },
      state.spec,
      function (ev) { log.push(ev); if (emit) emit(ev); },
      // The VERIFIER model writes the functional oracle testbench + conformance
      // review — independent of the Builder that wrote the code.
      { provider: state.provider, key: state.key, model: state.verifierModel },
      decide
    );
    return {
      files: out.files || {},
      log: log,
      summaries: out.summaries || [],
      manifest: out.manifest || [],
      dependencyGraph: out.dependencyGraph || "",
    };
  }

  // The Verifier reviews the built modules using ONLY the Builder's summaries
  // (port list, parameters, intended function, clock/reset conventions) — NOT the
  // code — so its check is independent: does each module's described interface and
  // behavior match the spec's intent?
  async function verifierReview(state) {
    const summaries = state.summaries || [];
    if (!summaries.length) return { review: "" };
    const emit = progressListeners.get(state.threadId);
    if (emit) emit({ type: "reviewing", count: summaries.length });
    const sys =
      "You are the Verifier. You are given the design spec and, for each built module, a STRUCTURED " +
      "SUMMARY (port list, parameters, intended function, clock/reset conventions). You do NOT see the " +
      "source code — by design — so judge only from these summaries against the spec. For EACH module, " +
      "state whether it matches the spec's intent, ports, parameters, and clock/reset requirements. " +
      "Flag any mismatch, missing port, or wrong reset style specifically. Be concise. Output Markdown " +
      "with one section per module and a final one-line overall verdict.";
    const manifest = state.manifest || [];
    const statusRef = manifest.length
      ? "\n\nMODULE STATUS (reference — the full module list):\n" +
        manifest.map(function (m) {
          return "- " + m.name + ": " + (m.built ? "built" : "NOT built") +
            ", " + (m.testbenched ? "testbench passing" : "not yet testbenched");
        }).join("\n")
      : "";
    const user =
      "Design spec:\n" + state.spec + statusRef +
      "\n\nBuilt module summaries (no code, as provided by the Builder):\n\n" +
      summaries.map(function (s) { return "```json\n" + JSON.stringify(s, null, 2) + "\n```"; }).join("\n\n");
    const review = await callLLM({
      provider: state.provider,
      key: state.key,
      model: state.verifierModel,
      system: sys,
      messages: [{ role: "user", content: user }],
    });
    return { review: (review || "").trim() };
  }

  function route(state) {
    return state.approved ? "builder" : "verifier";
  }
  // After the Verifier: off-topic requests end here (redirect), never reaching the build.
  function routeAfterVerify(state) {
    return state.offTopic ? "end" : "approval";
  }

  _graph = new StateGraph(S)
    .addNode("verifier", verifier)
    .addNode("approval", approval)
    .addNode("builder", builder)
    .addNode("verifierReview", verifierReview)
    .addEdge(START, "verifier")
    .addConditionalEdges("verifier", routeAfterVerify, { approval: "approval", end: END })
    .addConditionalEdges("approval", route, { verifier: "verifier", builder: "builder" })
    .addEdge("builder", "verifierReview")
    .addEdge("verifierReview", END)
    .compile({ checkpointer: new MemorySaver() });

  return _graph;
}

// Turn an invoke() result into a small, frontend-friendly shape.
function summarize(result) {
  const interrupts = result && result.__interrupt__;
  if (interrupts && interrupts.length) {
    const val = interrupts[0].value || interrupts[0];
    return { done: false, spec: (val && val.spec) || "" };
  }
  if (result && result.offTopic) {
    return { done: true, offTopic: true, redirect: result.redirect || "This tool only builds digital hardware in Verilog." };
  }
  return {
    done: true,
    files: (result && result.files) || {},
    log: (result && result.log) || [],
    summaries: (result && result.summaries) || [],
    manifest: (result && result.manifest) || [], // dev-only reference on the client
    dependencyGraph: (result && result.dependencyGraph) || "",
    review: (result && result.review) || "",
  };
}

// Kick off a run: Verifier writes the spec, then we pause at approval.
async function startFlow(opts, threadId) {
  const graph = await getGraph();
  const config = { configurable: { thread_id: threadId } };
  const result = await graph.invoke(
    {
      prompt: opts.prompt,
      images: opts.images,
      feedback: "",
      provider: opts.provider,
      key: opts.key,
      verifierModel: opts.verifierModel,
      builderModel: opts.builderModel,
      threadId: threadId,
    },
    config
  );
  return summarize(result);
}

// Resume a paused run with the user's decision.
//   { approved: true }            -> Builder runs, returns files + log
//   { approved: false, changes }  -> Verifier rewrites, pauses with a new spec
async function resumeFlow(threadId, decision, onProgress) {
  const { Command } = await lg();
  const graph = await getGraph();
  const config = { configurable: { thread_id: threadId } };
  if (onProgress) progressListeners.set(threadId, onProgress);
  try {
    const result = await graph.invoke(new Command({ resume: decision }), config);
    return summarize(result);
  } finally {
    progressListeners.delete(threadId);
    pendingDecisions.delete(threadId); // in case the build ended while awaiting a decision
  }
}

module.exports = { startFlow, resumeFlow, resolveDecision };
