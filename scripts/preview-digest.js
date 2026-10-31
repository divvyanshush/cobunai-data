// TEMPORARY (removed before merge): the same fresh items through main's prompt (A) and this branch's
// plain-words prompt twice (B1, B2), printed side by side. Publishes nothing.
import * as next from "../pipeline.js";
import * as main from "../pipeline-main.js";

const chat = next.makeChat({ url:process.env.LLM_URL, model:process.env.LLM_MODEL });
const { items } = await next.fetchAll();
await next.addLinkText(items);
for(const [pass, mod] of [["A", main], ["B1", next], ["B2", next]]) {
  const started = Date.now();
  const digest = await mod.buildDigest(items, chat, null);
  const rows = digest.categories.map(c => {
    const lead = c.items.find(i => i.id === c.lead);
    return { id:c.id, headline:c.headline, dek:c.dek, lead: lead ? { src:lead.srcLabel || lead.src, title:lead.title } : null };
  });
  console.log(`Pass ${pass}: wrote ${rows.filter(r => r.headline).length}/${rows.length} stories in ${Math.round((Date.now() - started) / 1000)}s`);
  console.log("PREVIEW_JSON " + JSON.stringify({ pass, rows }));
}
process.exit(0);
