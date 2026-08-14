// Prepaid-credits billing for the Bedrock provider.
//
// Pieces:
//   - authUser(req)                 : verify the caller's Supabase JWT -> user id
//   - getBalance(userId)            : current credit balance (micros)
//   - assertCredits(userId)         : throw {status:402} if balance <= 0
//   - chargeUsage(userId, kind, usage) : debit for a completed call, return balance
//   - billingRouter                 : GET /billing/account, /billing/usage,
//                                     POST /billing/checkout   (JSON body)
//   - billingWebhook                : POST /billing/webhook    (Stripe, RAW body)
//
// Server-only secrets (set as env vars on EC2; NEVER shipped to the browser):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (service_role bypasses RLS)
//   STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
//   STRIPE_PRICE_ID        (a Stripe Price for one "credit pack", e.g. $10)
//   CREDIT_PACK_MICROS     (credits granted per pack; default 10_000_000 = $10)
//   APP_URL                (frontend origin, for Stripe redirect back)
//
// Requires: npm i @supabase/supabase-js stripe

const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const admin =
  SUPABASE_URL && SERVICE_KEY
    ? createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
    : null;

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "";
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";
const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID || "";
const CREDIT_PACK_MICROS = parseInt(process.env.CREDIT_PACK_MICROS || "10000000", 10); // $10
const APP_URL = process.env.APP_URL || "";
const stripe = STRIPE_SECRET_KEY ? require("stripe")(STRIPE_SECRET_KEY) : null;

function billingReady() {
  return !!admin;
}

// ---- Auth: turn the Bearer JWT from the browser into a verified user id ------
async function authUser(req) {
  if (!admin) { const e = new Error("billing not configured"); e.status = 500; throw e; }
  const h = req.headers["authorization"] || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!token) { const e = new Error("sign in required"); e.status = 401; throw e; }
  const { data, error } = await admin.auth.getUser(token); // validates signature + expiry
  if (error || !data || !data.user) { const e = new Error("invalid session"); e.status = 401; throw e; }
  return data.user.id;
}

// ---- Balance / enforcement --------------------------------------------------
async function getBalance(userId) {
  const { data } = await admin
    .from("billing_accounts")
    .select("credit_micros")
    .eq("user_id", userId)
    .maybeSingle();
  return data ? Number(data.credit_micros) : 0;
}

// Gate a call BEFORE running it: prepaid model, so we only require a positive
// balance (the exact cost isn't known until the tokens come back).
async function assertCredits(userId) {
  const bal = await getBalance(userId);
  if (bal <= 0) { const e = new Error("out of credits"); e.status = 402; throw e; }
  return bal;
}

// Debit for a completed call. `usage` is { inputTokens, outputTokens, model }.
// Cost is computed with the Bedrock price table + markup. Returns new balance.
async function chargeUsage(userId, kind, usage) {
  const { costMicros } = require("./bedrock");
  const model = (usage && usage.model) || "";
  const inTok = (usage && usage.inputTokens) || 0;
  const outTok = (usage && usage.outputTokens) || 0;
  if (!inTok && !outTok) return await getBalance(userId); // nothing happened
  const cost = costMicros(model, inTok, outTok);
  const { data, error } = await admin.rpc("charge_user", {
    p_user: userId, p_cost: cost, p_kind: kind, p_model: model, p_in: inTok, p_out: outTok,
  });
  if (error) throw new Error("charge failed: " + error.message);
  return Number(data);
}

// Find or create the user's Stripe customer, remembering it on the account row.
async function stripeCustomerFor(userId) {
  const { data } = await admin
    .from("billing_accounts").select("stripe_customer_id").eq("user_id", userId).maybeSingle();
  if (data && data.stripe_customer_id) return data.stripe_customer_id;
  const customer = await stripe.customers.create({ metadata: { user_id: userId } });
  await admin.from("billing_accounts")
    .upsert({ user_id: userId, stripe_customer_id: customer.id }, { onConflict: "user_id" });
  return customer.id;
}

// ---- Express: JSON billing routes ------------------------------------------
const express = require("express");
const billingRouter = express.Router();

// Current balance (dollars) — the frontend shows this as the credits badge.
billingRouter.get("/account", async (req, res) => {
  try {
    const userId = await authUser(req);
    const micros = await getBalance(userId);
    res.json({ credits: micros / 1e6, credit_micros: micros });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

// Recent usage events (for a simple history view).
billingRouter.get("/usage", async (req, res) => {
  try {
    const userId = await authUser(req);
    const { data } = await admin
      .from("usage_events")
      .select("created_at, kind, model, input_tokens, output_tokens, cost_micros")
      .eq("user_id", userId).order("created_at", { ascending: false }).limit(50);
    res.json({ events: data || [] });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

// Start a Stripe Checkout to buy one credit pack. Returns { url } to redirect to.
billingRouter.post("/checkout", async (req, res) => {
  try {
    if (!stripe || !STRIPE_PRICE_ID) { const e = new Error("payments not configured"); e.status = 500; throw e; }
    const userId = await authUser(req);
    const customer = await stripeCustomerFor(userId);
    const origin = APP_URL || req.headers["origin"] || "";
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer,
      line_items: [{ price: STRIPE_PRICE_ID, quantity: 1 }],
      success_url: origin + "/?topup=success",
      cancel_url: origin + "/?topup=cancel",
      // Read back on the webhook to know who + how much to credit.
      metadata: { user_id: userId, credit_micros: String(CREDIT_PACK_MICROS) },
      payment_intent_data: { metadata: { user_id: userId, credit_micros: String(CREDIT_PACK_MICROS) } },
    });
    res.json({ url: session.url });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

// ---- Express: Stripe webhook (RAW body, signature-verified) ------------------
// Mount this with express.raw BEFORE any express.json(). This is the ONLY place
// credits are granted — never trust the browser's success redirect.
const billingWebhook = [
  express.raw({ type: "application/json" }),
  async (req, res) => {
    if (!stripe || !STRIPE_WEBHOOK_SECRET) return res.status(500).end();
    let event;
    try {
      event = stripe.webhooks.constructEvent(
        req.body, req.headers["stripe-signature"], STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      return res.status(400).send("bad signature: " + err.message);
    }
    try {
      if (event.type === "checkout.session.completed") {
        const s = event.object || event.data.object;
        const md = (s && s.metadata) || {};
        if (s.payment_status === "paid" && md.user_id && md.credit_micros) {
          await admin.rpc("add_credits", {
            p_event: event.id,                 // dedupe key → applied exactly once
            p_user: md.user_id,
            p_amount: parseInt(md.credit_micros, 10),
          });
        }
      }
    } catch (e) {
      // Log and 500 so Stripe retries; add_credits is idempotent on event.id.
      console.error("[billing] webhook apply failed:", e.message);
      return res.status(500).end();
    }
    res.json({ received: true });
  },
];

module.exports = {
  billingReady, authUser, getBalance, assertCredits, chargeUsage,
  billingRouter, billingWebhook,
};
