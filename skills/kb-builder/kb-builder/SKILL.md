---
name: kb-builder
description: >
  Build an Obsidian-compatible knowledge base from public web sources using the TinyFish CLI.
  Use this skill when a user wants a builder-grade markdown knowledge base on a technical topic,
  asks for a structured research vault, or wants a topic compiled from live public sources into
  interlinked markdown files. Supports two input modes: topic only, or topic plus starter URLs.
  Always generates index.md and sources.md. Creates additional files only when the evidence supports
  them. Uses explicit tinyfish agent run commands and public web sources only.
compatibility:
  tools: [tinyfish]
metadata:
  author: edwardtran777
  version: "0.1"
  tags: knowledge-base markdown obsidian research tinyfish builders web-ingestion
---

# KB Builder

Build a topic-specific markdown knowledge base by using TinyFish to browse public web sources and extract structured evidence.

This skill is for **builder knowledge bases**, not personal journals and not direct code generation.

The output is a folder you can drop into Obsidian immediately.

## Pre-flight check

Run both checks before any TinyFish call:

```bash
which tinyfish && tinyfish --version || echo "TINYFISH_CLI_NOT_INSTALLED"
tinyfish auth status
```

If TinyFish is not installed, stop and tell the user:

```bash
npm install -g @tiny-fish/cli
```

If TinyFish is not authenticated, stop and tell the user:

```bash
tinyfish auth login
```

Do not continue until both checks pass.

## Scope

- **Allowed:** public web pages, public GitHub repos, public papers, public docs, public datasets, public blog posts
- **Not allowed:** private sources, local private files, authenticated dashboards, chat logs, email, Slack, or anything the user cannot access publicly
- **Primitive:** use explicit `tinyfish agent run` commands
- **Output shape:** always `index.md` and `sources.md`; everything else is dynamic

## Input modes

You support two modes:

1. **Topic only**
   - Example: `Build me a knowledge base on web agent frameworks`
2. **Topic + starter URLs**
   - Example: `Build me a knowledge base on web agent frameworks and start from these URLs: ...`

If the topic is missing, ask for it before proceeding.

If starter URLs are present:
- use them first
- deduplicate them
- keep only public URLs

## Output directory

Create a folder named:

```text
kb-{topic-slug}/
```

Examples:
- `kb-web-agent-frameworks/`
- `kb-kolmogorov-arnold-networks/`
- `kb-landing-page-design-patterns/`

## Always-generated files

### `index.md`

This file is always required. It should contain:
- a short topic overview
- what the knowledge base covers
- a list of generated pages using `[[wikilinks]]`
- 3-7 key takeaways
- open questions or evidence gaps

### `sources.md`

This file is always required. It should log **every URL visited** with:
- timestamp
- URL
- source label
- reason it was opened
- result status: useful, partial, irrelevant, blocked, or conflicting

Use ISO 8601 timestamps.

## Dynamic files

Do **not** hardcode a fixed set like `papers.md` or `repos.md` for every topic.

Create additional files only when the topic actually supports them.

Common examples:
- `papers.md`
- `repos.md`
- `docs.md`
- `articles.md`
- `datasets.md`
- `benchmarks.md`
- `people.md`
- `glossary.md`
- `timeline.md`

Rules:
- if a category has meaningful evidence, create its file
- if it does not, skip it
- do not create empty placeholder files
- if a category only has 1-2 minor findings, fold it into `index.md` instead

All generated markdown files should use `[[wikilinks]]` when linking to other local pages.

## Operating model

Use a **two-pass workflow**:

1. **Discovery pass**
   - find high-value URLs
2. **Reading pass**
   - extract structured information from the selected URLs

Use **one TinyFish run per URL**.

Do not ask one TinyFish agent to cover multiple independent sites in a single command.

Run independent URLs in parallel where possible using background jobs and `wait`.

## Step 1 — Normalize the task

Write down:
- `TOPIC`
- `TOPIC_SLUG`
- `STARTER_URLS` if provided

Keep the topic human-readable in the markdown output.

## Step 2 — Build the starting URL set

If the user gave starter URLs:
- start with those

Then expand with a small set of public discovery URLs relevant to the topic. Choose from these patterns when relevant:

- GitHub repo search:
  ```text
  https://github.com/search?q={TOPIC}&type=repositories
  ```
- arXiv search:
  ```text
  https://arxiv.org/search/?query={TOPIC}&searchtype=all
  ```
- Hugging Face models search:
  ```text
  https://huggingface.co/models?search={TOPIC}
  ```
- Hugging Face datasets search:
  ```text
  https://huggingface.co/datasets?search={TOPIC}
  ```
- General web discovery:
  ```text
  https://duckduckgo.com/?q={TOPIC}
  ```

Only include discovery URLs that are likely to produce useful public results.

Aim for 4-8 discovery URLs in the first pass, not 20.

## Step 3 — Run the discovery pass

For each discovery URL, run TinyFish with a concrete extraction goal.

Command template:

```bash
tinyfish agent run --sync --url "{DISCOVERY_URL}" \
  "You are helping build a markdown knowledge base on '{TOPIC}'.
   Read this page and identify up to 5 high-value public URLs worth following.
   Prefer official docs, canonical GitHub repos, papers, datasets, benchmarks, and
   high-signal tutorials or explainers.
   Return JSON:
   {
     \"candidates\": [
       {
         \"title\": \"\",
         \"url\": \"\",
         \"sourceType\": \"docs|repo|paper|dataset|article|benchmark|person|other\",
         \"whyItMatters\": \"\"
       }
     ]
   }
   Rules:
   - public URLs only
   - max 5 candidates
   - do not guess URLs
   - if nothing useful is found, return an empty array" \
  > /tmp/kb_discovery_{SAFE_NAME}.json &
```

After launching all discovery runs:

```bash
wait
```

Then read all discovery outputs, merge them, deduplicate by URL, and choose the best 6-12 URLs for the reading pass.

Selection priority:
1. official documentation
2. canonical GitHub repositories
3. arXiv papers
4. Hugging Face model or dataset pages
5. strong blog posts or tutorials
6. benchmark or leaderboard pages

By default, do **not** spend your budget on social posts, Reddit threads, or generic chatter unless the user explicitly asks for them.

## Step 4 — Run the reading pass

Run one TinyFish agent per chosen URL.

Command template:

```bash
tinyfish agent run --sync --url "{TARGET_URL}" \
  "You are extracting evidence for a markdown knowledge base on '{TOPIC}'.
   Read this source carefully and return structured JSON.
   Extract:
   - title
   - canonicalUrl
   - sourceType
   - shortSummary
   - keyFindings: up to 7 bullets
   - importantEntities: people, projects, libraries, datasets, papers, companies
   - importantLinks: up to 5 URLs mentioned or linked from the page
   - suggestedPages: page names this should contribute to, e.g. [\"repos\", \"papers\", \"docs\", \"articles\", \"benchmarks\"]
   - evidenceQuality: high|medium|low
   - limitations: things this page did not answer
   If this is a GitHub repository:
   - inspect the README
   - inspect up to 3 important files or folders if they are clearly relevant
   - include key files or folders under keyFindings
   If this is a paper:
   - extract the title, abstract-level contribution, and 3-5 implementation-relevant points
   If this is documentation:
   - extract concepts, APIs, workflows, and caveats
   If this is a dataset or model page:
   - extract task, modality, schema if visible, and usage constraints
   Return JSON only.
   Do not invent facts. If something is missing, say it is missing." \
  > /tmp/kb_read_{SAFE_NAME}.json &
```

After launching all reading runs:

```bash
wait
```

## Step 5 — Log all sources immediately

Before writing the synthesis pages, update `sources.md` with every visited URL.

Each entry should include:

```markdown
## 2026-04-06T08:30:00Z | useful
- URL: https://example.com
- Label: Official docs
- Reason opened: discovery pass for {TOPIC}
- Notes: yielded 4 good follow-up links
```

Use one section per visited page. Do not skip failed or low-value pages.

## Step 6 — Decide the page set

Create the optional pages based on the actual evidence you found.

Good examples:
- if you found 3+ relevant papers, create `papers.md`
- if you found multiple strong repositories, create `repos.md`
- if you found official docs plus API references, create `docs.md`
- if the topic has strong benchmarks, create `benchmarks.md`
- if the topic is mostly design/tutorial content, create `articles.md`

If the topic does **not** have a category, skip that file.

Do not create a research-shaped output for topics that are not research-shaped.

## Step 7 — Write the knowledge base

Write clean markdown. Keep it skimmable and builder-friendly.

### `index.md` structure

Use this pattern:

```markdown
# {TOPIC}

## Overview
{2-4 paragraph overview}

## Pages
- [[docs]]
- [[repos]]
- [[articles]]

## Key Takeaways
- ...
- ...

## Gaps
- ...

## Source Log
- [[sources]]
```

### Optional page structure

Each optional page should:
- start with `# {Page Name}`
- summarize what the page covers
- organize findings under clear headings
- include outbound `[[wikilinks]]` to sibling pages where relevant
- include source links inline as standard markdown links

Example:

```markdown
# Repositories

## Canonical Repos

### Primary repository
- Summary: ...
- Why it matters: ...
- Key files or concepts: ...
- Related: [[docs]], [[articles]]
- Source: [GitHub](https://github.com/...)
```

## Step 8 — Quality rules

Always follow these rules:

- public web only
- `index.md` and `sources.md` are mandatory
- all other files are evidence-driven
- use `[[wikilinks]]` for local page references
- keep filenames simple and lowercase
- do not invent structure just to make the KB look bigger
- if a source conflicts with another source, say so explicitly
- if a source is weak, say so explicitly
- if you cannot access a page or it is thin, record that in `sources.md`

## Parallelism rule

Good:
- one TinyFish run per URL
- many URLs in parallel

Bad:
- one TinyFish run told to visit GitHub, arXiv, and Hugging Face all in a single goal

## Edge cases

### Topic has no papers

That is fine. Do not create `papers.md`.

### Topic has no datasets

That is fine. Do not create `datasets.md`.

### Topic is mostly docs and blogs

Create files like `docs.md` and `articles.md`.

### Topic is broad and noisy

Prefer fewer high-quality sources over many weak ones.

### Topic has only starter URLs and little public discovery value

Use the starter URLs first, extract them well, and keep the KB narrow.

## Final delivery

At the end, report:
- output folder path
- files created
- number of URLs visited
- any important gaps or blocked sources

Use a concise summary like:

```text
KB Builder complete for {TOPIC}
Output: kb-{topic-slug}/
Files: index.md, sources.md, ...
URLs visited: 11
Open gaps: benchmarks unclear, no public dataset page found
```
