# V1 scope — what a real sales deck needs

> **Done on 2026-09-13**: every shape below is implemented; the sales deck renders with its media at zero linter error (`bg: accent`/`sky`, `cards {.right}` for the text-plus-cards slide, `type-scale: 0.82` on the 2026 brand). Kept as the record of how V1 was scoped.

Derived on 2026-09-13 by rewriting a 26-slide Jamespot sales deck (2026 look, kept in `decks/private/`) in the target `.jmd` syntax and reading the linter. The J0 blocks (`metrics`, `timeline`, `compare`, `statement`) cover 4 of its 26 slides; the rest is listed here, in the order it matters.

## The shapes, counted

| Shape | Slides | Block / syntax | Status |
|---|---|---|---|
| **Feature**: eyebrow, title, lead, optional CTA link, screenshot on the right (bleeding to the edge) | 12 | title + lead + `[Label →](url){.cta}` + `![](shot.png){.right}` — no new block, a layout the theme applies when a slide carries a `.right` image | **missing**: images and links are not parsed yet (they pass as text — the linter cannot see this) |
| Cards, one line each (icon + title, optional text) | 3 | `::: cards` with `- title \| text`, up to 5 | missing |
| Cards with bullets | 2 | `::: cards` heading form: `### Title` + `-` bullets, like `compare` columns | missing |
| Logo wall | 2 | `::: logos` with `- ![Name](file)` | missing (PRD had it in V2 — a sales deck needs it in V1) |
| Cover / closing | 2 | `bg: accent` + `# Title` + lead (+ `![](art){.cover}` decoration) | title renders; `.cover` art missing |
| Section divider | 1 | `::: section` | missing |
| Pills | 1 | `::: pills` | missing |
| Two-column compare, both light | 1 | `::: compare {.light}` | modifier missing |
| Process chevrons | 1 | `::: timeline {.chevrons}` | renders as a plain timeline; chevron variant is a theme option |
| Plain bullet list | 1 | Markdown list | ok |

**Backgrounds.** The 2026 look uses five: vivid purple (cover, dividers), cream, lavender, wash, sky. → `bg: accent` and `bg: sky` added to the engine; `secondary` added to the brand for sky; light backgrounds can be pinned per brand (`bg-lavender`, `bg-wash`, `bg-butter`) when the computed tone is not the exact brand value.

**Brand.** `jamespot-2026.yaml`: Garet (at the time: the licensed variable family, kept private; since the `brand-jamespot` branch, the two free weights Book + Heavy packed into `themes/brands/fonts/garet.css` and committed — a missing fonts file is now an error), `#312F7C` / `#7A70F2` / `#FFEC9D` / `#262166` / sky `#40BCD8`. Two visible theme deltas against the 2026 decks: headings are weight 800 where the decks use 700, and the mark is the basic one.

## What this settles for J1

1. **Images and links are part of V1**, not an extra: `![alt](file){.right|.cover|.wide}` and `[text](url){.cta}`. Files resolve next to the `.jmd`; the self-contained export embeds them as data URIs (PRD §4).
2. **`cards` takes both forms** — `- title | text` and `### title` + bullets — and up to 5 items.
3. **`logos` moves from V2 to V1.**
4. **`section`, `pills`** as in the PRD.
5. **Block modifiers**: `{.light}` on `compare`, `{.chevrons}` on `timeline`, `{.wide}` on a card. Each is one CSS rule.
6. **Two decks as V1 acceptance**: the internal reference deck (pixel test) and this 26-slide sales deck (structure test: every slide expressible, zero linter error, and the built file readable by a salesperson without the PDF next to it).
