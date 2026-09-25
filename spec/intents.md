# intents.md — what a slide is for

A slide has three independent axes. The **block** is the shape of its content (`metrics`, `timeline`, `cards`…). The **brand** is the look (colors, fonts, mark). The **intent** is what the slide is meant to do to the audience — and the theme turns it into form. The author still never writes a color, a size or a layout: they say what they want to obtain.

Register: **internal communication, a manager to their teams** — align, decide, mobilise. Not a sales pitch.

```markdown
---
intent: reveal
notes: the one thing to remember
---
## One number changes everything

::: metrics
- 73% | of incidents happen outside office hours {.hero}
- 4 min | target reaction time
:::
```

`intent:` is a slide-frontmatter key, optional, one of ten. **No intent = the neutral form**, the rendering as it is today; `bg:` is the one setting of that neutral form. An intent sets the background itself and overrides `bg:`. An unknown intent is a linter error (the set is closed).

## The ten intents

| intent | the slide wants to… | the form the theme gives it |
|---|---|---|
| `hook` | catch attention, give the vision, make people want | one element dominates, very large type, centred, dark or accent background; a picture, if any, goes full frame |
| `problem` | show what is wrong, build tension | strong contrast, dark background, heavy weight; numbers read as bad news |
| `reveal` | deliver the key idea — the important thing | one hero magnified (the first item, or the one marked `{.hero}`), the rest recedes; lots of white |
| `prove` | bring the evidence | dense, left-aligned, equal weights, small captions, a source line |
| `explain` | show how it works, how we organise | sequential, numbered, left-to-right progression; items arrive one by one |
| `decide` | lay out the options and the decision, taken or to take | options side by side, the recommended one forward (the `{.hero}` item, else the last), the others dimmed |
| `recap` | fix three things in memory | compact, ticked, big markers, no picture |
| `celebrate` | congratulate, thank, mark a milestone | warmth: the name or the number huge, accent or highlight background, the brand's glyphs in a festive mood |
| `fun` | make people laugh, lighten, surprise | off-beat tone: a giant quotation, a brand glyph as a wink, full highlight background, playful markers — never an emoji, never a color outside the palette |
| `act` | trigger the action: who does what, when | the CTA dominates, one action only, contact visible; closes the slide and often the deck |

Retired candidates, and why: *frame* (setting the scene) is the neutral slide — no intent. *inspire* is `hook`. *important* is `reveal`. *reassure* (logos, certifications) belongs to a sales register. *pause* is what the `section` block already does.

## How intents become form without a combinatorial explosion

Ten intents × nine blocks would be ninety rules. Instead each intent sets **six levers** on the slide — CSS variables carried by `.slide--<intent>` — and every block reads the levers:

| lever | values | who moves it |
|---|---|---|
| density | sparse · normal · dense | `hook` `reveal` `celebrate` sparse; `prove` `recap` dense |
| title scale | ×0.9 … ×1.4 | `hook` `reveal` `celebrate` up; `prove` down |
| background tone | light · dark · accent · highlight | `hook` `problem` dark; `celebrate` accent; `fun` highlight |
| emphasis | equal · hero | `reveal` `decide` `celebrate` hero |
| alignment | left · centred | `hook` `reveal` `celebrate` `fun` centred |
| rhythm | none · cascade · step | `explain` step; `prove` none — a modulation of the presenter's global motion mode, never a choice in the source |

Then a handful of targeted rules where the meaning demands it: `metrics` under `reveal` (one huge number), `cards` and lists under `explain` (numbered), `compare`/`cards` under `decide` (the recommended option forward), `cards`/lists under `recap` (ticks), the CTA under `act`, glyph play under `celebrate` and `fun`. About twenty rules, not ninety.

## The story linter (warnings, never blocking)

An intent per slide makes the deck's arc readable: `hook › problem › reveal › prove › explain › decide › act`. The linter can then say, as warnings:

- `story-open`: the deck does not open on `hook` (or a cover)
- `story-close`: the deck does not close on `act` or `recap`
- `story-tension`: two `problem` slides in a row with no `reveal` after them
- `story-monotone`: more than half the slides share one intent
- `story-fun`: more than one `fun` in ten slides

The editor shows the arc in the Info panel and offers the intents as chips. Stage 2 (restructuring an import) sets one intent per slide from what the slide means. The eval measures intents set and arc respected.

## For the agent (the rule in agents.md)

Choose the intent from what you want the audience to do with the slide, not from the block: a `metrics` block can `prove` (four equal numbers) or `reveal` (one number that changes everything). Leave the intent out when the slide just informs. Never two `hook`s; at most one `fun`; end on `act` or `recap`.
