// Amazon Bedrock caller (Converse API) with usage metering.
//
// Unlike the BYOK providers in llm.js, this uses YOUR AWS credentials (from the
// standard AWS credential chain: env vars AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
// / AWS_REGION, or an EC2 instance role). Callers are billed against their prepaid
// credit balance based on the token counts Bedrock returns.
//
// Requires: npm i @aws-sdk/client-bedrock-runtime

let _sdk = null;
try { _sdk = require("@aws-sdk/client-bedrock-runtime"); } catch (e) { _sdk = null; }

const REGION = process.env.AWS_REGION || process.env.BEDROCK_REGION || "us-east-1";
let _client = null;
function client() {
  if (!_sdk) throw new Error("Amazon Bedrock is not available: run `npm i @aws-sdk/client-bedrock-runtime` on the backend.");
  if (!_client) _client = new _sdk.BedrockRuntimeClient({ region: REGION });
  return _client;
}

// ---- Pricing --------------------------------------------------------------
// Numbers below are DOLLARS PER 1,000,000 TOKENS. Because 1 micro = $1e-6, the
// per-1M-dollar figure equals micros-per-token, so cost math stays integer-ish:
//   cost_micros = ceil(MARKUP * (inTok*inRate + outTok*outRate))
// Keep these in sync with the AWS Bedrock price list for your region, then set
// BILLING_MARKUP (e.g. 1.4 = 40% margin) to cover overhead + margin.
const MARKUP = parseFloat(process.env.BILLING_MARKUP || "1.4");
const PRICING = {
  // modelId (or a substring of it) : { in: $/1M input tok, out: $/1M output tok }
  // --- Bedrock open models offered on the free tier (approx US on-demand list) --
  "llama3-3-70b":   { in: 0.72,  out: 0.72 },
  "llama4-maverick":{ in: 0.24,  out: 0.97 },
  "llama4-scout":   { in: 0.17,  out: 0.66 },
  "llama3-1-8b":    { in: 0.22,  out: 0.22 },
  "llama3-1-70b":   { in: 0.72,  out: 0.72 },
  "deepseek.r1":    { in: 1.35,  out: 5.40 },
  "deepseek.v3.2":  { in: 0.62,  out: 1.85 },
  "deepseek.v3":    { in: 0.58,  out: 1.68 },
  "nova-pro":       { in: 0.80,  out: 3.20 },
  "nova-lite":      { in: 0.06,  out: 0.24 },
  "nova-micro":     { in: 0.035, out: 0.14 },
  "pixtral-large":  { in: 2.0,   out: 6.0 },
  // --- legacy Claude entries (kept for any paid/BYOK-via-Bedrock use) ----------
  "anthropic.claude-3-5-sonnet-20241022-v2:0": { in: 3.0, out: 15.0 },
  "anthropic.claude-3-5-haiku-20241022-v1:0": { in: 0.8, out: 4.0 },
  "anthropic.claude-3-haiku-20240307-v1:0": { in: 0.25, out: 1.25 },
  "anthropic.claude-3-opus-20240229-v1:0": { in: 15.0, out: 75.0 },
};
// Fallback price for a model not in the table (assume Sonnet-class, so we never
// UNDER-charge ourselves into a loss on an unknown model).
const DEFAULT_PRICE = { in: 3.0, out: 15.0 };

function priceFor(model) {
  // Inference-profile IDs/ARNs often prefix a region, e.g. "us.anthropic.claude-…".
  // Match on the anthropic.* suffix so profiles price correctly.
  if (PRICING[model]) return PRICING[model];
  const key = Object.keys(PRICING).find((k) => String(model).indexOf(k) >= 0);
  return key ? PRICING[key] : DEFAULT_PRICE;
}

function costMicros(model, inTok, outTok) {
  const p = priceFor(model);
  return Math.ceil(MARKUP * ((inTok || 0) * p.in + (outTok || 0) * p.out));
}

// RAW AWS cost (no markup), in micros. The free tier debits this — it's the real
// dollars the owner pays AWS, with no paid-user margin applied.
function rawCostMicros(model, inTok, outTok) {
  const p = priceFor(model);
  return Math.ceil((inTok || 0) * p.in + (outTok || 0) * p.out);
}

function parseDataUrl(url) {
  const m = String(url).match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return { mediaType: "image/jpeg", data: "" };
  return { mediaType: m[1], data: m[2] };
}
function imageFormat(mediaType) {
  const t = String(mediaType).toLowerCase();
  if (t.indexOf("png") >= 0) return "png";
  if (t.indexOf("gif") >= 0) return "gif";
  if (t.indexOf("webp") >= 0) return "webp";
  return "jpeg";
}

// Call Bedrock's Converse API. Returns { text, usage:{inputTokens, outputTokens} }.
//   model: a Bedrock model id or inference-profile id/ARN
//   system: optional system prompt string
//   messages: [{ role:'user'|'assistant', content, images?:[dataUrl] }]
async function callBedrock({ model, system, messages, temperature }) {
  const conv = (messages || []).map((m) => {
    const content = [];
    if (m.images && m.images.length) {
      m.images.forEach((url) => {
        const d = parseDataUrl(url);
        if (!d.data) return;
        content.push({
          image: {
            format: imageFormat(d.mediaType),
            source: { bytes: Buffer.from(d.data, "base64") },
          },
        });
      });
    }
    if (m.content) content.push({ text: m.content });
    if (!content.length) content.push({ text: "" });
    return { role: m.role === "assistant" ? "assistant" : "user", content };
  });

  const input = {
    modelId: model,
    messages: conv,
    inferenceConfig: temperature != null ? { maxTokens: 8192, temperature } : { maxTokens: 8192 },
  };
  if (system) input.system = [{ text: system }];

  const out = await client().send(new _sdk.ConverseCommand(input));
  const blocks = (out.output && out.output.message && out.output.message.content) || [];
  const text = blocks.map((b) => b.text || "").join("");
  const usage = {
    inputTokens: (out.usage && out.usage.inputTokens) || 0,
    outputTokens: (out.usage && out.usage.outputTokens) || 0,
  };
  return { text, usage };
}

module.exports = { callBedrock, costMicros, rawCostMicros, priceFor, REGION, MARKUP };
