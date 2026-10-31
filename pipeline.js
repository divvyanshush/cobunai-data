// CobunAI data pipeline — fetch, score, cluster and summarise AI sources.
// Shared by build.js (static JSON for GitHub Pages) and server.js (legacy Render API).
import Parser from "rss-parser";
import crypto from "crypto";

const parser = new Parser();
const FEED_HEADERS = {
  "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
  "User-Agent": "Mozilla/5.0 (compatible; CobunAI/1.0; +https://cobunai.com)",
};

// ── AI keyword filter ─────────────────────────────────────────────
const AI_KW = [
  "llm","gpt","claude","gemini","openai","anthropic","mistral","llama","grok",
  "deepseek","qwen","phi-","falcon","bloom","palm","bard","copilot","chatgpt",
  "deepmind","openai","hugging face","huggingface","nvidia","groq","perplexity",
  "midjourney","sora","runway","stability","cohere","xai","inflection","adept",
  "artificial intelligence"," ai ","ai-","machine learning","deep learning",
  "neural network","transformer","diffusion","embedding","inference","fine-tun",
  "rlhf","rag","retrieval","vector","multimodal","foundation model","language model",
  "generative ai","computer vision","nlp","natural language","reinforcement learning",
  "alignment","hallucin","benchmark","dataset","parameter","token","attention",
  "latent","autoregressive","quantiz","distillation","lora","prompt","agent",
  "cursor","replit","github copilot","tabnine","codewhisperer","devin","bolt",
  "v0 ","lovable","vercel ai","langchain","llamaindex","autogpt","babyagi",
  "stable diffusion","dall-e","dall·e","imagen","firefly","whisper","elevenlabs",
  "agi","superintelligence","ai safety","ai regulation","ai policy","ai ethics",
  "ai startup","ai funding","ai research","ai model","ai tool","ai agent",
  "ai generated","ai powered","ai based","ai driven","large model","small model",
  "open source model","open weight","model release","model launch",
];
const isAI = t => { const s=(t||"").toLowerCase(); return AI_KW.some(k=>s.includes(k)); };

const guessType = (t, body="", src="") => {
  const s = ((t||"")+" "+(body||"")).toLowerCase();
  const title = (t||"").toLowerCase();

  // Source-based — most reliable signal
  if(src==="GitHub") return "repo";
  if(src==="HN" || src==="Lobste.rs" || src==="LessWrong" || src==="AlignmentForum") return "discuss";
  if(src==="arXiv") return "research";

  // Funding — very specific signals only
  if (/series [abcde] |seed round|funding round|\$\d+[mb] raise|acqui[a-z]+ |merger|\bipo\b/.test(s)) return "funding";

  // Model — specific model names anywhere in title
  if (/\bgpt-[\d.]|claude [\d]|claude opus|claude sonnet|claude haiku|gemini [\d.]|llama [\d]|llama-[\d]|mistral [\d]|deepseek-|deepseek [\d]|qwen[\d]|phi-[\d]|grok-[\d]|gpt-4|gpt-5|o1 |o3 |o1-|o3-/.test(title)) return "model";
  if (/\b(releases?|launches?|ships?|announces?|introduces?)\b.{0,30}\b(model|api|weights?)\b/.test(title)) return "model";
  if (/open.?(source[sd]?|weights?) .{0,20}\bmodel|model card|weights (are )?(now )?available/.test(title)) return "model";

  // Research — academic signals in title only (not body — too noisy)
  if (/\bpaper\b|\bsurvey\b|\bpreprint\b|\bbenchmark\b/.test(title)) return "research";
  if (/: a .{3,30} (approach|method|framework|system|model)$/i.test(t||"")) return "research";

  // Policy
  if (/regulation|eu ai act|senate|congress|executive order|copyright law|lawsuit|sued/.test(title)) return "policy";

  // Drama
  if (/fired|resign|scandal|layoff|laid off/.test(title)) return "drama";

  return "tool";
};


const guessTags = (t, body="") => {
  const s = ((t||"")+" "+(body||"")).toLowerCase();
  const tags = [];
  // Frameworks & tools
  if (/rag|retrieval.augmented|retrieval augmented/.test(s)) tags.push("RAG");
  if (/agent[s]?|agentic|multi.agent|autonomous agent/.test(s)) tags.push("Agents");
  if (/llm[s]?|large language model/.test(s)) tags.push("LLM");
  if (/fine.tun|finetuning|finetune|lora|qlora|peft/.test(s)) tags.push("Fine-tuning");
  if (/diffusion|stable diffusion|image gen|text.to.image|dall.e|midjourney|flux/.test(s)) tags.push("Diffusion");
  if (/multimodal|multi.modal|vision.language|vlm|image.text|text.image/.test(s)) tags.push("Multimodal");
  if (/transformer[s]?|attention mechanism|self.attention/.test(s)) tags.push("Transformer");
  if (/rlhf|reinforcement learning from|reward model|ppo|grpo/.test(s)) tags.push("RLHF");
  if (/vector.db|vector database|embedding[s]?|semantic search|pinecone|weaviate|chroma/.test(s)) tags.push("Embeddings");
  if (/langchain|llamaindex|llama.index|haystack/.test(s)) tags.push("LangChain");
  if (/open.?source|open weight|open model/.test(s)) tags.push("Open Source");
  if (/benchmark[s]?|leaderboard|eval[s]?|mmlu|hellaswag|gsm8k/.test(s)) tags.push("Benchmark");
  if (/reasoning|chain.of.thought|cot|o1|r1|thinking model/.test(s)) tags.push("Reasoning");
  if (/code.gen|coding model|code model|copilot|devin|swe.bench/.test(s)) tags.push("Code");
  if (/safety|alignment|jailbreak|red.team|guardrail|bias|harmless/.test(s)) tags.push("Safety");
  return tags.slice(0, 3); // max 3 tags per item
};

// Source credibility weights — how much we trust each source
const SRC_WEIGHT = {
  // Tier 1 — must-read for AI builders
  Karpathy: 1.4, LilianWeng: 1.3, SimonW: 1.25,
  Anthropic: 1.2, OpenAI: 1.2, Mistral: 1.15,
  DeepMind: 1.15, GoogleResearch: 1.1, MetaAI: 1.05,
  Raschka: 1.05, Interconnects: 1.0, DeepLearningAI: 1.0,
  // Tier 2 — strong community signals
  HN: 1.0, "Lobste.rs": 0.95, LessWrong: 0.9, AlignmentForum: 0.9,
  HuggingFace: 1.0, LangChain: 0.95, LlamaIndex: 0.95,
  WandB: 0.95, FastAI: 0.95, TogetherAI: 0.92, Cohere: 0.92,
  arXiv: 0.88, GitHub: 0.88, ImportAI: 1.05, TheSequence: 0.92,
  // Tier 3 — useful but lower signal
  Microsoft: 0.82, MITReview: 0.82, "Dev.to": 0.78,
  TDS: 0.75, MarkTechPost: 0.72,
  // Tier 4 — general tech media
  TechCrunch: 0.68, TheVerge: 0.65, VentureBeat: 0.65,
  Wired: 0.62,
};

// Developer relevance keywords — boost items that matter to builders
const DEV_KEYWORDS = [
  "open.source","released","launches","api","benchmark","outperforms",
  "fine.tun","training","inference","deploy","model","dataset","paper",
  "research","agent","rag","embedding","llm","gpt","claude","gemini",
  "mistral","llama","open.weights","arxiv","github","repo"
];

const heatScore = (score, comments, src, time, title="", sum="") => {
  const text = (title + " " + sum).toLowerCase();

  // Base engagement score per source
  const rawEngagement =
      src==="HN"        ? Math.min(score/3, 60)  + Math.min((comments||0)/2, 30)
    : src==="Dev.to"    ? Math.min(score/1.5, 55) + Math.min((comments||0)/2, 25)
    : src==="GitHub"    ? Math.min(score/4, 70)   + Math.min((comments||0)/2, 25)
    : src==="Lobste.rs" ? Math.min(score/2, 50)   + Math.min((comments||0)/2, 25)
    : src==="arXiv"     ? 38
    : src==="OpenAI" || src==="Anthropic" ? 72
    : src==="GoogleResearch" || src==="MetaAI" || src==="HuggingFace" ? 62
    : src==="MITReview" || src==="Interconnects" || src==="SimonW" ? 52
    : src==="TechCrunch" || src==="TheVerge" || src==="VentureBeat" ? 48
    : 40;

  // Source credibility multiplier
  const credibility = SRC_WEIGHT[src] || 0.65;

  // Developer relevance boost — up to +15 points
  const devMatches = DEV_KEYWORDS.filter(kw => text.includes(kw.replace(".","")||kw)).length;
  const devBoost = Math.min(devMatches * 3, 15);

  // GitHub star velocity boost
  const starBoost = src==="GitHub" && score > 1000 ? Math.min((score-1000)/150, 25) : 0;

  const engagement = (rawEngagement * credibility) + devBoost + starBoost;

  // Time decay — items lose heat after 6 hours, heavily after 24h
  const ageHours = time ? (Date.now()/1000 - time) / 3600 : 0;
  const decay = ageHours < 2  ? 1.0
              : ageHours < 6  ? 0.92
              : ageHours < 12 ? 0.78
              : ageHours < 24 ? 0.58
              : ageHours < 48 ? 0.38
              : 0.2;

  return Math.min(Math.round(engagement * decay), 99);
};

const safeText = t => (t||"").replace(/<[^>]+>/g,"").replace(/\s+/g," ").trim();

// ── FETCHERS ──────────────────────────────────────────────────────

async function fetchHN() {
  // Fetch top, ask, and show stories in parallel
  const [topRes, askRes, showRes] = await Promise.allSettled([
    fetch("https://hacker-news.firebaseio.com/v0/topstories.json", {signal:AbortSignal.timeout(10000)}).then(r=>r.json()),
    fetch("https://hacker-news.firebaseio.com/v0/askstories.json", {signal:AbortSignal.timeout(10000)}).then(r=>r.json()),
    fetch("https://hacker-news.firebaseio.com/v0/showstories.json", {signal:AbortSignal.timeout(10000)}).then(r=>r.json()),
  ]);

  const topIds = topRes.status==="fulfilled" ? topRes.value.slice(0,120) : [];
  const askIds = askRes.status==="fulfilled" ? askRes.value.slice(0,30) : [];
  const showIds = showRes.status==="fulfilled" ? showRes.value.slice(0,30) : [];

  const seen = new Set();
  const allIds = [...topIds, ...askIds, ...showIds].filter(id => {
    if(seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  // Batches of 30 — firing ~300 requests at once times out on a small Render instance
  const rows = [];
  for(let i = 0; i < allIds.length; i += 30) {
    rows.push(...await Promise.allSettled(allIds.slice(i, i+30).map(id =>
      fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`, {signal:AbortSignal.timeout(8000)}).then(r=>r.json())
    )));
  }
  return rows
    .filter(r => r.status==="fulfilled" && r.value?.title && isAI(r.value.title))
    .map(({value:s}) => ({
      id:`hn-${s.id}`, src:"HN", type:"discuss", tags:guessTags(s.title), title:s.title,
      sum: s.text ? safeText(s.text).slice(0,220)+"…" : "Discussion on Hacker News.",
      link: s.url||`https://news.ycombinator.com/item?id=${s.id}`,
      time:s.time, score:s.score||0, comments:s.descendants||0,
    }));
}

const ARXIV_RELEVANCE = (title, summary="") => {
  const s = (title + " " + summary).toLowerCase();
  let score = 0;
  const HIGH = [/\bllm\b/,/\blarge language model/,/\bagents?\b/,/\breasoning\b/,
    /fine.tun/,/\brlhf\b/,/\brag\b|retrieval.augmented/,/\binference\b/,
    /context.length|context window/,/\bmultimodal\b/,/\bembedding/,
    /\bvlm\b|vision.language/,/chain.of.thought/,/\bcode gen|code model/];
  const MED = [/\btransformer\b/,/\battention\b/,/\bdiffusion\b/,/\bbenchmark\b/,/\bevaluat/];
  const LABS = [/google|deepmind|openai|anthropic|meta |microsoft|mistral|hugging/];
  HIGH.forEach(r => { if(r.test(s)) score += 3; });
  MED.forEach(r => { if(r.test(s)) score += 1; });
  LABS.forEach(r => { if(r.test(s)) score += 2; });
  return score;
};

async function fetchArxiv() {
  const res = await fetch("https://export.arxiv.org/api/query?search_query=cat:cs.AI+OR+cat:cs.LG+OR+cat:cs.CL+OR+cat:cs.CV&sortBy=lastUpdatedDate&sortOrder=descending&max_results=60", {signal:AbortSignal.timeout(20000)});
  const text = await res.text();
  const entries = text.split("<entry>").slice(1);
  return entries.map(e => {
    const get = tag => { const m=e.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`)); return m?m[1].trim():""; };
    const title   = get("title").replace(/\n/g," ").trim();
    const summary = safeText(get("summary")).slice(0,240)+"…";
    const link    = (e.match(/<id>([\s\S]*?)<\/id>/)||[])[1]?.trim()||"https://arxiv.org";
    const pub     = (e.match(/<published>([\s\S]*?)<\/published>/)||[])[1]?.trim();
    const time    = pub ? Math.floor(new Date(pub).getTime()/1000) : Math.floor(Date.now()/1000);
    const authors = (e.match(/<name>([\s\S]*?)<\/name>/g)||[]).slice(0,3).map(a=>a.replace(/<\/?name>/g,"")).join(", ");
    return { id:`arxiv-${link.split("/abs/")[1]||Math.random()}`, src:"arXiv", type:"research", tags:guessTags(title, summary), title, sum:summary, link, time, score:0, comments:0, authors };
  }).filter(e=>e.title);
}

async function fetchDevTo() {
  const [r1, r2] = await Promise.allSettled([
    fetch("https://dev.to/api/articles?tag=ai&per_page=30&top=1", {signal:AbortSignal.timeout(10000)}).then(r=>r.json()),
    fetch("https://dev.to/api/articles?tag=machinelearning&per_page=20&top=1", {signal:AbortSignal.timeout(10000)}).then(r=>r.json()),
  ]);
  const seen = new Set();
  const combined = [
    ...(r1.status==="fulfilled" ? r1.value : []),
    ...(r2.status==="fulfilled" ? r2.value : []),
  ].filter(a => {
    if(seen.has(a.id)) return false;
    seen.add(a.id);
    return true; // arXiv already filtered to AI categories
  });
  return combined.map(a=>({
    id:`devto-${a.id}`, src:"Dev.to", type:guessType(a.title), tags:guessTags(a.title), title:a.title,
    sum: safeText(a.description||"").slice(0,220)+"…",
    link:a.url, time:Math.floor(new Date(a.published_at).getTime()/1000),
    score:a.positive_reactions_count||0, comments:a.comments_count||0,
  }));
}

async function fetchLobsters() {
  const res = await fetch("https://lobste.rs/t/ai.json", {signal:AbortSignal.timeout(10000)});
  const json = await res.json();
  return (json||[]).map(s=>({
    id:`lobsters-${s.short_id}`, src:"Lobste.rs", type:"discuss", tags:guessTags(s.title), title:s.title,
    sum:`${s.description||"Technical discussion on Lobste.rs."}`.slice(0,220),
    link:s.url||`https://lobste.rs/s/${s.short_id}`,
    time:Math.floor(new Date(s.created_at).getTime()/1000),
    score:s.score||0, comments:s.comment_count||0,
  }));
}

async function fetchGitHub() {
  const queries = [
    "topic:llm+stars:%3E200",
    "topic:ai-agents+stars:%3E100",
    "topic:large-language-models+stars:%3E100",
    "topic:generative-ai+stars:%3E200",
    "topic:rag+stars:%3E100",
  ];

  const results = await Promise.allSettled(queries.map(q =>
    fetch(`https://api.github.com/search/repositories?q=${q}&sort=updated&order=desc&per_page=15`, {
      // Anonymous search allows 10 requests/min per IP — a token (free in GitHub Actions) avoids that
      headers:{"Accept":"application/vnd.github.v3+json","User-Agent":"pulse-app/1.0",
        ...(process.env.GITHUB_TOKEN ? {"Authorization":"Bearer "+process.env.GITHUB_TOKEN} : {})},
      signal:AbortSignal.timeout(10000)
    }).then(r=>r.json())
  ));

  const seen = new Set();
  const repos = [];
  for(const r of results) {
    if(r.status !== "fulfilled") continue;
    for(const repo of (r.value?.items||[])) {
      if(seen.has(repo.id)) continue;
      seen.add(repo.id);
      repos.push({
        id:`github-${repo.id}`, src:"GitHub", type:"repo",
        title:repo.full_name,
        sum:(repo.description||"No description.").slice(0,220),
        link:repo.html_url,
        time:Math.floor(new Date(repo.pushed_at||repo.updated_at).getTime()/1000),
        score:repo.stargazers_count||0, comments:repo.forks_count||0,
      });
    }
  }
  return repos;
}

async function fetchRSS(url, src, srcLabel, aiOnly=false, customHeaders={}) {
  // Download with native fetch — it decompresses gzip (DeepMind sends it unasked) and can't leave sockets hanging
  const res = await fetch(url, { headers:{ ...FEED_HEADERS, ...customHeaders }, signal:AbortSignal.timeout(15000) });
  if(!res.ok) throw new Error(`Status code ${res.status}`);
  const feed = await parser.parseString(await res.text());
  const pubTime = e => e.pubDate ? new Date(e.pubDate).getTime() : 0;
  // Some feeds (OpenAI, HuggingFace) list hundreds of posts in no particular order
  return [...(feed.items||[])].sort((a,b) => pubTime(b) - pubTime(a)).slice(0, 20)
    .filter(e => aiOnly || isAI(e.title||""))
    .map(e=>({
      // Hash the whole link — a short prefix is identical for every post on a site
      id:`${src.toLowerCase().replace(/\s/g,"-")}-${crypto.createHash("sha1").update(e.link||e.title||"").digest("hex").slice(0,16)}`,
      src, srcLabel:srcLabel||src, type:guessType(e.title||"", e.contentSnippet||e.summary||""), tags:guessTags(e.title||"", e.contentSnippet||e.summary||""),
      title:(e.title||"").replace(/\n/g," ").trim(),
      sum:safeText(e.contentSnippet||e.summary||e.content||"").slice(0,240)+"…",
      link:e.link||"", time:e.pubDate?Math.floor(new Date(e.pubDate).getTime()/1000):Math.floor(Date.now()/1000),
      score:0, comments:0, authors:e.creator||e.author||"",
    }));
}

const RSS_SOURCES = [
  { url:"https://openai.com/blog/rss.xml",                src:"OpenAI",      label:"OpenAI Blog",    aiOnly:true },
  { url:"https://deepmind.google/blog/rss.xml",           src:"DeepMind",    label:"DeepMind Blog",  aiOnly:true },
  { url:"https://research.google/blog/rss/",              src:"GoogleResearch", label:"Google Research", aiOnly:true },
  { url:"https://huggingface.co/blog/feed.xml",           src:"HuggingFace", label:"HuggingFace Blog",aiOnly:true },
  { url:"https://techcrunch.com/category/artificial-intelligence/feed/", src:"TechCrunch", label:"TechCrunch AI", aiOnly:true },
  { url:"https://www.theverge.com/rss/ai-artificial-intelligence/index.xml", src:"TheVerge", label:"The Verge AI", aiOnly:true },
  { url:"https://www.wired.com/feed/tag/ai/latest/rss",   src:"Wired",       label:"Wired AI",       aiOnly:true },
  { url:"https://www.technologyreview.com/feed/",         src:"MITReview",   label:"MIT Tech Review", aiOnly:true },
  { url:"https://simonwillison.net/atom/everything/",     src:"SimonW",      label:"Simon Willison",  aiOnly:true },
  { url:"https://www.interconnects.ai/feed",              src:"Interconnects",label:"Interconnects",  aiOnly:true },
  { url:"https://towardsdatascience.com/feed",            src:"TDS",         label:"Towards Data Science", aiOnly:true },
  { url:"https://www.marktechpost.com/feed/",             src:"MarkTechPost", label:"MarkTechPost",   aiOnly:true },
  { url:"https://bdtechtalks.com/feed/",                  src:"TechTalks",   label:"BD Tech Talks",   aiOnly:true },
  { url:"https://lastweekin.ai/feed",                     src:"LastWeekInAI",label:"Last Week in AI", aiOnly:true },
  { url:"https://www.together.ai/blog/rss.xml", src:"TogetherAI", label:"Together AI", aiOnly:true },
  { url:"https://magazine.sebastianraschka.com/feed", src:"Raschka", label:"Sebastian Raschka", aiOnly:true },
  { url:"https://lilianweng.github.io/index.xml", src:"LilianWeng", label:"Lilian Weng", aiOnly:true },
  { url:"https://karpathy.bearblog.dev/feed/", src:"Karpathy", label:"Andrej Karpathy", aiOnly:true },
  { url:"https://blog.langchain.dev/rss.xml", src:"LangChain", label:"LangChain Blog", aiOnly:true },
  { url:"https://www.lesswrong.com/feed.xml", src:"LessWrong", label:"LessWrong", aiOnly:false }, // mixes in non-AI posts
  { url:"https://alignmentforum.org/feed.xml", src:"AlignmentForum", label:"Alignment Forum", aiOnly:true },
];


// ── Topic clustering — deduplicate same-story coverage ────────────
function clusterItems(items) {
  const STOP = new Set([
    "the","a","an","in","of","to","for","and","or","with","on","at","by",
    "how","what","why","when","new","ai","using","use","your","from","its",
    "this","that","are","is","was","we","our","can","get","will","has",
    "have","about","into","more","based","via","vs","model","models","llm",
    "large","language","learning","deep","machine","neural","data","paper",
    "build","building","make","making","system","systems","open","source","free","local","tool","tools","show","built","agent","agents","code","based"
  ]);

  const getKeywords = (title) => {
    return title.toLowerCase()
      .replace(/[^a-z0-9 ]/g," ")
      .split(/\s+/)
      .filter(w => w.length > 3 && !STOP.has(w));
  };

  const clustered = [];
  const used = new Set();

  // Sort by heat descending — lead item is always highest heat
  const sorted = [...items].sort((a,b) => (b.heat||0) - (a.heat||0));

  for(const item of sorted) {
    if(used.has(item.id)) continue;
    const kw = new Set(getKeywords(item.title || ""));
    if(kw.size === 0) { clustered.push(item); used.add(item.id); continue; }

    const related = [];
    // Don't cluster GitHub repos with each other
    if(item.src === "GitHub") {
      clustered.push({ ...item, relatedCount: 0 });
      used.add(item.id);
      continue;
    }
    for(const other of sorted) {
      if(used.has(other.id) || other.id === item.id) continue;
      // Don't pull GitHub repos into news clusters
      if(other.src === "GitHub") continue;
      const okw = getKeywords(other.title || "");
      const overlap = okw.filter(w => kw.has(w)).length;
      const timeDiff = Math.abs((item.time||0) - (other.time||0));
      // HN/Lobsters need higher overlap threshold — titles are short and noisy
      const threshold = (item.src==="HN"||item.src==="Lobste.rs"||other.src==="HN"||other.src==="Lobste.rs") ? 3 : 2;
      if(overlap >= threshold && timeDiff < 172800) {
        related.push({ id:other.id, title:other.title, src:other.src, link:other.link, heat:other.heat });
        used.add(other.id);
      }
    }

    clustered.push({
      ...item,
      related: related.length > 0 ? related : undefined,
      relatedCount: related.length
    });
    used.add(item.id);
  }

  return clustered;
}

// ── Main aggregator ────────────────────────────────────────────────
async function fetchAll() {
  console.log("🔄 Fetching all sources…");
  const results = await Promise.allSettled([
    fetchHN(), fetchArxiv(), fetchDevTo(),
    fetchLobsters(), fetchGitHub(),
    ...RSS_SOURCES.map(s => fetchRSS(s.url, s.src, s.label, s.aiOnly, s.headers||{})),
  ]);
  const labels = ["HN","arXiv","Dev.to","Lobste.rs","GitHub",...RSS_SOURCES.map(s=>s.label)];
  const srcs   = ["HN","arXiv","Dev.to","Lobste.rs","GitHub",...RSS_SOURCES.map(s=>s.src)];
  const items = results
    .filter(r => r.status==="fulfilled")
    .flatMap(r => r.value)
    .map(i => ({ ...i, heat: heatScore(i.score, i.comments, i.src, i.time, i.title||"", i.sum||"") }));
  results.forEach((r,i) => {
    if(r.status==="rejected") console.warn(`⚠  ${labels[i]} failed:`, r.reason?.message);
    else console.log(`✓  ${labels[i]}: ${r.value.length} items`);
  });
  // Sources that errored or came back empty — callers can fall back to older items
  const failed = srcs.filter((_,i) => results[i].status==="rejected" || results[i].value.length===0);
  // Content filter — remove jailbreaks, prompt injections, spam
  const BLOCK_KEYWORDS = [
    "jailbreak","liberat","disregard prev","clear your mind","new instruct",
    "DISREGARD","PREV. INSTRUCT","liberation prompt","harmful prompt",
    "bypass","uncensor","DAN prompt","ignore previous"
  ];
  const filtered = items.filter(i => {
    const text = ((i.title||"")+" "+(i.sum||"")).toLowerCase();
    return !BLOCK_KEYWORDS.some(kw => text.includes(kw.toLowerCase()));
  });

  const seen = new Set();
  const titleSeen = new Set();
  const normalize = t => t.toLowerCase().replace(/[^a-z0-9]/g,"").slice(0,60);
  const unique = filtered.filter(i => {
    if(!i.title || seen.has(i.id)) return false;
    const tk = normalize(i.title);
    // Check for similar titles (first 60 normalized chars)
    if(titleSeen.has(tk)) return false;
    seen.add(i.id);
    titleSeen.add(tk);
    return true;
  });
  // Cap arXiv at top 25 by relevance score
  const arxivItems = unique.filter(i => i.src === "arXiv")
    .map(i => ({ ...i, _rel: ARXIV_RELEVANCE(i.title, i.sum) }))
    .sort((a,b) => b._rel - a._rel || b.time - a.time)
    .slice(0, 25);
  const nonArxiv = unique.filter(i => i.src !== "arXiv");
  const capped = [...nonArxiv, ...arxivItems];
  capped.sort((a,b) => b.time - a.time);
  const finalItems = capped;
  unique.length = 0;
  unique.push(...finalItems);
  unique.sort((a,b) => b.time - a.time);
  const clustered = clusterItems(unique);
  console.log(`✅ Total: ${clustered.length} items (clustered from ${unique.length})\n`);
  return { items: clustered, failed };
}

// ── LLM ───────────────────────────────────────────────────────────
// Any OpenAI-compatible chat endpoint: a local Ollama in GitHub Actions, or Groq on Render.
function makeChat({ url, key="", model }) {
  return async (prompt, { maxTokens=200, temperature=0.3, timeout=180000, json=false }={}) => {
    const res = await fetch(`${url}/chat/completions`, {
      method:"POST",
      headers:{ "Content-Type":"application/json", ...(key ? { "Authorization":"Bearer "+key } : {}) },
      body:JSON.stringify({
        model,
        messages:[{role:"user",content:prompt}],
        max_tokens:maxTokens,
        temperature,
        ...(json ? { response_format:{ type:"json_object" } } : {}),
      }),
      signal:AbortSignal.timeout(timeout)
    });
    const data = await res.json();
    if(!res.ok) throw new Error(`LLM ${res.status}: ${data.error?.message||JSON.stringify(data.error)||"unknown error"}`);
    return data.choices?.[0]?.message?.content?.trim() || "";
  };
}

// Bump when prompts change — build.js drops AI text written by another model or prompt version
const PROMPT_VERSION = 5;

// Cut at a word boundary — a word chopped mid-way gets copied into the output by small models
const clip = (text, n) => {
  const t = (text||"").replace(/…$/, "").trim();
  return t.length <= n ? t : t.slice(0, n).replace(/\s+\S*$/, "") + "…";
};

// Small models ramble and number things — keep at most `n` plain sentences
const firstSentences = (text, n=2) => {
  const flat = (text||"")
    .replace(/(^|\s)(\d{1,2}[.)]|[-*•])(?=\s)/g, " ") // list markers, inline or at line start
    .replace(/\*\*|__|`/g, "")
    .replace(/\b(first|second|sentence)( sentence)?\s*\d*\s*:\s*/gi, "")
    .replace(/\b(why it matters|practical upshots?( for [^:.]{0,40})?)\s*:\s*/gi, "")
    .replace(/\s+/g, " ").trim();
  // Split only where a sentence end is followed by a new capitalised sentence, so "Qwen2.5" survives
  return flat.split(/(?<=[.!?])\s+(?=["“'(\[]?[A-Z0-9])/).slice(0, n).join(" ").trim();
};

// ── "Why this matters" lines ──────────────────────────────────────
// Fills `cache` (id → sentence, "" = checked and not worth a line) for the hottest unchecked items.
// One item per call: in batches, models attach lines to the wrong item.
async function generateWhys(items, chat, cache) {
  const todo = [...items]
    .sort((a,b)=>(b.heat||0)-(a.heat||0))
    .filter(i => i.src !== "GitHub")
    .slice(0,30)
    .filter(i => !cache.has(i.id));

  let written = 0;
  for(const item of todo) {
    const prompt = `An item for developers building AI products:
Title: ${item.title}
Summary: ${clip(item.sum, 240)}

In ONE sentence of at most 14 words, say what this lets them do or what it changes for them. Use only the information above; never invent numbers or names, and never restate the title. Only if it is spam or a pure listicle, reply with just: SKIP`;
    try {
      const raw = await chat(prompt, { maxTokens:60, temperature:0.2 });
      const why = /^\W*skip\b/i.test(raw) ? "" : firstSentences(raw.replace(/^["']|["']$/g, ""), 1);
      cache.set(item.id, why);
      if(why) written++;
    } catch(e) {
      console.warn(`Why failed (${item.id}):`, e.message); // left unchecked — retried next run
    }
  }
  if(todo.length) console.log(`Generated ${written} why-this-matters lines for ${todo.length} items`);
}

// ── Daily digest — category summaries + intro ─────────────────────
const DIGEST_CATS = [
  { id:"model",    label:"Models & Releases" },
  { id:"tool",     label:"Tools & Libraries"  },
  { id:"research", label:"Research & Papers"  },
  { id:"repo",     label:"Repos & Projects"   },
  { id:"discuss",  label:"Community"           },
  { id:"funding",  label:"Funding & Business"  },
];

// `prev` is the last digest: a category whose top items haven't changed keeps its summary.
async function buildDigest(items, chat, prev=null) {
  const now = Math.floor(Date.now()/1000);
  const recent = items.filter(i => now - (i.time||0) < 172800);

  const grouped = {};
  for(const item of recent) {
    const key = item.type==="product" ? "tool" : (item.type || "tool");
    (grouped[key] ||= []).push(item);
  }
  for(const key of Object.keys(grouped)) grouped[key].sort((a,b)=>(b.heat||0)-(a.heat||0));

  const prevCats = new Map((prev?.categories||[]).map(c => [c.id, c]));
  const categories = [];
  // One at a time — a local model on a CPU runner can't serve parallel requests faster
  for(const cat of DIGEST_CATS) {
    const catItems = (grouped[cat.id] || []).slice(0,15);
    if(!catItems.length) continue;
    const topItems = catItems.slice(0,8);
    const key = topItems.map(i=>i.id).join(",");
    let summary = prevCats.get(cat.id)?.key === key ? (prevCats.get(cat.id).summary || "") : "";
    if(!summary && chat) {
      const prompt = `Today's top "${cat.label}" items for AI developers:
${topItems.map((i,idx) => `${idx+1}. ${i.title}${i.sum ? " — " + clip(i.sum, 140) : ""}`).join("\n")}

Write a 2-sentence brief, each sentence under 25 words. Begin with the name of the single most important item above and say plainly what it is. The second sentence says what it changes for someone building AI products, in your own words.
Use only facts stated above — never add numbers, names or details that are not there. Plain prose: no lists, no labels, no hype words, no preamble.`;
      try {
        summary = firstSentences(await chat(prompt, { maxTokens:160 }), 2);
      } catch(e) {
        console.warn(`Digest summary failed (${cat.id}):`, e.message);
      }
    }
    categories.push({ id:cat.id, label:cat.label, summary, key, count:catItems.length,
      items:catItems.map(i=>({id:i.id,title:i.title,src:i.src,srcLabel:i.srcLabel,type:i.type,
        heat:i.heat,time:i.time,link:i.link,sum:i.sum,why:i.why||"",
        score:i.score,comments:i.comments,authors:i.authors||""})) });
  }

  const top5 = categories.flatMap(c => c.items).sort((a,b)=>(b.heat||0)-(a.heat||0)).slice(0,5);
  const introKey = top5.map(i=>i.id).join(",");
  let intro = prev?.introKey === introKey ? (prev.intro || "") : "";
  if(!intro && chat && top5.length) {
    try {
      intro = firstSentences(await chat(`Today's top AI stories for developers:
${top5.map(i => `- ${i.title}${i.sum ? " — " + clip(i.sum, 120) : ""}`).join("\n")}

Pick the ONE story that matters most to developers building AI products and write 2 short sentences about it, each under 25 words. Start with the story's short name and what happened, in your own words; the second sentence says why it matters. Write like one developer talking to another. Use only facts stated above.`,
        { maxTokens:140, temperature:0.5 }), 2);
    } catch(e) {
      console.warn("Intro generation failed:", e.message);
    }
  }

  return { intro, introKey, categories, generatedAt:new Date().toISOString() };
}

export { fetchAll, makeChat, generateWhys, buildDigest, firstSentences, RSS_SOURCES, PROMPT_VERSION };

