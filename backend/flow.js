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
  });

  // The Verifier writes (or rewrites) the spec.
  async function verifier(state) {
    const sys =
      "You are the Verifier in a hardware design pipeline. Turn the user's request " +
      "into a clear, complete, unambiguous design specification for a Verilog design. " +
      "Cover: overview, module list with one-line purposes, I/O ports (name, direction, " +
      "width), behavior, and any parameters or edge cases. Write it in Markdown. " +
      "Output ONLY the specification — no preamble, no code.";
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
    return { spec: (spec || "").trim(), approved: false };
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
  async function builder(state) {
    const log = [];
    const emit = progressListeners.get(state.threadId); // live stream, if attached
    const out = await buildDesign(
      { provider: state.provider, key: state.key, model: state.builderModel },
      state.spec,
      function (ev) { log.push(ev); if (emit) emit(ev); }
    );
    return { files: out.files || {}, log: log };
  }

  function route(state) {
    return state.approved ? "builder" : "verifier";
  }

  _graph = new StateGraph(S)
    .addNode("verifier", verifier)
    .addNode("approval", approval)
    .addNode("builder", builder)
    .addEdge(START, "verifier")
    .addEdge("verifier", "approval")
    .addConditionalEdges("approval", route, { verifier: "verifier", builder: "builder" })
    .addEdge("builder", END)
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
  return { done: true, files: (result && result.files) || {}, log: (result && result.log) || [] };
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
  }
}

module.exports = { startFlow, resumeFlow };
