# `.jmd` — the format, version 1

> `.jmd` is a **Markdown profile**, not a language. Standard Markdown, one slide-separator convention (the one Marp and Slidev use), one family of single-level `:::` blocks. Any text editor opens it, any LLM writes it without training.
>
> **What the format doesn't say, the theme decides.** No position, no size, no color in the source.

Status: **J1 (V1 read-only)** — nine blocks, images, links, four layouts (Slide, Doc, Story, Webpage); validated on the reference deck (pixel test) and on a 26-slide sales deck (zero linter error).

## File structure

```markdown
---
format: jmd/1              ← required
layout: slide              ← always written: slide | doc | story | webpage — see "Layouts"; one word to change to switch
title: Deck title
brand: mono                ← brand: an id (themes/brands/<brand>.yaml) or the https URL of a brand.yaml; `theme:` and `template:` are synonyms
lang: en
date: 2026-08-25
author: Jane Doe            ← optional; `source:` too, set by the importer
---

---                        ← new slide
bg: white                  ← slide frontmatter, optional
section: Who Jamespot is   ← top-right chrome label, inherited by the following slides
eyebrow: Kicker
notes: Speaker notes, inline Markdown allowed.
---
## Slide title
Optional lead: the first paragraph after the title.

::: metrics
- 300+ | customers | Sixty percent in the private sector.
:::
```

**Case does not matter for what the format names**: keys (`Layout:`), the values it enumerates (`Doc`, `Hook`, `Lavender`, `JMD/1`), a brand id (`Jamespot-Basic`), a block (`::: Cards`) and a modifier (`{.Hero}`) are read in lowercase. What the author writes — a title, notes, a `section:` label, a URL — keeps its case.

A slide starts at a `---` alone on its line. If every line that follows, up to the next `---`, is of the form `key: value`, that's the slide frontmatter; otherwise it's already content.

## Layouts

The same source, the same blocks, the same intents — a different page. `layout:` in the document frontmatter; absent = `slide`. Every layout is drawn in the slide's units (the CSS the reference deck validated) and zoomed to its own paper.

| Layout | Page | One `---` is… | Reading | Print / render |
|---|---|---|---|---|
| `slide` (default) | 1280 × 720, landscape | one screen | one at a time, `←` `→`, motion | one 1280 × 720 px page per slide |
| `doc` | **A4 portrait** (210 × 297 mm) | one page | the pages stack and scroll; no motion | one A4 page per `---`; 793 × 1122 PNGs |
| `story` | **9:16 vertical**, 1080 × 1920 px | one screen | one at a time, `←` `→`, motion | one 1080 × 1920 page per `---` (a carousel PDF); 1080 × 1920 PNGs |
| `webpage` | one **continuous page**, 1280 wide | one section, as tall as its content | scrolls | flows onto A4 sheets; one PNG per section |

**Doc** is the one-pager, the memo, the leaflet: what is sent or printed rather than presented. A page holds a title, a lead and two to four blocks; the blocks keep their grammar and adapt their density to the portrait (four `metrics` go 2 × 2, four or five `cards` two abreast, a `timeline` of five or six runs down the page, a `.right` image sits below the text at full width). The page chrome carries the brand and the `section:` at the top, the document title and `n / N` at the foot. The linter measures each page against the A4 height and, on overflow, says to shorten or to start a new page with `---`.

**Story** is the carousel, the story, the mobile read: narrow and tall, one idea per screen, big type. Everything stacks in one column (a `compare` becomes two bands, a `timeline` runs down, four `metrics` go 2 × 2, a `.right` image sits below the text); the content sits in the middle of the screen; `n / N` in the corner. A screen holds a title and one block, two at most; the linter says to split the screen with `---` when it overflows. `jmd render` gives the 1080 × 1920 images, `jmd pdf` the carousel PDF.

**Webpage** is the landing page, the article, the one page put online: `---` opens a section whose background (`bg:`, the intent's) becomes a band, and the section is as tall as its content — no overflow, no page number, the brand chrome once at the top. A `.right` image keeps the feature layout, a `statement` or a `section` is a band of its own. Printed, the page flows onto A4 sheets, each section kept whole.

`notes:` are kept in every layout (never printed).

## Slide keys

| Key | Values | Rendering |
|---|---|---|
| `intent` | `hook` `problem` `reveal` `prove` `explain` `decide` `recap` `celebrate` `fun` `act` | what the slide is for — the theme turns it into form (background, density, emphasis, alignment); see `intents.md`. No intent = the neutral form below |
| `bg` | `white` (default) `indigo` `accent` `sky` `lavender` `wash` `butter` | background of the neutral form (ignored when an intent is set); `indigo`, `accent` and `sky` turn text white and the title into an `h1` (`sky` uses the brand's `secondary`) |
| `section` | text | top-right chrome; **sticky**: holds until a later slide redefines it |
| `eyebrow` | text | mono kicker above the title, 16 px between the two |
| `notes` | text | speaker notes (`N` key) |

## Slide content

| Element | Syntax | Rule |
|---|---|---|
| Title | first `#`, `##` or `###` of the slide | one only; `#` makes a **cover** (centered, 84 px), `##` the regular title; white on `indigo`/`accent`/`sky` |
| Lead | first paragraph after the title | `.slide-lead` |
| Block | `::: name` … `:::` | never nested; one block per component family. `::: cards {.right}` puts the block in a right column next to the text (any non-full block) |
| Item | `- a | b | c` | columns separated by `|`; `\|` for a literal pipe |
| Modifier | `{.hero}` at the end of an item | component class |
| Inline | `*italic*` `**bold**` `` `code` `` `[text](url)` | nothing else; **no raw HTML**. `[Label →](url){.cta}` renders as a button |
| Image | `![caption](file.png){.right \| .cover \| .wide}` alone on its line | paths are **relative to the `.jmd`**, or `img:<bank>/<slug>` from one of the brand's image banks, or an `https://` URL (spec/images.md); all embedded as data URIs at build, the deck loads nothing. `.right`: the feature layout (text left, image bleeding right); `.cover`: art under a level-1 title; `.wide`: full width; none: in a soft frame |
| Plain Markdown | paragraphs, lists | rendered as a single column (`.prose`) |

## Blocks — V1

### `metrics` — up to 4 items
```markdown
::: metrics
- 300+ | customers | Sixty percent in the private sector.
- 350,000 | users | The installed base. {.hero}
- €5.2M | ARR | Growing 11%.
:::
```
Columns: **value | label | comment** (comment optional). `{.hero}` puts the item in color.

### `timeline` — up to 6 steps
```markdown
::: timeline
- 1995 — Origins | Founded by two engineers, sold to a large group in 2003.
- The Google pivot | Delisted. A blow that forced us to reinvent ourselves.
- Eight acquisitions, and Contoso | Eight companies joined us. {.now}
:::
```
Columns: **title | text**, or **date | title | text** (rendered "date — title"). Implicit numbering 01, 02… `{.now}` = current step (yellow dot), `{.next}` = upcoming step (dashed dot). `::: timeline {.chevrons}` renders the steps as colored chevrons.

### `cards` — up to 5, two forms
```markdown
::: cards
- Security | Hosted on a qualified infrastructure.
- Backups | Daily automatic backups to a second zone.
:::

::: cards {.numbered}
### Prepare
- **Ready-made plans**, tested.
- **Drills** on a schedule.

### React
Free text is allowed too. {.wide}
:::
```
One-line form: **title | text**. Heading form: `###` opens a card, `-` lines are its bullets, plain lines its text. `{.numbered}` on the block numbers the cards; `{.wide}` on a card spans the row; `{.right}` on the block puts the cards in a right column next to the text.

### `compare` — exactly 2 columns
```markdown
::: compare
### What I know
- We buy to build.

### What I don't know yet
- The fine detail of roles.
:::
```
Each `###` opens a column (the first light, the second dark; `{.light}` on the block makes both light); the `-` lines below are its bullets, plain lines its text.

### `statement` — the whole slide
```markdown
---
bg: lavender
---
::: statement
We are a product company that took twenty years to build.
— Jane Doe, CEO, September 4
:::
```
One paragraph, an optional attribution introduced by `— `. No title on this slide.

### `section` — a divider slide
```markdown
::: section
Why Northwind Ops?
:::
```
The part title, centered; a second line becomes a lead. `{.numbered}` adds the part number. No other content on the slide.

### `pills` — up to 8 short words
```markdown
::: pills
- Sovereign
- Modular
:::
```

### `logos` — a wall of images, up to 40
```markdown
::: logos
- ![Acme](assets/logo-acme.svg)
- ![Globex](assets/logo-globex.svg)
:::
```
Aligned on one height; denser above 18 logos. The alt text is the name.

### Not yet: `principles`, `quote`, `agenda`, `table`, `mermaid`
Reserved names; a block outside the vocabulary is **a linter error**, not a warning. See the PRD for the V2 families (data, rhythm) and V3 (Jamespot graph, interaction).

## The linter

Errors (block the PDF export): unknown or higher `format`; unknown `layout`; unknown `bg`; block outside the vocabulary; nested block; slide without a title except `statement`/`quote`/`section`; too many items for the block; `compare` without two columns; **`stray-fence`** — a fence written with anything but three ASCII colons (`:: cards`, `:[x] cards`), or a `:::` that closes nothing; **`loose-heading`** — a `#` heading outside a block, printed as text; more than one `.right` image; **`missing-asset`** — a referenced file that does not exist next to the `.jmd` (CLI and MCP, which see the disk); **overflow measured in the DOM** (content reaches below 660 px on a slide, below 1730 of the 1810 units of a Doc page, or text overflows its box) — once the auto-fit has given up: a body that would fit at 85 % or more is shown at that zoom (its rendered width kept) and the finding is the **`fit` warning** instead, with the zoom in its message.

Warnings: title > 60 characters; lead > 200; three consecutive slides on the same colored background; slide without notes; `fit` — the body shown smaller so that it fits (in edit mode, a dotted line at the limit with the zoom); `asset-not-embedded` — in the browser, a dropped deck that references files it cannot read.

The linter speaks the format an agent reads:

```json
{ "slide": 4, "block": "metrics", "rule": "max-items", "message": "5 items, maximum 4: remove an item or use another block" }
```

## Editing

The runtime edits a slide by editing its source lines (`E`), in a panel or in place (click a text). The rewrite is a line-range replacement: the parser keeps every slide's and every node's line range (`start`, `map`), and the renderer stamps `data-line` / `data-col` on each text, so what is not edited is never touched. A file opened, untouched and saved is byte-identical.

## Versioning

`format: jmd/1` at the top. The runtime reads any version ≤ its own and refuses a higher one with a clear message. A version 2 is decided when a block changes meaning, never to add one.
