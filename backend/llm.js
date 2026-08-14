// Minimal multi-provider LLM caller (BYOK). Uses Node 18+ global fetch.
//
// cfg: { provider, key, model }
//   provider: "google" | "gemini" | "openrouter" | "openai" | "anthropic"
//   messages: [{ role: "user" | "assistant", content: string }]
//   system:   optional system prompt

const { AsyncLocalStorage } = require("async_hooks");
const { callBedrock } = require("./bedrock");

// Per-request token accumulator. When a handler runs inside runWithUsage(), every
// Bedrock call made anywhere under it (chat OR the whole build/flow pipeline) adds
// its token counts here, so the server can charge the total once at the end —
// without threading anything through build.js/flow.js.
const usageStore = new AsyncLocalStorage();
function runWithUsage(fn) {
  const acc = { inputTokens: 0, outputTokens: 0, calls: 0, model: "" };
  return usageStore.run(acc, async () => {
    const result = await fn();
    return { result, usage: acc };
  });
}
function recordUsage(model, u) {
  const acc = usageStore.getStore();
  if (!acc) return;
  acc.inputTokens += (u && u.inputTokens) || 0;
  acc.outputTokens += (u && u.outputTokens) || 0;
  acc.calls += 1;
  acc.model = model || acc.model;
}

function parseDataUrl(url) {
  const m = url.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return { mediaType: "image/jpeg", data: "" };
  return { mediaType: m[1], data: m[2] };
}

async function callLLM({ provider, key, model, system, messages }) {
  // Bedrock: uses the server's AWS creds (no BYOK key) and meters token usage.
  if (provider === "bedrock") {
    const { text, usage } = await callBedrock({ model, system, messages });
    recordUsage(model, usage);
    return text;
  }

  if (provider === "google" || provider === "gemini") {
    const url =
      "https://generativelanguage.googleapis.com/v1beta/models/" +
      encodeURIComponent(model) +
      ":generateContent?key=" +
      encodeURIComponent(key);
    const contents = messages.map((m) => {
      const parts = [];
      if (m.images) {
        m.images.forEach((url) => {
          const d = parseDataUrl(url);
          parts.push({ inline_data: { mime_type: d.mediaType, data: d.data } });
        });
      }
      if (m.content) parts.push({ text: m.content });
      if (!parts.length) parts.push({ text: "" });
      return { role: m.role === "assistant" ? "model" : "user", parts };
    });
    const body = { contents };
    if (system) body.systemInstruction = { parts: [{ text: system }] };
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error("LLM error " + r.status + ": " + (await r.text()));
    const d = await r.json();
    return (
      (d.candidates &&
        d.candidates[0] &&
        d.candidates[0].content &&
        d.candidates[0].content.parts[0] &&
        d.candidates[0].content.parts[0].text) ||
      ""
    );
  }

  if (provider === "anthropic") {
    const msgs = messages.map((m) => {
      let content = m.content;
      if (m.images && m.images.length) {
        content = [];
        if (m.content) content.push({ type: "text", text: m.content });
        m.images.forEach((url) => {
          const d = parseDataUrl(url);
          content.push({ type: "image", source: { type: "base64", media_type: d.mediaType, data: d.data } });
        });
      }
      return { role: m.role === "assistant" ? "assistant" : "user", content };
    });
    const body = { model, max_tokens: 8192, messages: msgs };
    if (system) body.system = system;
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error("LLM error " + r.status + ": " + (await r.text()));
    const d = await r.json();
    return (d.content && d.content[0] && d.content[0].text) || "";
  }

  // OpenAI-compatible (OpenRouter / OpenAI)
  const endpoint =
    provider === "openai"
      ? "https://api.openai.com/v1/chat/completions"
      : "https://openrouter.ai/api/v1/chat/completions";
  const histMsgs = messages.map((m) => {
    if (m.images && m.images.length) {
      const parts = [];
      if (m.content) parts.push({ type: "text", text: m.content });
      m.images.forEach((url) => { parts.push({ type: "image_url", image_url: { url } }); });
      return { role: m.role, content: parts };
    }
    return { role: m.role, content: m.content };
  });
  const msgs = system ? [{ role: "system", content: system }].concat(histMsgs) : histMsgs;
  const r = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages: msgs }),
  });
  if (!r.ok) throw new Error("LLM error " + r.status + ": " + (await r.text()));
  const d = await r.json();
  return (d.choices && d.choices[0] && d.choices[0].message.content) || "";
}

module.exports = { callLLM, runWithUsage, recordUsage };
