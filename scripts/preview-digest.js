// TEMPORARY (removed before merge): writes the digest from the live feed with the new prompt and prints
// before/after rows. Publishes nothing.
import { makeChat, buildDigest } from "../pipeline.js";

const base = process.env.PREV_URL || "https://data.cobunai.com";
const [feed, live] = await Promise.all(["feed.json", "digest.json"].map(n => fetch(`${base}/${n}`).then(r => r.json())));
const chat = makeChat({ url:process.env.LLM_URL, model:process.env.LLM_MODEL });

const before = new Map(live.categories.map(c => [c.id, c.summary]));
// Two independent passes, to see how much the text varies from run to run
for(let pass = 1; pass <= 2; pass++) {
  const started = Date.now();
  const digest = await buildDigest(feed.items, chat, null);
  const rows = digest.categories.map(c => {
    const lead = c.items.find(i => i.id === c.lead);
    return { id:c.id, before:before.get(c.id) || "", headline:c.headline, dek:c.dek,
      lead: lead ? { src:lead.srcLabel || lead.src, time:lead.time, title:lead.title, link:lead.link } : null };
  });
  console.log(`Pass ${pass}: wrote ${rows.filter(r => r.headline).length}/${rows.length} stories in ${Math.round((Date.now() - started) / 1000)}s`);
  console.log("PREVIEW_JSON " + JSON.stringify({ pass, feedAt:feed.generatedAt, rows }));
}
process.exit(0);
