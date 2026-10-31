# CobunAI data

The data behind [cobunai.com](https://cobunai.com), a daily AI brief for developers.

Every hour a GitHub Action pulls ~26 curated sources (lab blogs, arXiv, Hacker News, GitHub, newsletters), scores and de-duplicates them, writes short summaries with an open model ([Qwen 2.5 7B](https://ollama.com/library/qwen2.5) via Ollama, running on the Action runner itself), and publishes static JSON to GitHub Pages. No server, no API keys, no cost.

| File | What it holds |
| --- | --- |
| [`feed.json`](https://data.cobunai.com/feed.json) | Every item: title, link, source, type, heat score, one-line "why it matters" |
| [`digest.json`](https://data.cobunai.com/digest.json) | Today's brief: an intro plus a 2-sentence summary per category |
| [`status.json`](https://data.cobunai.com/status.json) | When it last ran, items per source, which sources failed |

## Run it yourself

```bash
npm install
npm run build          # writes public/*.json, no AI text
```

For AI text, point it at any OpenAI-compatible endpoint, e.g. a local Ollama:

```bash
ollama pull qwen2.5:7b
LLM_URL=http://localhost:11434/v1 LLM_MODEL=qwen2.5:7b npm run build
```

Sources and scoring live in [`pipeline.js`](pipeline.js); the schedule in [`.github/workflows/build.yml`](.github/workflows/build.yml).
