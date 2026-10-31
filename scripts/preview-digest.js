// TEMPORARY (removed before merge): the same fresh items through the digest twice — A with the old
// 220-character text, B with the richer text — and prints both. Publishes nothing.
import { fetchAll, makeChat, addLinkText, buildDigest } from "../pipeline.js";

const chat = makeChat({ url:process.env.LLM_URL, model:process.env.LLM_MODEL });
const { items } = await fetchAll();
const rowsOf = d => d.categories.map(c => {
  const lead = c.items.find(i => i.id === c.lead);
  return { id:c.id, headline:c.headline, dek:c.dek, lead: lead ? { src:lead.srcLabel || lead.src, title:lead.title, link:lead.link } : null };
});
for(const pass of ["A", "B"]) {
  const started = Date.now();
  if(pass === "B") await addLinkText(items);
  const input = pass === "A" ? items.map(({ body, ...i }) => i) : items;
  const digest = await buildDigest(input, chat, null);
  const rows = rowsOf(digest);
  console.log(`Pass ${pass}: wrote ${rows.filter(r => r.headline).length}/${rows.length} stories in ${Math.round((Date.now() - started) / 1000)}s`);
  console.log("PREVIEW_JSON " + JSON.stringify({ pass, rows }));
}
process.exit(0);
