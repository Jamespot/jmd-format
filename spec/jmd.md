# `.jmd` — the format, version 1

> `.jmd` is a **Markdown profile**, not a language. Standard Markdown, one slide-separator convention (the one Marp and Slidev use), one family of single-level `:::` blocks. Any text editor opens it, any LLM writes it without training.
>
> **What the format doesn't say, the theme decides.** No position, no size, no color in the source.

Status: **J1 (V1 read-only)** — eleven blocks (nine, and `table` / `chart` since 1.15.0), images, links, four layouts (Slide, Doc, Story, Webpage); validated on the reference deck (pixel test) and on a 26-slide sales deck (zero linter error).

## File structure

```markdown
---
format: jmd/2              ← required
layout: slide              ← always written: slide | doc | story | webpage — see "Layouts"; one word to change to switch
title: Deck title
brand: mono                ← brand: an id (themes/brands/<brand>.yaml) or the https URL of a brand.yaml; `theme:` and `template:` are synonyms
lang: en
date: 2026-08-25
author: Jane Doe            ← optional; `source:` too, set by the importer
watermark: none            ← optional: none | mark | circles — the brand's large background shape, for the whole deck; left out, the brand decides (1.35.0)
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
| `memo` | **A4 portrait** (210 × 297 mm) | one page | the pages stack and scroll; no motion | one A4 page per `---`; 794 × 1122 PNGs |
| `doc` | **A4 portrait**, as many pages as the text takes | one chapter | the pages stack and scroll; no motion | one A4 page per sheet the engine laid out; 794 × 1122 PNGs; no PowerPoint |
| `story` | **9:16 vertical**, 1080 × 1920 px | one screen | one at a time, `←` `→`, motion | one 1080 × 1920 page per `---` (a carousel PDF); 1080 × 1920 PNGs |
| `webpage` | one **continuous page**, 1280 wide | one section, as tall as its content | scrolls | flows onto A4 sheets; one PNG per section |

**Memo** is the one-pager, the memo, the leaflet: what is sent or printed rather than presented. A page holds a title, a lead and two to four blocks; the blocks keep their grammar and adapt their density to the portrait (four `metrics` go 2 × 2, four or five `cards` two abreast, a `timeline` of five or six runs down the page, a `.right` image sits below the text at full width). The page chrome carries the brand and the `section:` at the top, the document title and `n / N` at the foot. The linter measures each page against the A4 height and, on overflow, says to shorten or to start a new page with `---`.

**Doc** is the long document — the white paper, the report, the study, 10 to 30 pages and more *(jmd/2, 1.38.0; spec/doc.md)*. A `---` opens a chapter, which starts on a new page: `#` is its title (never a cover), the first paragraph its lead, then `##` sections and `###` sub-sections, `1.` numbered lists, `>` quotes, and a paragraph may be written over several lines. The blocks keep the Memo's A4 density. The engine lays the chapter out on as many sheets as it takes, in the browser where the text is measured: a block is never cut, a list is cut between two items and keeps its numbering, a heading never stays alone at the foot of a page. The running head is the chapter (its `section:` if it has one), the foot the document title and `n / N` counted over the whole document. Set for reading: left-aligned, from the top of the page. The linter has no page to measure a chapter against; it reports a single block taller than a page.

The front comes from the header, no new syntax: a **cover** (`title`, `subtitle:`, `author:`, `date`) and, from two chapters on, the **contents** — each chapter and its `##`, with the page it landed on and a link to it. `cover: none` and `contents: none` leave them out. **Notes**: `[^id]` calls a note, `[^id]: its text` on a line of its own anywhere in the chapter gives it; the notes are numbered in the order they are called and gathered at the end of their chapter, never at the foot of a page. A call with no text is an error (`note-missing`), a text never called a warning (`note-unused`). Outside a doc, `[^id]` is text.

A chapter may be set in **two columns** (`columns: 2` in its frontmatter): its title and lead span the page, the rest fills a box the height of what is left of each sheet, column after column, the last sheet balanced; a block sits in one column. A paragraph that crosses the foot of a page is **cut between two lines** (two at least on each side). **Images** stay in the flow: alone on their line they take the column, `{.right}` floats beside the text that follows, `{.cover}` spans the column — nothing sits beside or behind a page. **Intents are a page's**, as everywhere — and since the engine makes the pages, a page is written to carry one. A **page of its own**: a `---` with `page: yes` in its frontmatter sets a page in the flow, laid out as a memo page and never cut, with any of the ten intents and any `bg:` — a key figure revealed, a pull quote filling the page, a decision, a call to act; it opens no chapter, is not in the contents, and its running head is the chapter it sits in. **On a chapter**, a dark intent (`hook`, `problem`, `celebrate`, `act`, `fun`) gives it an opening page in that form — its title, its lead, a `{.cover}` picture — and the reading goes on on white pages; a light one (`reveal`, `prove`, `explain`, `decide`, `recap`) shapes the chapter's blocks. A chapter's `bg:` is not drawn (`doc-bg`): its reading pages are white. Written chapter by chapter through the MCP, the header alone sent with the document's id replaces the header and keeps the chapters.

**Story** is the carousel, the story, the mobile read: narrow and tall, one idea per screen, big type. Everything stacks in one column (a `compare` becomes two bands, a `timeline` runs down, four `metrics` go 2 × 2, a `.right` image sits below the text); the content sits in the middle of the screen; `n / N` in the corner. A screen holds a title and one block, two at most; the linter says to split the screen with `---` when it overflows. `jmd render` gives the 1080 × 1920 images, `jmd pdf` the carousel PDF.

**Webpage** is the landing page, the article, the one page put online: `---` opens a section whose background (`bg:`, the intent's) becomes a band, and the section is as tall as its content — no overflow, no page number, the brand chrome once at the top. A `.right` image keeps the feature layout, a `statement` or a `section` is a band of its own. Printed, the page flows onto A4 sheets, each section kept whole.

**On a phone** *(1.18.0)*: held upright, a Slide deck is read as a Story — the same source drawn in the other layout in the browser, one screen at a time, a tap or a swipe to turn and the story bar to jump; turned sideways, the slides again. Nothing is written back: the source keeps `layout: slide`. Doc, Webpage and Story are read as they are.

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
| Block | `::: name` … `:::` | never nested; one block per component family — two blocks of different families stack on a slide (a `timeline` over `cards`, a `metrics` over a `table`), the linter measures the whole. `::: cards {.right}` puts the block in a right column next to the text (any non-full block) |
| Item | `- a | b | c` | columns separated by `|`; `\|` for a literal pipe |
| Modifier | `{.hero}` at the end of an item | component class |
| Inline | `*italic*` `**bold**` `` `code` `` `[text](url)` | nothing else; **no raw HTML**. `[Label →](url){.cta}` renders as a button |
| Image | `![caption](file.png){.right \| .cover \| .wide}` **alone on its line** — inside a text (a card title, a bullet, a cell) it is neither drawn nor printed: `inline-image` | paths are **relative to the `.jmd`**, or `img:<bank>/<slug>` from one of the brand's image banks, or an `https://` URL (spec/images.md); all embedded as data URIs at build, the deck loads nothing. `.right`: the feature layout (text left, image bleeding right); `.cover`: art under a level-1 title; `.wide`: full width; none: in a soft frame |
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

### `timeline` — up to 6 steps, two forms
```markdown
::: timeline
- 1995 — Origins | Founded by two engineers, sold to a large group in 2003.
- The Google pivot | Delisted. A blow that forced us to reinvent ourselves.
- Eight acquisitions, and Contoso | Eight companies joined us. {.now}
:::
```
Columns: **title | text**, or **date | title | text** (rendered "date — title"). Implicit numbering 01, 02… `{.now}` = current step (yellow dot), `{.next}` = upcoming step (dashed dot). `::: timeline {.chevrons}` renders the steps as colored chevrons.

**Phases** (1.26.0) — the heading form, as `cards` has it, for a step that carries detail: a project plan, a roadmap.
```markdown
::: timeline
### January to June — Scoping and setup
- Kick-off
- Workshop 1 · Brainstorm
### July — Pilot {.now}
A restricted group before the general rollout.
### September — Rollout {.next}
- Training plan
:::
```
`### date — title` opens a phase (the date under the dot, the title in its card; no ` — `, the whole heading is the title), `-` lines are its details, plain lines its text; `{.now}` `{.next}` `{.hero}` on the heading. The dots and their line stay on top, each phase's detail in a card under its dot.

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
One-line form: **title | text**. Heading form: `###` opens a card, `-` lines are its bullets, plain lines its text. `{.numbered}` on the block numbers the cards; `{.plain}` takes the theme's marker off (the shape or icon a brand puts on each card) — a marker is never replaced by an image in the title; `{.wide}` on a card spans the row; `{.right}` on the block puts the cards in a right column next to the text.

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
A statement fills the page alone, or under its title (`## A title` then the block). Beside a text or another block it is drawn small inside the page, in its flow — nothing written on the page is dropped — and the linter warns (`full-alone`). The same holds for `section`. *(1.37.1; until then the rest of the page was silently not drawn.)*
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

## Blocks — data (1.15.0)

### `table` — a Markdown pipe table, up to 12 rows and 6 columns; 24 rows folded in two
```markdown
::: table
| Offer | Customers | Revenue |
|---|--:|--:|
| Starter | 1 240 | 0.4 M€ |
| Enterprise | 42 | 2.9 M€ | {.hero}
:::
```
Rows are `|`-separated cells (the edge pipes are optional). The row right above a `|---|` line is the **header**; without one, every row is a body row. `:--` `:--:` `--:` align a column left, center, right; a column whose cells all read as numbers aligns right by itself. `{.hero}` at the end of a row puts it forward; `{.compact}` on the block tightens it (automatic above 7 rows). **Past 12 rows the table folds in two** (1.26.0): two tables of equal width side by side, the header repeated, the order running down the first half then the second; `{.hero}` lights its row alone. A folded half holds 3 columns at most, 24 rows in all; `{.split}` folds a shorter list on demand. Never fold a table by hand into pairs of columns. A cell is inline Markdown. Errors: no row (`table-rows`), more than 6 columns (`table-columns`), more than 24 rows, or past 12 with more than 3 columns (`max-items`), wider than the page (`overflow`, measured).

### `chart` — numbers drawn: `bar` (default), `hbar`, `line`, `pie`
```markdown
::: chart {.line}
series: 2025 | 2026
unit: k
- Jan | 12 | 14
- Feb | 12 | 15
- Mar | 13 | 17 {.hero}
:::
```
One item per bar, point or slice: **label | value**, and one more value per extra series (≤ 4), named by an optional `series: A | B` line. A value is a **number alone** — spaces as thousands separators, a `,` or `.` decimal mark, a unit around it tolerated (`42 %`, `€5.2M` read as 42 and 5.2) — and the unit is said once by `unit:`, printed after every value. `{.hero}` on an item: the bar in color and the others quiet, the slice forward with its share in the hole of the donut, a bigger dot on the line.

| Type | For | Max |
|---|---|---|
| `bar` | a few periods or categories, values on top of the bars | 12 |
| `hbar` | a ranking, long labels | 8 |
| `line` | a trend over many points; ticks on the left, one area under a single series | 24 |
| `pie` (`donut`) | the parts of one whole, with their shares listed beside | 6, one series |

The runtime draws it as SVG in the brand's colors (series: accent, deep, secondary, highlight), at the size of the layout (a Story screen, a Doc page, the right column of `{.right}`), with the decimal mark of `lang:`. It **arrives with motion** — bars grow from the axis, the line draws itself, the donut opens, the values land last — following the deck's motion mode; never in a Doc, a webpage, print, the editor, or for reduced motion. The numbers are also in the page as text (a hidden table), for a screen reader or a copy. Errors: no item (`chart-items`), a value that is not a number (`chart-value`), too many items for the type (`max-items`), more than 4 series or more than one on a pie (`chart-series`), a negative slice; an unknown `{.type}` is a warning.

## Blocks — diagrams (1.25.0)

### `diagram` — boxes and arrows (a Mermaid flowchart), or a list given a form

Two grammars in one block, told apart by the modifier. **No form**: the body is a **Mermaid flowchart** — the text Docs, GitHub and Notion draw — read and drawn by the runtime; no Mermaid runs.

```
::: diagram
flowchart LR
    A([Request]) --> B{Approved?}
    B -->|Yes| C[Ship]:::hero
    B -->|No| D[Revise]
    D -.-> A
:::
```

The first line is `flowchart` or `graph`, with `TD` (default), `LR`, `BT` or `RL`; a Story screen draws `LR` top-down. Then statements, one a line or separated by `;`. Nodes: `A[box]` `A(round)` `A([stadium])` `A((circle))` `A{decision}` `A{{hexagon}}` `A[(cylinder)]` `A[[subroutine]]`, a label in quotes when it holds brackets, `<br/>` for a new line; `A{.hero}` — the format's modifier — or Mermaid's own `A:::hero` puts a node forward (the one class read). In the editor a press on a box opens the source on its line. Edges: `-->` `---` `-.->` (dotted) `==>` (strong) `<-->` `~~~` (places, draws nothing), labelled `-->|Yes|` or `-- Yes -->`, chained `A --> B --> C`, grouped `A & B --> C`. Laid out in layers (ranks by longest path, order by barycenters, positions by least squares), drawn as SVG in the brand's colors, as tall as the slide has room for (it shrinks before the slide is zoomed, never under 14 px type, and grows into the room left, within its column; 1.30.0): a decision in the warm tint, a terminal (stadium, circle) in the deep color, the hero in the accent; a dark slide turns it. It arrives with motion — the nodes rank after rank, each edge drawing itself — within the deck's motion mode. The relations are also in the page as text, for a screen reader or a copy.

**Frames** — `subgraph id [Title]` … `end` draws a frame around the boxes named inside it, its title on top (wrapped to the frame's width down a top-down flow), frames in frames. A box sits in the frame it is first named in: a frame may list ids whose boxes and arrows are written elsewhere. The layout keeps a frame's boxes side by side in every rank and pushes the boxes that are not in it out of its width; a frame holds the labels of the arrows inside it. (1.30.0)

**With a form**, the body is a list of `- title | text` items, `{.hero}` on one:

| Form | For | Items |
|---|---|---|
| `{.tree}` | an org chart, a hierarchy: the indent is the parent, `- name \| role`; `{.tree .lr}` grows left to right | 2–14, and the layout's maximum |
| `{.cycle}` | a loop: cards on a ring, an arrow between each; `center:` names the whole | 3–6 |
| `{.radial}` | a hub and what hangs on it: `center:` names the hub (required), a spoke to each card | 3–8 |
| `{.pyramid}` | levels: the first item is the top; the bands left, the words beside | 2–6 |
| `{.funnel}` | stages that narrow: the first item is the widest | 2–6 |
| `{.steps}` | a staircase: each step a level higher — a maturity, a progression | 2–6 |
| `{.venn}` | sets that overlap; `center:` names what they share | 2–3 |
| `{.target}` | rings from the core out, the first item the core, each named by a leader | 2–5 |
| `{.matrix}` | four cases on two criteria: top left, top right, bottom left, bottom right; `x: left \| right`, `y: top \| bottom`, `center:` a label on the crossing | 4 |

A form's words are HTML (inline Markdown, edited in place like a card's); a tree's are drawn like a flowchart's, with elbow connectors.

**The intent changes the drawing**, as it does a card's: `explain` shows the diagram click by click (a flowchart node by node, each with the edges that reach it; a form card by card); `reveal` leaves the hero lit and the rest quiet, `decide` the same more gently; `prove` tightens the corners; a dark intent (`hook`, `problem`, `celebrate`, `act`) turns the colors.

Errors: `diagram-center` — a radial without its hub; `diagram-empty`; `diagram-type` — another Mermaid family, with the block that draws it (`pie` → `chart {.pie}`, `timeline`/`journey` → `timeline`, `mindmap` → `cards`…) or none; `diagram-syntax` — a line not read; `diagram-click` — `click`/`call`/`href` bind code to a node, and a deck is data; `diagram-form` — a list without a form; `max-items` — more than 10 nodes on a slide (7 on a Story screen, 14 on a Doc page or a webpage), or a form's count; `diagram-dense` — the drawing would need type under 14 px to fit. Warnings: `diagram-style` — `style`, `classDef`, `linkStyle`, `class`, `%%{init}%%` ignored, the brand colors the diagram; `diagram-subgraph` — an arrow to a frame's id (not drawn: an arrow goes to a box), or a frame that covers a box it does not hold or another frame; `diagram-form` — Mermaid lines under a form, an unknown form.

### Not yet: `principles`, `quote`, `agenda`
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

`format: jmd/2` at the top. The runtime reads any version ≤ its own and refuses a higher one with a clear message.

**A word that changes meaning moves the format up; adding a word, a block or a modifier never does.** The runtime keeps what the words of each past format meant (`UPGRADES` in `runtime/jmd-core.js`): `parse()` brings a document written in an older format up to the current meaning, step after step, and every reader — the render, the linter, the exports, the store's measures — sees the current meaning. The source is never rewritten by reading it: a `jmd/1` deck edited in place stays `jmd/1` and reads as it always did; the linter says, as an info, what it read differently. Moving a deck up is an explicit act (the editor's layout chip writes today's format with today's word). Each step has a frozen fixture in `tools/test.mjs`, so a missing step breaks a test, not a deck. The runtime's version (`1.38.0`) says what draws; the format's (`jmd/2`) what the words mean — only the second is in the file, and the latest runtime reads every past format.

| Format | Since | What changed meaning |
|---|---|---|
| `jmd/1` | 0.1 | — |
| `jmd/2` | 1.38.0 | `layout: doc` is the long document; the A4 page per `---` of `jmd/1`'s `doc` is `memo` |
