# KB Builder — TinyFish Skill

**Build an Obsidian-ready knowledge base from the live web.**

Ask your coding agent things like:
- *"Build me a knowledge base on web agent frameworks"*
- *"Build me a knowledge base on Kolmogorov-Arnold Networks"*
- *"Build me a knowledge base on landing page design patterns, start from these URLs..."*

The agent uses TinyFish's web agent to visit public sources, extract the highest-signal information, and write a clean markdown vault with `[[wikilinks]]`.

## Input modes

- **Topic only** — the agent starts from search and hub pages
- **Topic + starter URLs** — the agent uses your URLs first, then expands from there

## Output

Always generated:
- `index.md`
- `sources.md`

Generated only when relevant:
- `papers.md`
- `repos.md`
- `docs.md`
- `articles.md`
- `datasets.md`
- `benchmarks.md`
- `people.md`
- other topic-specific markdown files

## Requirements

- TinyFish CLI installed
- TinyFish authenticated
- Public web sources only

## What makes this useful

- Explicit `tinyfish agent run` command flow
- One source per TinyFish run for better reliability
- Dynamic output files based on what the agent actually finds
- Obsidian-compatible markdown with `[[wikilinks]]`
- Honest logging of every visited URL in `sources.md`

## Built for

- builders
- vibe coders
- research-heavy devs
- technical founders doing deep dives
