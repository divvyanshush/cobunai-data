// CobunAI data pipeline — fetch, score, cluster and summarise AI sources.
// Used by build.js, which publishes the result as static JSON on GitHub Pages.
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
// Longer text than `sum`, for the digest prompt only — build.js leaves it out of feed.json
const BODY = 700;

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

  // Batches of 30 — firing ~300 requests at once times out on small machines
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
      body: s.text ? safeText(s.text).slice(0,BODY) : "",
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
    const abstract = safeText(get("summary"));
    const summary = abstract.slice(0,240)+"…";
    const link    = (e.match(/<id>([\s\S]*?)<\/id>/)||[])[1]?.trim()||"https://arxiv.org";
    const pub     = (e.match(/<published>([\s\S]*?)<\/published>/)||[])[1]?.trim();
    const time    = pub ? Math.floor(new Date(pub).getTime()/1000) : Math.floor(Date.now()/1000);
    const authors = (e.match(/<name>([\s\S]*?)<\/name>/g)||[]).slice(0,3).map(a=>a.replace(/<\/?name>/g,"")).join(", ");
    return { id:`arxiv-${link.split("/abs/")[1]||Math.random()}`, src:"arXiv", type:"research", tags:guessTags(title, summary), title, sum:summary, body:abstract.slice(0,BODY), link, time, score:0, comments:0, authors };
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
      headers:{"Accept":"application/vnd.github.v3+json","User-Agent":"cobunai-data/1.0",
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
    .map(e=>({ e, text:safeText(e.contentSnippet||e.summary||e.content||"") }))
    .map(({ e, text })=>({
      // Hash the whole link — a short prefix is identical for every post on a site
      id:`${src.toLowerCase().replace(/\s/g,"-")}-${crypto.createHash("sha1").update(e.link||e.title||"").digest("hex").slice(0,16)}`,
      src, srcLabel:srcLabel||src, type:guessType(e.title||"", e.contentSnippet||e.summary||"", src), tags:guessTags(e.title||"", e.contentSnippet||e.summary||""),
      title:(e.title||"").replace(/\n/g," ").trim(),
      sum:text.slice(0,240)+"…", body:text.slice(0,BODY),
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
// Any OpenAI-compatible chat endpoint — in GitHub Actions, a local Ollama.
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
const PROMPT_VERSION = 9;

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

// ── Daily digest — one news story per category + intro ────────────
const DIGEST_CATS = [
  { id:"model",    label:"Models & Releases" },
  { id:"tool",     label:"Tools & Libraries"  },
  { id:"research", label:"Research & Papers"  },
  { id:"repo",     label:"Repos & Projects"   },
  { id:"discuss",  label:"Community"           },
  { id:"funding",  label:"Funding & Business"  },
];

const SRC_NAME = { HN:"Hacker News", GitHub:"GitHub", arXiv:"arXiv", "Dev.to":"Dev.to", "Lobste.rs":"Lobste.rs" };
const unescape = s => (s||"")
  .replace(/&#x([0-9a-f]+);/gi, (_,h) => String.fromCodePoint(parseInt(h,16)))
  .replace(/&#(\d+);/g, (_,d) => String.fromCodePoint(+d))
  .replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&amp;/g,"&");

// Hacker News and Lobsters threads arrive as a bare title. For the hottest ones, read the linked page's own
// description so the digest has a fact to work with. Fills `body`; a page that fails leaves the item as it was.
async function addLinkText(items, n=12) {
  const threads = items
    // A thread's own text that is only a link (or a few words) says nothing either
    .filter(i => (i.src==="HN" || i.src==="Lobste.rs") && !/\s\S+\s\S+\s\S+\s/.test(unescape(i.body||"")))
    .filter(i => /^https?:/.test(i.link||"") && !/ycombinator\.com|lobste\.rs/.test(i.link))
    .sort((a,b) => (b.heat||0) - (a.heat||0)).slice(0, n);
  const meta = (html, name) => html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*>`, "i"))?.[0]
    .match(/content=(["'])([\s\S]*?)\1/i)?.[2];
  const results = await Promise.allSettled(threads.map(async i => {
    const res = await fetch(i.link, { headers:{ "User-Agent":FEED_HEADERS["User-Agent"], "Accept":"text/html" }, signal:AbortSignal.timeout(8000) });
    if(!res.ok || !/html/.test(res.headers.get("content-type")||"")) return false;
    const html = (await res.text()).slice(0, 300000);
    const text = safeText(unescape(meta(html, "og:description") || meta(html, "description") || meta(html, "twitter:description") || ""));
    if(text.length < 40) return false;
    i.body = text.slice(0, BODY);
    return true;
  }));
  console.log(`Read ${results.filter(r => r.value === true).length}/${threads.length} linked pages for thread details`);
}

// What the model gets to know about one item — and all it may state
function storyFacts(i) {
  const source = i.srcLabel || SRC_NAME[i.src] || i.src;
  // Feeds append "The post … appeared first on …" — noise that ends up in the story
  let title = unescape(i.title), details = clip(unescape(i.body || i.sum).replace(/\s*The post\b.*$/, ""), 420);
  if(i.src === "GitHub") {
    // A bare owner/repo slug gets copied into headlines — spell it out instead
    const [owner, name] = title.split("/");
    title = `GitHub repo ${name || owner} by ${owner}`;
    // Descriptions arrive cut at 220 characters, often mid-word ("Google Work")
    if((i.sum||"").length >= 220) details = details.replace(/\s+\S*$/, "…");
    details = `${details === "No description." ? "" : details} ${(i.score||0).toLocaleString("en-US")} stars.`.trim();
  } else if(i.src === "HN" || i.src === "Lobste.rs") {
    if(/^(Discussion on Hacker News|Technical discussion on Lobste\.rs)\.?$/.test(details)) details = "";
    let site = "";
    try { site = new URL(i.link).hostname.replace(/^www\./, ""); } catch {}
    if(/ycombinator\.com|lobste\.rs/.test(site)) site = "";
    details = `${details} A ${source} thread with ${i.score||0} points and ${i.comments||0} comments${site ? `, linking to ${site}` : ""}.`.trim();
  }
  return { source, title, details };
}

// The category comes last, after the examples: Ollama reuses the cached prompt start across calls,
// which makes each call several times faster on a CPU runner
const STORY_PROMPT = (label, facts) => `You are the editor of CobunAI, a daily AI news brief written for anyone: a curious reader who doesn't work in tech should understand every word. You turn a list of items into one short news story.

Choose the ONE item that is the biggest news: a launch, release, deal, discovery or security problem beats an essay or an opinion piece. Reply with JSON: {"pick": <item number>, "headline": "...", "dek": "..."}

headline: who did what, in at most 10 plain words, in sentence case. Start with who (a company, lab, person or project; "Researchers" for a paper), then an active verb. Say what it does for people or what is new, not just that it was released. No colons, no "owner/repo" names, no title copied word for word.
dek: one short sentence of at most 20 words with the most concrete fact the headline left out, put in everyday terms. Never start it with "It" or "This".
Plain words only. No tech jargon such as tokens, latency, parameters, benchmark, API, SDK, inference, open-weight or LLM: say what the thing does instead ("a test", "an AI model", "an add-on"). Make numbers human: "20 ms" becomes "a fiftieth of a second", "65.2%" becomes "about two in three". If readers may not know a company, say what it does ("home-alarm company ADT"). No filler such as "simplifying", "enabling", "impacting" or "changing how people work".
Use only facts written in the item, and spell names exactly as the item does. Never add numbers, names or claims that are not there.

Examples of the style:

1. Source: Mistral AI
Title: Mistral Releases Codestral, a 22B Code Model
Details: Codestral is a 22B open-weight model for code generation, trained on more than 80 programming languages, with a 32K-token context window.
{"pick": 1, "headline": "Mistral's Codestral writes code in more than 80 programming languages", "dek": "Anyone can download the AI model and run it themselves."}

1. Source: GitHub
Title: GitHub repo browser-use by browser-use
Details: Make websites accessible for AI agents. Automate tasks online with ease. 62,000 stars.
{"pick": 1, "headline": "Browser Use lets AI click through websites for you", "dek": "The tool handles online chores, and 62,000 developers have bookmarked it on GitHub."}

1. Source: arXiv
Title: Scaling Laws for Neural Language Models
Details: We study empirical scaling laws for language model performance on the cross-entropy loss. The loss scales as a power-law with model size, dataset size, and the amount of compute used for training.
{"pick": 1, "headline": "Researchers find AI models improve predictably as they grow", "dek": "Adding size, data or computing power cuts errors along a smooth, predictable curve."}

Today's top "${label}" items:

${facts.map((f,idx) => `${idx+1}. Source: ${f.source}\nTitle: ${f.title}${f.details ? `\nDetails: ${f.details}` : ""}`).join("\n\n")}

Reply with the JSON only.`;

// Filler small models reach for when there is nothing concrete to say
const FILLER = /\b(simplif\w*|impact\w*|chang\w* (how|the way)|revolution\w*|game.?chang\w*|streamlin\w*|empower\w*|enabl\w*|seamless\w*|leverag\w*|cutting.edge|groundbreaking|pav\w* the way|landscape)\b/i;
// Tech words a reader outside tech won't know — a story using them gets rewritten
const JARGON = /\b(tokens?|latency|p\d\d|harness(es)?|benchmarks?|sdks?|apis?|open.weights?|inference|parameters?|llms?|fine.tun\w*|multimodal|quantiz\w*|embeddings?|rag|transformers?|gateway|context window|calibrated|probabilit\w*|model.independent|programmatic|runtime|endpoints?|throughput|checkpoints?|repos?|\d+(\.\d+)?[BMK])\b/;
// Capitalised words that are not names, so they need no backing in the item
const PLAIN = new Set(("the a an it its this these that their his her our your you new how why what who when after with for in on as at by " +
  "anyone everyone someone more most some many free fake firm firms group tool tools app apps model models add-on " +
  "coders programmers attackers scammers officials lawmakers regulators companies " +
  "researchers researcher developers developer engineers engineer scientists users teams people hackers security " +
  "startup startups company lab study paper report authors experts investors " +
  "ai llm llms api apis gpu gpus cpu ml open one two three four five six seven eight nine ten").split(" "));
const words = s => s.split(/\s+/).filter(Boolean);
const bare = w => w.replace(/^[^\w$]+|[^\w]+$/g, "").replace(/['’]s$/, "");
// Makers everyone knows from the product name, so "Anthropic's Claude Code" needs no "Anthropic" in the item
const MAKERS = [[/\bclaude\b/, "anthropic"], [/\b(chatgpt|gpt-?\d|codex|sora)\b/, "openai"], [/\b(gemini|gemma|deepmind)\b/, "google"],
  [/\bllama\b/, "meta"], [/\bgrok\b/, "xai"], [/\bcopilot\b/, "microsoft github"]];
const itemText = f => {
  const t = `${f.source} ${f.title} ${f.details}`.toLowerCase();
  return t + MAKERS.filter(([re]) => re.test(t)).map(([, maker]) => ` ${maker}`).join("");
};

// How many of the story's distinctive words come from this item — tells which item it is about
const overlap = ({ headline, dek }, f) => {
  const known = itemText(f);
  return words(`${headline} ${dek}`).map(w => bare(w).toLowerCase())
    .filter(w => w.length > 3 && !PLAIN.has(w) && known.includes(w)).length;
};

// What's wrong with a story, judged against the item it is about. Hard problems mean it can't run.
function storyProblems({ headline, dek }, f) {
  const hard = [], soft = [];
  if(!headline || !dek) return { hard:["headline and dek are both required"], soft };
  const hw = words(headline).length, dw = words(dek).length;
  if(hw > 10) (hw > 13 ? hard : soft).push(`the headline has ${hw} words, keep it to 10`);
  if(dw > 20) (dw > 25 ? hard : soft).push(`the dek has ${dw} words, keep it to 20`);
  if(/:/.test(headline)) hard.push("the headline has a colon");
  if(/[A-Za-z][\w.-]*\/[A-Za-z][\w.-]+/.test(headline)) hard.push("the headline has an owner/repo name");
  if(/^(it|this|these)\b/i.test(dek)) soft.push(`the dek starts with "${words(dek)[0]}"`);
  // In Title Case every word looks like a name, so only the dek's names get checked (sentenceCase fixes the rest)
  const long = words(headline).filter(w => /^[a-z]/i.test(w) && bare(w).length > 3);
  const titleCase = long.length >= 3 && long.filter(w => /^[A-Z]/.test(w)).length / long.length >= 0.7;
  // "Baseten releases joey-1, a 2B decision model" is the press title again, not news
  const content = words(headline).map(w => bare(w).toLowerCase()).filter(w => w.length > 2 && !PLAIN.has(w));
  const title = f.title.toLowerCase();
  if(content.length >= 3 && content.filter(w => title.includes(w)).length / content.length >= 0.75)
    soft.push(`the headline repeats the item's title; say in plain words what it does or what is new, like "Mistral's Codestral writes code in more than 80 programming languages"`);
  const filler = `${headline} ${dek}`.match(FILLER);
  if(filler) soft.push(`"${filler[0]}" is filler`);
  const jargon = `${headline} ${dek}`.match(new RegExp(JARGON, "i"));
  if(jargon) soft.push(`"${jargon[0]}" is tech jargon; say it in everyday words or leave it out`);
  // Names and numbers must come from the item
  const known = itemText(f);
  // A rounded number from the item is fine ("under $5" for $4.73); a new one is not
  const nums = t => (t.replace(/(\d),(?=\d)/g, "$1").match(/\d+(?:\.\d+)?/g) || []).map(Number);
  const knownNums = nums(known);
  for(const n of nums(`${headline} ${dek}`))
    if(!knownNums.some(m => Math.abs(n - m) <= Math.max(0.1 * m, 0.5))) hard.push(`${n} is not in the item`);
  for(const w of words(titleCase ? dek : `${headline} ${dek}`)) {
    const name = bare(w);
    if(!/[A-Z]/.test(name) || PLAIN.has(name.toLowerCase()) || known.includes(name.toLowerCase())) continue;
    // "OpenAI-backed" is fine when "OpenAI" is in the item
    if(name.split("-").every(p => !/[A-Z]/.test(p) || PLAIN.has(p.toLowerCase()) || known.includes(p.toLowerCase()))) continue;
    hard.push(`"${name}" is not in the item`);
  }
  return { hard, soft };
}

// "Phorion Discovers Backdoor in Claude Code" → "Phorion discovers backdoor in Claude Code": a word keeps its
// capital only as the first word, an acronym or CamelCase name, or where the item itself capitalises it
function sentenceCase(headline, f) {
  const plainTitle = words(f.title).some(w => /^[a-z]{4,}$/.test(bare(w))); // a Title Case title proves nothing
  // A repo slug like cherry-studio is the name "Cherry Studio"
  const slug = (f.title.match(/^GitHub repo (\S+)/)?.[1] || "").split(/[-_.]/).map(p => p.charAt(0).toUpperCase() + p.slice(1));
  const evidence = `${f.details} ${plainTitle ? words(f.title).slice(1).join(" ") : ""} ${slug.join(" ")}`;
  const text = `${f.source} ${f.title} ${f.details}`.toLowerCase();
  const makers = new Set(MAKERS.filter(([re]) => re.test(text)).flatMap(([, maker]) => maker.split(" ")));
  return words(headline).map((w, wi) => w.split("-").map((part, pi) => {
    const name = bare(part);
    if((wi === 0 && pi === 0) || !/^[A-Z][a-z]+$/.test(name) || evidence.includes(name) || makers.has(name.toLowerCase())) return part;
    return part.replace(name, name.toLowerCase());
  }).join("-")).join(" ");
}

const parseStory = raw => {
  try { return JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || raw); } catch { return null; }
};

// One headline + dek for a category, about the item the model picked. Retries with the reasons a draft failed.
async function writeStory(cat, topItems, chat) {
  const facts = topItems.map(storyFacts);
  let best = null, feedback = "";
  for(const temperature of [0.2, 0.6, 0.8, 0.8]) {
    const raw = await chat(STORY_PROMPT(cat.label, facts) + feedback, { maxTokens:160, temperature, json:true });
    const s = parseStory(raw) || {};
    // Drop quotes only when they wrap the whole line — "with 'mass ulw'" keeps its closing quote
    const unquote = t => t.trim().replace(/^(["'“‘])(.*)["'”’]$/, "$2").trim();
    const story = {
      headline: unquote(firstSentences(String(s.headline||""), 1)).replace(/[.!]+$/, ""),
      dek: unquote(firstSentences(String(s.dek||""), 1)),
    };
    if(story.dek && !/[.!?]$/.test(story.dek)) story.dek += ".";
    // Trust the words over the number: a story that plainly comes from another item is about that item
    const n = Number(s.pick);
    let pick = Number.isInteger(n) && n >= 1 && n <= facts.length ? n - 1 : 0;
    const scores = facts.map(f => overlap(story, f));
    const likeliest = scores.indexOf(Math.max(...scores));
    if(scores[likeliest] > scores[pick] + 1) pick = likeliest;
    let p = storyProblems(story, facts[pick]);
    if(p.hard.length) {
      // Another item the story shares words with may back it fully
      const other = facts.map((f, idx) => idx)
        .filter(idx => scores[idx] > 0 && scores[idx] >= scores[pick] && !storyProblems(story, facts[idx]).hard.length)
        .sort((a, b) => scores[b] - scores[a])[0];
      if(other !== undefined) { pick = other; p = storyProblems(story, facts[pick]); }
    }
    const draft = { ...story, lead:topItems[pick].id, hard:p.hard, soft:p.soft };
    if(!best || draft.hard.length < best.hard.length || (draft.hard.length === best.hard.length && draft.soft.length < best.soft.length)) best = draft;
    if(!draft.hard.length && !draft.soft.length) break;
    console.warn(`Digest ${cat.id} draft rejected: "${story.headline}" / "${story.dek}" — ${[...p.hard, ...p.soft].join("; ")}`);
    // Name the broken rules but don't quote the draft: shown its last draft, the model rewrites it word for word
    feedback = `\n\nA first draft broke these rules: ${[...p.hard, ...p.soft].join("; ")}. Write a new one that keeps every rule.`;
  }
  if(best.hard.length) return null;
  const f = storyFacts(topItems.find(i => i.id === best.lead));
  // "Joey-1 costs…" → "joey-1 costs…": a name the item writes in lower case stays that way
  const first = words(best.dek)[0] || "", known = `${f.title} ${f.details}`;
  const dek = /[\d-]/.test(first) && first !== first.toLowerCase() && known.includes(bare(first).toLowerCase()) && !known.includes(bare(first))
    ? first.toLowerCase() + best.dek.slice(first.length) : best.dek;
  return { headline:sentenceCase(best.headline, f), dek, lead:best.lead };
}

// `prev` is the last digest: a category whose top items haven't changed keeps its story.
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
    const topItems = catItems.slice(0,6);
    const key = topItems.map(i=>i.id).join(",");
    const old = prevCats.get(cat.id);
    let story = old?.key === key && old.headline ? { headline:old.headline, dek:old.dek, lead:old.lead } : null;
    if(!story && chat) {
      try {
        story = await writeStory(cat, topItems, chat);
      } catch(e) {
        console.warn(`Digest story failed (${cat.id}):`, e.message);
      }
    }
    const { headline="", dek="", lead="" } = story || {};
    // `summary` is the pre-headline field; the live UI reads it until it moves to headline + dek
    const summary = headline ? `${headline}. ${dek}` : "";
    categories.push({ id:cat.id, label:cat.label, headline, dek, lead, summary, key, count:catItems.length,
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

export { fetchAll, makeChat, generateWhys, addLinkText, buildDigest, firstSentences, RSS_SOURCES, PROMPT_VERSION };

