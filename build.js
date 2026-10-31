// Builds the static data cobunai.com reads from GitHub Pages: feed.json, digest.json, status.json.
// Runs hourly in GitHub Actions (.github/workflows/build.yml). Locally: `npm run build`.
import fs from "fs";
import { fetchAll, makeChat, generateWhys, buildDigest, PROMPT_VERSION } from "./pipeline.js";

const OUT  = process.env.OUT_DIR || "public";
const PREV = process.env.PREV_URL; // the published site — reuse AI text that is still current
const chat = process.env.LLM_URL
  ? makeChat({ url:process.env.LLM_URL, key:process.env.LLM_KEY, model:process.env.LLM_MODEL })
  : null;

async function loadPrev(name) {
  if(!PREV) return null;
  try {
    const res = await fetch(`${PREV}/${name}`, { signal:AbortSignal.timeout(15000) });
    return res.ok ? await res.json() : null;
  } catch { return null; }
}

const started = Date.now();
const aiVersion = chat ? `${process.env.LLM_MODEL}/v${PROMPT_VERSION}` : null;
const [prevFeed, prevDigest] = await Promise.all([loadPrev("feed.json"), loadPrev("digest.json")]);
// AI text from a different model or prompt version gets rewritten
const prevAI = prevFeed?.aiVersion === aiVersion;
const { items:fresh, failed } = await fetchAll();

// A source that failed this hour keeps its last items (up to a week old) instead of vanishing
const weekAgo = Date.now()/1000 - 7*86400;
const kept = (prevFeed?.items||[]).filter(i => failed.includes(i.src) && (i.time||0) > weekAgo);
if(kept.length) console.log(`↩  Kept ${kept.length} items from failed sources: ${[...new Set(kept.map(i=>i.src))].join(", ")}`);
const items = [...fresh, ...kept].sort((a,b) => b.time - a.time);

// A bad run fails the workflow, so the last good data stays live
if(items.length < 50) {
  console.error(`Only ${items.length} items — not publishing`);
  process.exit(1);
}

const whyCache = new Map();
if(prevAI) {
  for(const id of prevFeed.whyChecked || []) whyCache.set(id, ""); // checked, nothing worth a line
  for(const i of prevFeed.items || []) if(i.why) whyCache.set(i.id, i.why);
}
if(chat) await generateWhys(items, chat, whyCache);
const feedItems = items.map(i => ({ ...i, why:whyCache.get(i.id) || "" }));
const digest = await buildDigest(feedItems, chat, prevAI ? prevDigest : null);

const generatedAt = new Date().toISOString();
const sources = {};
for(const i of feedItems) sources[i.src] = (sources[i.src]||0) + 1;

fs.mkdirSync(OUT, { recursive:true });
const write = (name, data) => fs.writeFileSync(`${OUT}/${name}`, JSON.stringify(data));
const whyChecked = feedItems.filter(i => whyCache.get(i.id) === "").map(i => i.id);
write("feed.json", { items:feedItems, generatedAt, aiVersion, whyChecked });
write("digest.json", { ...digest, generatedAt, aiVersion });
write("status.json", {
  generatedAt, items:feedItems.length, sources, failed,
  model: aiVersion,
  withWhy: feedItems.filter(i => i.why).length,
  stories: digest.categories.filter(c => c.headline).length + "/" + digest.categories.length,
  seconds: Math.round((Date.now()-started)/1000),
});
console.log(`📦 Wrote ${feedItems.length} items to ${OUT}/ in ${Math.round((Date.now()-started)/1000)}s`);
// rss-parser can leave sockets open, which would keep the process (and the CI job) alive
process.exit(0);
