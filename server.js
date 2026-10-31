// Legacy API for the Render deploy. cobunai.com is moving to the static JSON that build.js
// publishes to GitHub Pages — delete this file (and express/cors) once the site reads that.
import express from "express";
import cors from "cors";
import { fetchAll, generateWhys, buildDigest } from "./pipeline.js";

const app  = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: "*" }));
app.use(express.json());

// ── RATE LIMITER ─────────────────────────────────────────────────
const rateLimitMap = new Map();
const rateLimit = (key, maxReqs, windowMs) => {
  const now = Date.now();
  const record = rateLimitMap.get(key) || { count: 0, start: now };
  if(now - record.start > windowMs) {
    rateLimitMap.set(key, { count: 1, start: now });
    return false;
  }
  record.count++;
  rateLimitMap.set(key, record);
  return record.count > maxReqs;
};

// ── Groq ──────────────────────────────────────────────────────────
// Groq retires models without notice, so pick the first preferred one this key can use.
const GROQ_PREFERRED = [
  process.env.GROQ_MODEL,
  "llama-3.3-70b-versatile",
  "meta-llama/llama-4-maverick-17b-128e-instruct",
  "meta-llama/llama-4-scout-17b-16e-instruct",
  "moonshotai/kimi-k2-instruct-0905",
  "moonshotai/kimi-k2-instruct",
  "openai/gpt-oss-120b",
  "llama-3.1-8b-instant",
  "openai/gpt-oss-20b",
].filter(Boolean);
let GROQ_MODEL = null;

async function pickGroqModel() {
  if(!process.env.GROQ_API_KEY) throw new Error("GROQ_API_KEY not set");
  const res = await fetch("https://api.groq.com/openai/v1/models", {
    headers:{ "Authorization":"Bearer "+process.env.GROQ_API_KEY },
    signal:AbortSignal.timeout(10000)
  });
  const data = await res.json();
  if(!res.ok) throw new Error(`Groq models ${res.status}: ${data.error?.message||"unknown error"}`);
  const ids = (data.data||[]).filter(m => m.active !== false).map(m => m.id);
  GROQ_MODEL = GROQ_PREFERRED.find(m => ids.includes(m))
    || ids.find(id => !/whisper|guard|tts|playai|orpheus|compound/i.test(id))
    || null;
  console.log(`🧠 Groq model: ${GROQ_MODEL||"none available"}`);
  return GROQ_MODEL;
}

async function groqChat(prompt, { maxTokens=200, temperature=0.3, timeout=20000 }={}) {
  if(!GROQ_MODEL && !(await pickGroqModel())) throw new Error("No Groq chat model available");
  // gpt-oss models spend tokens reasoning before answering
  const reasoning = GROQ_MODEL.startsWith("openai/gpt-oss");
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method:"POST",
    headers:{"Content-Type":"application/json","Authorization":"Bearer "+process.env.GROQ_API_KEY},
    body:JSON.stringify({
      model:GROQ_MODEL,
      messages:[{role:"user",content:prompt}],
      max_tokens: reasoning ? maxTokens + 400 : maxTokens,
      temperature,
      ...(reasoning ? { reasoning_effort:"low" } : {}),
    }),
    signal:AbortSignal.timeout(timeout)
  });
  const data = await res.json();
  if(!res.ok) {
    if(/model_not_found|model_decommissioned/.test(data.error?.code||"")) GROQ_MODEL = null; // re-pick next call
    throw new Error(`Groq ${res.status}: ${data.error?.message||"unknown error"}`);
  }
  return data.choices?.[0]?.message?.content?.trim() || "";
}

// ── Cache ─────────────────────────────────────────────────────────
const CACHE = { items: [], lastFetch: 0 };
const WHY_CACHE = new Map();
let DIGEST_CACHE = { data: null, ts: 0 };
const withWhys = items => items.map(i => ({ ...i, why: WHY_CACHE.get(i.id) || "" }));

async function refresh() {
  const { items } = await fetchAll();
  if(!items.length) return console.log("⚠️ fetchAll returned empty — keeping existing cache");
  CACHE.items = withWhys(items);
  CACHE.lastFetch = Date.now();
  DIGEST_CACHE = { data: null, ts: 0 };
  await generateWhys(items, groqChat, WHY_CACHE);
  CACHE.items = withWhys(items);
  console.log(`✅ Cache refreshed — ${CACHE.items.length} items`);
}

// ── Routes ────────────────────────────────────────────────────────
app.get("/feed", async (req, res) => {
  try {
    // Auto-refresh keeps the cache fresh — never make a visitor wait on a full fetch if we have items
    if(!CACHE.items.length) await refresh();
    res.json({ items: CACHE.items, cached: true, age: Math.round((Date.now()-CACHE.lastFetch)/1000) });
  } catch(err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/health", (_, res) => res.json({ ok:true, items:CACHE.items.length, lastFetch:CACHE.lastFetch, model:GROQ_MODEL }));

app.get("/refresh", async (req, res) => {
  try {
    await refresh();
    res.json({ ok: true, items: CACHE.items.length });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /summarize  { title, sum, src, type } → { summary }
app.post("/summarize", async (req, res) => {
  const ip = req.headers["x-forwarded-for"]?.split(",")[0] || req.socket.remoteAddress || "unknown";
  if(rateLimit(`summarize:${ip}`, 20, 60_000)) return res.status(429).json({ error: "Too many requests. Please slow down." });
  const { title, sum, src, type } = req.body || {};
  if (!title) return res.status(400).json({ error: "title required" });
  try {
    const prompt = `You are a staff engineer who reads everything in AI. Be direct and technical.

Article:
Title: ${title}
Source: ${src || "unknown"}
Type: ${type || "unknown"}
Summary: ${sum || "N/A"}

Write 2-3 sentences for an AI builder audience: what happened, what it means practically, and any gotcha worth knowing. Use only the facts above. No hype words, no preamble, no bullet points.`;
    const summary = (await groqChat(prompt, { maxTokens:250 })) || "Could not generate summary.";
    res.json({ summary });
  } catch(e) {
    console.error("Summarize error:", e.message);
    res.status(502).json({ error: e.message });
  }
});

app.get("/digest", async (req, res) => {
  if(DIGEST_CACHE.data && Date.now() - DIGEST_CACHE.ts < 10*60*1000) return res.json(DIGEST_CACHE.data);
  try {
    const digest = await buildDigest(CACHE.items, groqChat, DIGEST_CACHE.data);
    DIGEST_CACHE = { data: { ...digest, feedAge: Math.round((Date.now() - CACHE.lastFetch)/1000) }, ts: Date.now() };
    res.json(DIGEST_CACHE.data);
  } catch(e) {
    console.error("Digest error:", e);
    res.status(500).json({ error: e.message });
  }
});

setInterval(() => refresh().catch(e => console.error("Auto-refresh failed:", e.message)), 15 * 60 * 1000);

// ── KEEP ALIVE (prevent Render free-tier sleep) ────────────────
const SELF_URL = process.env.RENDER_EXTERNAL_URL || null;
if(SELF_URL) {
  setInterval(async () => {
    try { await fetch(`${SELF_URL}/health`); }
    catch(e) {}
  }, 4 * 60 * 1000); // ping every 4 minutes
}

app.listen(PORT, () => {
  console.log(`\n🚀 Pulse backend — http://localhost:${PORT}\n`);
  pickGroqModel().catch(e => console.warn("Groq model pick failed:", e.message));
  refresh().catch(e => console.error("Initial fetch failed:", e.message));
});
