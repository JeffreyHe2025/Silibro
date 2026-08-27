// Multi-provider LLM caller with timing. Returns { text, ms, inputTokens,
// outputTokens, error }. Providers: "anthropic", "google", and "openai-compatible"
// (OpenAI, DeepSeek, OpenRouter/Together, … — anything with a /chat/completions
// endpoint; set baseURL in the model config). Uses Node 18+ global fetch.

async function callModel(m, systemPrompt, userPrompt) {
  const key = process.env[m.keyEnv];
  if (!key) return { error: "no API key (" + m.keyEnv + " not set)", skipped: true };

  const t0 = Date.now();
  try {
    let out;
    if (m.provider === "anthropic") out = await callAnthropic(m, key, systemPrompt, userPrompt);
    else if (m.provider === "google") out = await callGoogle(m, key, systemPrompt, userPrompt);
    else out = await callOpenAICompatible(m, key, systemPrompt, userPrompt); // openai-compatible
    return { ...out, ms: Date.now() - t0 };
  } catch (e) {
    return { error: String((e && e.message) || e), ms: Date.now() - t0 };
  }
}

async function callAnthropic(m, key, sys, user) {
  const body = { model: m.model, max_tokens: 8192, messages: [{ role: "user", content: user }] };
  if (sys) body.system = sys;
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error("HTTP " + r.status + ": " + (await r.text()).slice(0, 300));
  const d = await r.json();
  const text = (d.content || []).map((b) => b.text || "").join("");
  return { text, inputTokens: d.usage && d.usage.input_tokens, outputTokens: d.usage && d.usage.output_tokens };
}

async function callGoogle(m, key, sys, user) {
  const url = "https://generativelanguage.googleapis.com/v1beta/models/" +
    encodeURIComponent(m.model) + ":generateContent?key=" + encodeURIComponent(key);
  const body = { contents: [{ role: "user", parts: [{ text: user }] }] };
  if (sys) body.systemInstruction = { parts: [{ text: sys }] };
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error("HTTP " + r.status + ": " + (await r.text()).slice(0, 300));
  const d = await r.json();
  const cand = d.candidates && d.candidates[0];
  const text = (cand && cand.content && cand.content.parts || []).map((p) => p.text || "").join("");
  const um = d.usageMetadata || {};
  return { text, inputTokens: um.promptTokenCount, outputTokens: um.candidatesTokenCount };
}

async function callOpenAICompatible(m, key, sys, user) {
  const base = (m.baseURL || "https://api.openai.com/v1").replace(/\/+$/, "");
  const msgs = [];
  if (sys) msgs.push({ role: "system", content: sys });
  msgs.push({ role: "user", content: user });
  const r = await fetch(base + "/chat/completions", {
    method: "POST",
    headers: { authorization: "Bearer " + key, "content-type": "application/json" },
    body: JSON.stringify({ model: m.model, messages: msgs }),
  });
  if (!r.ok) throw new Error("HTTP " + r.status + ": " + (await r.text()).slice(0, 300));
  const d = await r.json();
  const text = d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content || "";
  const u = d.usage || {};
  return { text, inputTokens: u.prompt_tokens, outputTokens: u.completion_tokens };
}

module.exports = { callModel };
