# JMD — presentations as plain text

**`.jmd` is a Markdown profile for presentations.** A deck is a text file you can diff, review and generate. A single self-contained HTML file renders it on-brand, checks it, prints it to PDF and edits it within the limits of the format.

Two objects, and only two:

```
deck.jmd                 ← the source. Markdown, slide separators, ::: blocks.
deck.james-jmd.html      ← the runtime: parser + theme + fonts + linter + print + the deck embedded in it.
```

No dependency, no server, no install. The built file opens in any browser, offline, and stays readable in ten years because it carries everything it needs.

## Thirty seconds

```bash
git clone https://github.com/Jamespot/jmd-format.git && cd jmd-format
node tools/build.mjs decks/samples/hello-jmd.jmd    # → build/hello-jmd.james-jmd.html
open build/hello-jmd.james-jmd.html
```

In the page: `←` `→` to move, `F` fullscreen, `N` speaker notes, `L` the linter, `E` edit the slide, `P` print to PDF, `S` save the self-contained file.

## What a deck looks like

```markdown
---
format: jmd/1
layout: slide
title: Why we moved
brand: mono
lang: en
---

---
notes: Open on the number, not on the agenda.
---
## Three years, one decision

::: metrics
- 300+ | customers | Sixty percent in the private sector.
- 12 % | churn, down from 19 | Two product cycles.
:::
```

Everything a slide needs is on the page: a title as `##`, an optional lead, one block. **No position, no size, no color, ever** — the theme decides all of it. If you feel like typing `style=`, you picked the wrong block.

## One word changes the paper

`layout:` turns the same source into four things, with the same blocks and the same checks:

| `layout:` | What it is | Page |
|---|---|---|
| `slide` | the talk, presented | 1280 × 720 |
| `doc` | the one-pager, the memo, the PDF you send | A4 portrait |
| `story` | the carousel, the LinkedIn or Instagram post | 1080 × 1920 |
| `webpage` | the landing page, the article | one continuous page |

The linter measures every page against its own height, so a deck that fits as a talk tells you what to split when it becomes a carousel.

## Form follows meaning

Nine blocks, one level, never nested. You pick by what the content *is*, not by how it should look: numbers → `metrics`, steps → `timeline`, peers → `cards`, two sides → `compare`, one sentence → `statement`, tags → `pills`, customers → `logos`, a divider → `section`. A plain bullet list is the last resort, and the linter says so.

A slide may also declare what it is *for* — `intent: hook | problem | reveal | prove | explain | decide | recap | celebrate | fun | act` — and the theme gives that intent a form of its own.

The full grammar is [spec/jmd.md](spec/jmd.md). If you are pointing an LLM at this format, give it [spec/agents.md](spec/agents.md): it is written to be read by a model, and it is what makes a correct deck come out on the first try.

## The command line

```bash
bin/jmd.mjs lint   deck.jmd            # the rules, exit 1 on error
bin/jmd.mjs lint   deck.jmd --dom      # + overflow measured in headless Chrome
bin/jmd.mjs lint   deck.jmd --json     # { ok, errors, warnings, slides, findings[] }
bin/jmd.mjs build  deck.jmd            # the self-contained page
bin/jmd.mjs pdf    deck.jmd            # print it
bin/jmd.mjs render deck.jmd            # one image per screen
```

The linter is the point. An agent writing a deck never sees pixels; it reads findings and fixes them. That loop is why the format refuses more than it allows.

## Brands

A brand is four colors, two fonts and a mark, in a small YAML — `themes/brands/mono.yaml` is the neutral default, and five others ship beside it. Point `brand:` at an id, or at the https URL of your own `brand.yaml`. Nothing about a brand ever lives in a `.jmd`.

## A deck is data, never code

The format is designed so that a file someone sends you cannot do anything to you. The built page runs exactly one script — the runtime, pinned **by hash** in its own Content-Security-Policy. Text is escaped before any Markdown rule runs; links are limited to `https`, `mailto`, `#` and relative paths; every brand value is validated by shape and CSS-escaped where it lands; a logo SVG is not filtered but **rebuilt** from an allowlist; an asset is embedded only from under the deck's own folder.

None of that is a promise you have to take on trust: `tools/test.mjs` §12 builds an adversarial deck and an adversarial brand that attack every text channel at once, then asserts on the rendered DOM that the page holds exactly one script and that it is ours. Run `npm test`.

## Status and what will change

Version 1 of the format. It is stable, and it will keep growing — so here is the rule it grows by:

**A `.jmd` that lints today lints on every later runtime.** Blocks, modifiers, intents and layouts get added; they are not renamed and their meaning is not redefined. A mistake that must be corrected becomes a new name beside the old one, and the old one keeps being read for at least a major version. What the *renderer* does with a block is not part of the contract — a theme may redraw anything. Anything that would break a file someone already wrote takes a major version, and it is written in the spec before it ships.

## What is not here

The hosted product — the MCP server agents call, stored decks, shared editing, identity — is **Jamespot Slides**, and it is not in this repository. You can use the format, the runtime and the tools without it, forever. If you want the hosted side: [slides.jamespot.io](https://slides.jamespot.io).

## License

Apache-2.0 — see [LICENSE](LICENSE) and [NOTICE](NOTICE). Copyright 2026 Jamespot SAS.
