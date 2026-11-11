# Images — a brand's image banks, from the JMD side

Status: **V0** (branch `images`). The library side is live: [Jamespot/jmd-images](https://github.com/Jamespot/jmd-images), the contract of a bank (`images.yaml`, five folders, the `add-images` skill) is its README. This page is what JMD does with a bank.

## In one paragraph

A bank is a folder somewhere on HTTPS with an `images.yaml` at its root. The **brand** declares its banks, one prefix each. A deck names an image by `img:<bank>/<slug>`; the build reads the bank's index, fetches the file and embeds it as a data URI, exactly like a file next to the `.jmd`. The built deck depends on nothing. JMD keeps no state: the index lives in the bank, the cache is disposable, and no bank is built into the code — Jamespot's is declared in `themes/brands/jamespot.yaml` like any customer's would be in theirs.

## The brand declares its banks

```yaml
# brand.yaml
images:
  jamespot: https://jamespot.github.io/jmd-images/     # prefix → the folder that holds images.yaml
  acme: images/                                         # relative to a brand.yaml fetched by URL (the brand's own repo)
```

- A prefix is `[a-z][a-z0-9-]*`; a base is an `https://` folder (trailing slash added), or a path relative to the brand.yaml when the brand came from a URL. A local brand (an id, a `.yaml` path, YAML text) may only use `https://` bases.
- No `images:` → an `img:` reference is an error: *no image bank declared by this brand*. The neutral brands declare none.
- The bank is the source of truth for what a slug means; the brand only says where to look.

## The deck names an image

```markdown
![Boîte de réception](img:jamespot/rezilience-groupes-gestion-crise){.right}
::: logos
- ![Apec](img:jamespot/client-apec)
:::
```

`img:` + prefix + `/` + slug, nothing else: no query, no path, no extension, no `img:slug` shortcut (a deck says where each image comes from). Everything that works for a file works for an `img:` — `.right`, `.cover`, `.wide`, a logo wall — because it *is* a file once the build has fetched it.

## Resolution, at build

For each `img:` reference: the prefix must be one of the brand's banks; the bank's `images.yaml` is fetched (and cached ten minutes); the slug must be an entry; `status: retired` still builds with a warning (hidden from search — decision 5 of *A bank kept on Slides*), `draft` passes with a warning, `withdrawn` (a bank kept on Slides only) is refused; the entry's `file` is fetched from the bank's base, checked to be an image by content type and size (2 MB per file, 20 MB per deck with the local files), and embedded. Every refusal is a **`missing-asset` error** naming the reason, the same rule as a file that is not there — the agent then calls `jmd_image_search` and picks another slug.

Fetches go through one function, `fetchBytes` in `tools/images.mjs`: https only, 10 s, capped. It is the one place to route through the hosted service's SSRF guard once that branch lands (private ranges refused, pinned resolution): a bank base is a URL a customer wrote.

Cache: `$JMD_CACHE_DIR` or `~/.cache/jmd/images/` — the index by base for ten minutes, files by URL for good (a slug never changes its meaning; a replaced file under the same slug is picked up after the index refresh, which carries `updated:`). A build with every image cached works offline.

## Search — the agent looks, then pins

`jmd_image_search` (MCP) and `jmd images` (CLI) take the brand and a query — or, for the MCP, `queries`, every search of a deck in one call, because some hosts allow an agent four tool rounds per turn (jmd_spec, the search, jmd_build: three) — and return the best entries of the brand's banks: `img:` reference, caption, tags, kind, fit, and the file URL for a look. Lexical in V0: every word of the query (accents ignored) scored against slug, caption, tags and the kind itself (« logo client » finds logos); `kind` narrows, per query. The agent reads a dozen captions and chooses — it never reads an index whole (`images.yaml` of the Jamespot bank is 180 KB).

**Better nothing than a wrong picture** (Nicolas, 2026-11-04: a slide on the history of France, illustrated with what the bank had). The search used to take any word found anywhere: « château de Versailles » gave 263 of the 294 images through « de », and the answer told the agent to pick one. Now small words do not count, a word matches whole words or their start (three letters or fewer: whole), every word of the subject has to be found (from three words, all but one, with one in the tags or the slug), and of a caption only the first sentence counts, the one that says what is seen. « Nothing » is an answer the agent already knows how to take: that slide goes without an image, and it says so. The price: a query whose words are not all in the bank finds nothing, « agents IA » for one, where « IA » finds thirty.

The contract for agents (`spec/agents.md`): search in the brand's banks first; a stock image is not part of V0; never invent a slug; say which bank an image came from when it matters (a `draft` or a third-party mark).

## An image by URL

`![Tyrannosaure](https://host/tyranosaure.png){.right}` — for a picture that is not in a bank: a file the chat host exposed at a signed URL, a public image. Same door, same rules: fetched at lint and at build through `tools/net.mjs` (https only, private hosts refused, one same-origin redirect, 10 s, 2 MB), an image by its first bytes whatever the extension or the server says, embedded as a data URI. The built deck never loads it: a URL that dies an hour later changes nothing. A URL that is not an image, a 404, an `http://`, a private host → a `missing-asset` error with the reason. `jmd vendor` copies it to `assets/url/<name>-<hash>.<ext>`.

What this does not solve by itself: a file dropped in the chat host's **+** button reaches the model, not the connector. The host has to expose it at a URL for the deck to name it (SafeBrain: a signed, short-lived URL put in the model's context — a host feature). Until then, the drop box below is the way.

## The drop box — `jmd_upload`

Hosted only. The agent calls `jmd_upload` (`action: open` — a required argument, because a host was seen failing on a tool call with no argument at all) and gets a link (`https://<server>/u/<box>`, 96 bits, unguessable) to hand the user verbatim; the user drops images on that page — no account, no password, the link is the whole authorization, as for a delivery; the agent calls `jmd_upload` again (`action: list`, the box) and gets the list; the deck names each file `up:<box>/<name>` exactly as listed. Two tool rounds, the images embedded at build like any other.

The rules of a box (the hosted service's upload page, with its own adversarial cases there): it takes files for one hour and is removed after 24 h; ten files, 2 MB each, 20 MB in all; a file is an image by its first bytes or it is refused (415), whatever its name says; an SVG with script, event handlers, `foreignObject` or an outside reference is refused; the stored name is letters, digits and dashes plus the extension of what the bytes are, a second same name gets a suffix; the page has its own CSP (its script by hash, no frame); an unknown, malformed or traversing box id is a 404 and nothing else; a body without `content-length` is refused before a byte is read, a body above the cap is cut mid-stream. Nothing is fetched, nothing is indexed, nothing is kept: a mailbox, not a bank. `jmd vendor` copies a dropped file to `assets/drop/<name>`.

**And when the host reads nothing at all, the tool has to leave the list** *(1.5.5 and 1.5.6, the same day)*. 1.5.4 made every answer one constant line: the journal shows SafeBrain answering it **twelve times in a row**, `out_bytes` 527, two seconds apart, each call preceded by its own `initialize` — its loop reads no tool result. So 1.5.5 stopped offering the tool to a caller past the count (`hiddenFor(ctx)`, applied where `mcp/server.mjs` registers the tools; back after two minutes, or the moment `receive()` sees a file land in that caller's box). It called it **eight more times against `-32602 Tool jmd_upload not found`**: SafeBrain keeps its own copy of the tool list (`mcp_tools`, refreshed by its *Synchroniser* button), so nothing a server answers — not a line, not an error, not the absence of the tool — interrupts it. Hence the last lever, `JMD_DROP_BOX=off` (1.5.6): the deployment declares it has **no door for a file at all**, `jmd_upload` and `jmd_import` leave the list together (hosted, the import has no other door, and a tool whose only answer is *open a drop box* would be the next thing looped on), and the instructions stop naming a door that is not there. The host drops them at its next sync. This is a workaround for a client that ignores its own protocol, not a design: on a host that reads what it is answered, the box stays.

**And every answer that hands something new is fuel** *(1.5.4, the same loop, four hours later)*. 1.5.2 was not enough, because it left one answer that counted as progress: an id that was not one (0.4.1's rule for a host that fills every field) meant *no id at all*, so a **`list` opened a box** and came back with a fresh link. At 17:26 the model listed `unused-not-needed`, then `will-not-use`, `test`, `check`, `abc` — twelve calls, twelve new boxes, and the per-box counter of 1.5.2 never fired because no two calls named the same box. The lesson, dearly bought: a loop does not feed on errors, it feeds on **novelty**. So now — a `list` opens nothing, ever (a non-id is answered with nothing to chase, and at most the link of the box already open); a second `open` while the caller's box is still empty hands back **the same link**; and past two fruitless answers to the same caller in two minutes (`noteFruitless`, `FRUITLESS_MAX`) every further call gets one constant line with no link, no id and nothing in it, which is the only shape a loop cannot chase. One more thing to remember about the hosts: **SafeBrain does not pass the server instructions** (`INSTRUCTION_LINES` never reaches the model there) — a tool's description and, above all, **its answers** are the only place a rule can be written.

**A box waits for a human, and a tool call cannot** *(1.5.2 → 1.5.8, and see [spec/hosts.md](hosts.md) for the day this cost)*.
Between the two rounds there is a person who has to open a page and drop a file. A host that runs its whole agent loop before
speaking cannot hand the turn back in the middle of it, and on SafeBrain no wording in an answer changes that — measured, six
times, in `spec/hosts.md`. What is left, and what holds regardless of any host, is the shape of the tool:

- **a `list` opens nothing, whatever it is given** (1.5.4). Until then an id that was not one counted as *no id at all* (0.4.1's
  rule for a host that fills every field), so `abc`, `test`, `will-not-use` each came back with a brand-new box and a fresh
  link — a tool saying yes to a word it was never given. An id with fewer than six distinct characters is a placeholder, not an
  id (`isBoxId`: sixteen random base64url characters practically never repeat that much);
- **the empty box says whose move it is**, and a second list of the same box says it is the second (`noteList`, counted **per
  box** — never per caller: hosted, the transport is stateless and there is no caller to count, see hosts.md);
- **a deployment may have no drop box at all**: `JMD_DROP_BOX=off` takes `jmd_upload` and `jmd_import` away together (hosted, the
  import has no other door), the start-up line says `dropBox: off`, and the instructions stop naming a door that is not there.

What was tried and taken back out, because it was aimed at a host that reads nothing: a constant refusal line past a count, and
hiding the tool from `tools/list` for a caller (1.5.5, 1.5.7 — both keyed on a caller the hosted transport cannot identify, which
was a leak between callers before it was anything else).

The `up:` form is strict (`up:<16 chars>/<name.ext>`, lowercase): no path can be built from it, the file is under the uploads folder or it is *no file "x" in this drop box*, a `missing-asset` error like the others.

### Go's box — one drop box for all of Go *(2026-11-10, Alain: « une boîte pour tout Go »)*

Go has a drop box shared by every product (`jamespot-go/spec/contrat.md` §11, drafts 31–32): a page `https://<go>/drop/<box>` (no script, multipart), files recognised by their bytes, one hour to drop, erased after a day, read back by the owner's products through Go's API with a product token. Slides now opens that box instead of its own (`mcp/go-drop.mjs`):

- **Who gets Go's box.** A call made for a person Slides knows as a Go account (`go_links`, written at each sign-in through Go — an OAuth token of ours, or an agent of Go Agents). `jmd_upload open` asks Go for a token (`client_credentials`, Basic with Slides' own client secret, `resource` = Go's API, `scope` = `drop.open drop.read`, `owner` = the person's Go `sub`, contract §5), then `POST /api/drop`; the link handed over is built on Go's origin from the id Go gave, never taken from its answer. **Everyone else gets our box, as before**: the shared token (no person), a person who never signed in through Go, Go refusing (no live authorization for Slides, 30 boxes a day…), or the switch off. Nothing breaks.
- **The switch.** `JMD_GO_DROP=on`, with `JMD_GO_ISSUER` written (Go's origin: Go staging's origin on our staging app, `https://go.jamespot.io` in production — no default, so staging never reaches production) and `JMD_GO_CLIENT_SECRET` (the secret Slides already signs in with). The start-up line says `dropBox: go`.
- **The agent's contract does not change.** A Go box id has the shape of ours (sixteen base64url characters), so the deck still writes `up:<box>/<name>` exactly as `jmd_upload list` gives it, and `jmd_import { box }` reads the presentation from it.
- **Go keeps nothing past a day, so we copy.** `list` and `jmd_import` take Go's list (`GET /api/drop/<box>`) and fetch each file not taken yet (`GET /api/drop/<box>/<id>`) into a box of ours under the same id (`<uploads>/<box>/`, with a `.go` file saying whose it is), where the build reads it like any box. A deck naming `up:<box>/<name>` of a box never listed is fetched at build, for the person building.
- **Go's bytes are input.** Every call has a deadline (15 s, 60 s for a file), no redirect is followed, an answer is read up to a cap and cut beyond it (a list 256 KB, an image 2 MB, a presentation 50 MB); a file id is a short token or it is never asked for; a name is only ever a word our own rule rebuilds; a sha256 that does not match Go's list is a refusal. Then the box's own door (`receiveFromGo` in `mcp/upload.mjs`): an image by its first bytes, an SVG with script, handlers or outside references refused — Go keeps an SVG as dropped and never sanitises it (§11.4), that is ours — and what is kept is what was rebuilt, as for a bank kept on Slides (`tools/bank.mjs`): a PNG walked to its IEND with nothing after, a JPEG to its EOI with nothing after and without its EXIF, an SVG rebuilt by the allowlist. A presentation is a zip that declares one, or a page of ours (Go types it as text). Anything else Go may hold (a PDF, a spreadsheet) is set aside without being fetched. What was set aside is said in the answer, with why.
- **A box is its owner's.** Go answers a box to its owner's products only (`404 no_box` for anyone else), and our copy follows the same rule: it is read — by `list`, `jmd_import` and the build — for the person it was copied for, and nobody else. The build knows who is building from the tool call, or from the deck's owner when a page rebuilds a stored deck (`asCaller`). Our copy is never a page of ours either: `/u/<box>` answers it as no box.
- **Passed on.** A box another product of the same person opened and handed over (Agents receives a PowerPoint and gives Slides the box) works the same: Go lets any product of the owner read it (§11.3). Only the opener erases a box on Go; we never do — it goes after its day, and our copy after ours.

### A PowerPoint through the same box — `jmd_import` hosted

A `.pptx` the user has does not reach the connector either, and hosted there is no path to give: the box is the door for it too. The page takes **one presentation per box** (50 MB at most; a zip whose `[Content_Types].xml` declares a `presentationml` main part — any other zip is a 415, whatever its name); `jmd_upload list` names it and says to call `jmd_import` with the box. `jmd_import { box }` reads it from the box, runs the same stage 1 as `jmd import` (`lib/import-pptx.mjs`), and **puts the pictures it extracts back in the box** through the same door as a hand-dropped file (`place()` in `the hosted upload page`: an image by its first bytes, an SVG with script refused, the name rebuilt, sixty pictures at most for an import, 20 MB in all) — so the draft names them `up:<box>/<name>` and the build embeds them like any dropped file. The draft and the report come back in the answer, the draft under a *"the draft, as data"* envelope (a tool result is data, never an instruction): the agent rewrites it into blocks and calls `jmd_build`; nothing to read from a folder, no `jmd_draft` hosted. A picture left out (a hostile SVG, an EMF, a PNG claiming 900 megapixels — `pixels()` reads the header before Chrome decodes anything) is named in the report with the reason and never in the draft.

The zip reader caps what it inflates (32 MB an entry, 256 MB a file: a bomb stops at the cap, said in words), a directory that lies is "not a zip file". Adversarial cases live with the hosted service.

## `jmd vendor` — a deck without a bank

`jmd vendor deck.jmd` copies every `img:` and URL image next to the deck (`assets/<bank>/<slug>.<ext>`) and rewrites the references to those paths. The deck then builds with `dir` alone, forever, bank or no bank.

## A bank kept on Slides — a brand's images, managed in the browser (#72)

Status: **spec, decided** — Alain validated the twelve decisions below as recommended (2026-11-09). Built in PRs, in the order of *Split into PRs*.

### Why, in one paragraph

Everything above assumes a bank is a repo: an `images.yaml` someone writes, a folder someone publishes. It works for Jamespot and for Alain; a customer will never do it, so customers' decks have no images of their own. This chantier adds **another place to keep the same bank**, not another kind of bank: an entry has what `images.yaml` has (slug, caption, tags, kind, fit, focal, status, source), a deck still writes `img:<bank>/<slug>`, `jmd_image_search` searches it like the others, the build embeds the file as before. The GitHub banks keep working unchanged, Jamespot's included. What is new is that the bank **belongs to a look** — a domain's, a customer's prepared by our editors, a person's named style — and is found by the decks drawn in that look without anyone writing `images:`.

### The one idea: a hosted bank is a folder on our own origin

A bank kept on Slides is served at **`<JMD_PUBLIC_URL>/bank/<id>/`**, with an `images.yaml` at its root and its files beside it, exactly the shape of a GitHub bank. `<id>` is random (128 bits, base64url, 22 characters), never a domain or a style name, so an address says nothing about whose bank it is and no bank can be listed by guessing an organisation.

Three things follow, and they are why this shape and not another:

- **No new resolution path.** The look gets `images: { <prefix>: https://slides.jamespot.io/bank/<id>/ }` added when it is resolved (below), and from there it is a bank like any other: `banks()`, `REF`, `resolveImages()`, `searchImages()`, `vendor()` unchanged. `brandYaml()` already bakes banks as absolute folders, so the `brand_spec` a deck keeps carries its bank, and the editor, the room and every export rebuild it as it was drawn.
- **Portable.** A brand.yaml downloaded from a card (`brandDownload`) names the bank by its https address, so the public `jmd` CLI builds the same deck with nothing of ours but that URL.
- **Fast where it matters.** The hosted server never fetches its own origin: `tools/images.mjs` gets a *local reader* (`setLocalBanks({ origin, index(id), file(id, name) })`, set by `mcp/server.mjs` the way `setDiscover` is), and a base that is **exactly** `<JMD_PUBLIC_URL>/bank/<id>/` with `<id>` matching `^[A-Za-z0-9_-]{22}$` is read from the store in-process, never cached in the ten-minute index map (an image uploaded is searchable at once). Any other base — `slides.jamespot.io.evil.com`, another port, an id of the wrong shape — goes through `fetchBytes` and the network door as today.

### Storage

**S3** (the store's bucket, `mcp/store.mjs`): `banks/<id>/<slug>-<sha8>.<ext>`, `<sha8>` the first 8 hex of the SHA-256 of the bytes kept. A replaced file is a new key (so the "files for good" cache of a CLI build can never serve the old picture under the new name) and the old key is deleted once the row points at the new one. Nothing else lives under `banks/`; the bucket's `archive/` rule does not touch it.

**Postgres**, two tables added to `SCHEMA` (created `if not exists` at start-up like the others; no semicolon in a comment, the schema is cut on them; PGlite runs the same text in the tests):

```sql
create table if not exists image_banks (
  id text primary key,                      -- the random folder: S3 and the public address
  domain text unique,                       -- a domain's bank (its people, a customer's prepared by our editors)
  iss text, sub text, style text,           -- or a person's named style
  prefix text not null,                     -- what decks write: img:<prefix>/<slug>
  images integer not null default 0, bytes bigint not null default 0,   -- the quota's counters
  created_at timestamptz not null default now(), created_by text,
  check ((domain is null) <> (style is null))
);
create unique index if not exists image_banks_style on image_banks (iss, sub, style) where style is not null;
create table if not exists bank_images (
  bank text not null references image_banks(id) on delete restrict,
  slug text not null, file text, mime text not null, bytes integer not null, width integer, height integer,
  caption text not null default '', tags jsonb not null default '[]', kind text not null, fit jsonb not null default '[]',
  focal jsonb, status text not null default 'draft' check (status in ('draft','approved','retired','withdrawn')),
  source text, credit text, origin text,
  added_at timestamptz not null default now(), added_by text, updated_at timestamptz not null default now(),
  first_used_at timestamptz,                -- set once, the first time a deck resolves it or its public address is fetched
  primary key (bank, slug)
);
```

The quota is taken in the statement that checks it — `update image_banks set images = images + 1, bytes = bytes + $n where … and images + 1 <= max and bytes + $n <= max returning` — so the row lock makes two uploads at the edge wait for each other and only one lands; every later step that fails gives the room back. Lists are `jsonb` (as the rest of the schema), a withdrawn row keeps its slug with no file and no bytes. Built in PR 1: `tools/bank.mjs` (the bytes, the words, the index) and the `bank*` methods of `mcp/store.mjs`.

`kind` is `capture | illustration | photo | logo | schema`, `fit` a subset of `cover | right | wide | inline`, `status` `draft | approved | retired`, `focal` two numbers in [0, 1] — the bank contract's own words, checked by shape on every write. `added_by` is the actor as the journal names it, never shown outside the bank's writers. When two Slides identities are linked (`store` line ~723, `person_styles` follows the person), `image_banks.iss/sub` follows in the same statement. A style removed keeps its bank, read-only and still served: decks drawn in it bake its address.

The served `images.yaml` is **written by our serializer from the rows**, every scalar double-quoted and escaped, every list inline and quoted, so a caption holding a line break and `- slug: evil` stays one caption (tested against `parseIndex`, which must read back exactly the rows). Retired entries are in it (marked), drafts too: it is the bank, not a search result.

### How a look declares its bank — nobody writes `images:`

The bank is attached when the look is **resolved for a call**, in one place: `resolveFor` / `houseBrand` (`mcp/tools.mjs`), which already know where the look came from.

| The look came from | Its bank | Who writes it |
|---|---|---|
| a domain — the caller's organisation (`orgBrand`), or `brand: acme.com` named | the domain's row in `image_banks` | the domain's brand admins (`brand_admins`); while it has none, a signed-in person of the domain, as for the card (`may.save`); our editors (`JMD_BRAND_EDITORS`) and `/admin` |
| a customer's look prepared by our editors (`/home/brands/<domain>`, `via = hand`) | the same domain row: one bank per domain, whoever prepared the look | our editors, then the domain's admins once they hold it |
| a person's named style (`brand: salon`, `person_styles`) | the style's row | the person, alone (their `iss` + `sub`, proven by OAuth or a session) |
| the colours a person lays over their organisation's look (style `''`) | the organisation's bank, unchanged | as the organisation's |
| a shipped id, a brand.yaml URL, YAML text | none added — what it declares, as today | — |

The prefix is the bank's, chosen at its creation: by default the domain's first label (`acme.com` → `acme`) or the style's name, `PREFIX` shape, 2–30 characters, frozen once the bank's first image is used. **It is automatic: the screen has no field for it** (Alain, 2026-11-10) — a person never edits a prefix; the route `POST /home/banks/<id>` `prefix=` stays, server side, for our team. A prefix the look already declares wins (`jamespot.com`'s look declares the GitHub `jamespot`, so the domain's hosted bank takes another, `jamespot-images` by default): the bank is made with a free one. A look published on the domain's site (`.well-known`, `via = site`) still gets its domain's bank: the bank is not part of the look's YAML, and the admins keep writing it.

**What this does not do:** a deck built before its look had a bank carries a `brand_spec` without it; it gets it at its next `jmd_build` (which resolves the look again), not in the editor, which redraws from the baked spec. Said on the screen, not worked around.

### The name a deck uses

Unchanged: `img:<prefix>/<slug>`, `REF` as it is. The slug is made at upload from the file name (accents stripped, lowercase, anything else a dash, 60 characters at most, a camera name such as `IMG_1234` or `DSC0042` replaced by the kind and a number), a suffix `-2`, `-3` on a collision. It can be changed **until `first_used_at` is set** — the first build, lint or render that resolves it, or the first GET of its public address; the screen shows the files through a private route that does not count — and never after. *Never rename a slug once used.*

### Limits

| | Domain bank | Style bank |
|---|---|---|
| per file | 2 MB, 8 192 px a side, 40 megapixels (the GitHub contract's 2 MB, the build's `FILE_MAX`) | same |
| per bank | 500 images, 250 MB | 100 images, 50 MB |
| per request | one file per POST from the screen; a form without script sends 10 files, 20 MB at most | same |
| a caption | 300 characters, text only | same |
| tags | 20 tags of 40 characters | same |

A quota is checked in the same transaction as the insert, so two uploads racing past it cannot both land; a file over a cap is refused whole, nothing half-stored. A body without `content-length` is refused before a byte is read (411), one above the cap is cut mid-stream (413), as the drop box does.

### Formats — judged by the bytes, kept as rebuilt

**JPEG, PNG, SVG only**: no WebP, no GIF, no AVIF (decided for the GitHub bank: the images also serve outside JMD, in PowerPoint, Keynote, a file taken by hand). The extension, the name and the type the browser claims are never read; the bytes decide, and what is kept is what was checked and rebuilt, never what was sent — the logo's rule (1.31.0) extended to a bank.

- **PNG, read in full** — a new `pngWhole(bytes)` beside `pngInfo` in `tools/safe.mjs`: signature, IHDR first (1–8 192 a side, 40 MP), then **every chunk walked** with its length checked against what is left and its CRC computed, IEND last with nothing after it. `acTL` (an animated PNG) refused. Kept: the critical chunks and `tRNS`, `gAMA`, `cHRM`, `sRGB`, `iCCP`, `pHYs`; dropped: every text and metadata chunk (`tEXt`, `zTXt`, `iTXt`, `eXIf`, `tIME`, private ones). The kept file is those chunks copied whole, in order.
- **JPEG, by its markers** — a new `jpegWhole(bytes)`: SOI first; every segment walked by its length up to SOS; one SOF (baseline or progressive) with 1–8 192 a side and 40 MP; the entropy-coded data scanned to the EOI that ends the file, **nothing after it** (an appended zip, HTML or script is a refusal, not a passenger). Kept: APP0 (JFIF), APP2 (ICC), APP14 (Adobe), the tables and the frame; dropped: APP1 (EXIF, XMP — a phone photo's GPS position and owner's name), APP13, COM and the other APPn. The orientation of an EXIF block is the one value carried over, in a minimal APP1 we write (one IFD entry), so a phone photo is not turned on its side.
- **SVG, rebuilt by the allowlist** — `sanitizeSvg` of `tools/safe.mjs`, the logo's tokenizer, then `svgOfSymbol` to a standalone file: no script, no handler, no `foreignObject`, no `<image>` (an embedded bitmap is the GitHub contract's refusal too), `href` and `url()` local only, a `<!DOCTYPE>` or an `<!ENTITY>` refused before parsing (no entity expansion). An SVG with nothing drawable left is refused. Ids are prefixed per image (`im-<sha8>-`) so two SVGs embedded in one deck never share an id.

Every refusal is a sentence on the screen and a code in the journal (`png`, `jpeg`, `svg`, `type`, `big`, `pixels`, `quota`), never the file's name.

### Who writes, who uses

**Writing** (upload, caption, tags, kind, fit, focal, status, a slug not yet used, the prefix before first use): the people of the table above, checked **server-side on every POST** from the bank's owner row, whatever the page showed; a post from another origin refused before its body is read; a personal mailbox writes no domain's bank (`organisationOf`). Anyone else meets the 404 of an address that does not exist, GET or POST — as `/home/brands/<domain>` does.

**Using**: everyone wearing the look — the build and `jmd_image_search` read the bank of the deck's look, whoever calls. That is the rule of wearing since 1.31.0 (a look was never protected: `brand: acme.com` draws anyone's deck in Acme's colours), so **a bank is as public as its look**: the files and the index are served to whoever has the address, with no session. The screen says it where the drop zone is: *what you put here can be seen by anyone using your look — nothing confidential* (the GitHub bank's « Rien de confidentiel »). A private bank — files only ever embedded, never served — would be another chantier.

**Removing**: an image whose `first_used_at` is null (a mistaken upload nobody built) is deleted, row and file. Once used it is **retired**, never deleted: hidden from search, still in the index, its file still served, and still embedded by a build — *with a warning, not the error a GitHub bank's `retired` gives today* (see decision 5: an old deck rebuilt in the editor must still find its image). The one true removal of a used image is **withdrawal** by our admins (rights lost, a photo someone asks to take down): the file is deleted, the row stays with `status: withdrawn`, and a build that names it gets the `missing-asset` error *withdrawn from bank "acme"*.

### The routes

| | |
|---|---|
| `GET /bank/<id>/images.yaml` | the index, written from the rows; `text/yaml`, `nosniff`, `default-src 'none'; sandbox`, `cache-control: public, max-age=60` |
| `GET /bank/<id>/<slug>-<sha8>.<ext>` | the file, its type **from the row**, never the extension; `nosniff`, `default-src 'none'; style-src 'unsafe-inline'; sandbox`, `cross-origin-resource-policy: cross-origin`, `immutable` (the hash is in the name) — exactly the logo's headers. An unknown id, a traversal, a name of the wrong shape, a withdrawn file: the same empty 404 |
| `POST /home/banks` | the bank of a look this person writes, made on first ask: `domain=` (their organisation's by default; any domain for our editors) or `style=<name>` (one of their named looks); answers its `id`, `prefix` and quota — the id every route below takes. Its prefix by default, or `<prefix>-images` when the look already declares that one (added in PR 2: nothing else makes a bank) |
| `POST /home/banks/<id>` | no field on the screen (the prefix is automatic); `prefix=`: changed while none of its images was used, never to one the look declares (nor, for a style, its organisation's bank's) |
| `POST /home/banks/<id>/upload` | one file (the screen: the bytes as the body, the name in `?name=`) or a multipart of ten under `file` (no script); answers the new entries with their suggested metadata, the refusals by position and code (never the file's name), and the quota left |
| `POST /home/banks/<id>/<slug>` | edit: caption, tags, kind, fit, focal, status, slug (until used); `do=retire`, `do=delete` (unused only); `do=withdraw`, our admins only (`JMD_ADMINS`), on any bank |
| `POST /home/banks/<id>/import` | an `images.yaml` URL or a zip (below) |
| `GET /home/banks/<id>/file/<slug>` | the file for the writers' grid, behind the session, does not set `first_used_at` |

The screen itself lives in **Themes** (#70): « Images » beside the look and the styles, a grid of the bank's images with their caption and tags, drag and drop, each image editable in place. Its address is **`/home/themes/images`** (the person's organisation's bank), `?style=<name>` (a named style's, also linked from its card), `?domain=<domain>` (a customer's, for our editors, linked from the customer's card) — the routes' rule decides who sees it: signed in and not a writer, the 404; not signed in, a GET goes to sign in and comes back (`mcp/bank-screen.mjs`, PR 4). A form without script (`Accept: text/html`) is answered by a 303 back to that screen with a word (`said=up&ok=2`, `said=saved#img-<slug>`, `said=<error>`), the same decision in another envelope; « Tout approuver » is `do=approve` on `POST /home/banks/<id>`. The screen is the first page of ours that needs a script to talk to the server (one POST per file, with progress): one script by hash and **`connect-src 'self'` on that page only** — a change of its CSP, said here because it is a decision (decision 10). Without script, the plain form still uploads.

**Approving is a step, not a wall of forms** (Alain, 2026-11-10, `bank-review`). The images just added — dropped, picked or imported — come back at once in a **review**: a `<dialog>` with, for each, its picture, caption, tags and kind prefilled with the suggestions, and under « Plus » its fits, its name while unused, its reference for the assistant (read-only, `img:<prefix>/<slug>`), retire and delete. « Approuver » saves and approves one; « Tout approuver » the drafts listed; « Plus tard » leaves them drafts. The grid is compact — picture, caption, status, used — and a card opens the same review for its one image; drafts waiting are one banner, « 3 images à vérifier », that opens the review on them. The page shows no `img:` reference anywhere else. The review is `?review=<slug>,<slug>` (50 at most) or `?review=drafts`, rendered by the server as a `<dialog open>`: without script it is a section at the top of the page and every button a plain post (the routes redirect back with `&review=` after an upload, and after an import that landed drafts); with script it is made modal and its buttons post as JSON. Same policy, the one script by hash.

### Search and build read the bank of the deck's look

- **`jmd_image_search`** resolves the look **with `resolveFor(a, '', ctx)`**, as the build does — today it calls `jmd.resolveBrand(pickBrand(a))`, so a signed-in person who names no brand searches the default's banks, not their organisation's: a gap this chantier closes on the way. Then `searchImages` unchanged, over the bank's rows read in-process in the bank-index shape: the same lexical scoring, the same *better nothing than a wrong picture*, `limit` per query (12, 30 at most), twelve queries at most. **The model never receives an index**: a dozen hits per query, each its reference, first caption sentence, kind, fit, eight tags, status if not approved, and the file's address. Drafts come back marked `draft`; retired and withdrawn never.
- **The build** (`bankImages` → `resolveImages`): a hosted bank's slug is read from its row and its bytes from S3 through the local reader, sniffed again, embedded as a data URI; `first_used_at` set if null. 2 MB per file and 20 MB per deck, as today.
- **`jmd_spec`** (hosted) says, after the brand line, that the look has image banks and how many images each holds — names and counts, never entries: *Your look has an image bank: `acme` (132 images). Search it with jmd_image_search before writing.* A look with no bank says nothing new.

### Suggestions at upload

Every uploaded file lands as **`draft`**, with metadata suggested and editable on its card:

- **caption**: the file name made a sentence (dashes and underscores to spaces, a camera name dropped), shown as a suggestion to replace — the lexical search is only as good as captions, and a file name is a poor one;
- **tags**: the words of the file name that are not stop words, plus the kind;
- **kind**: SVG → `logo` if square-ish and small, else `illustration`; JPEG → `photo`; PNG with transparency → `logo` under 800 px, `illustration` above; PNG opaque and wide → `capture`;
- **fit**: from the ratio (≥ 1.6 → `wide, cover`; 0.8–1.25 → `right, inline`; portrait → `right`).

An image becomes `approved` when a writer saves its card, or with « Tout approuver ». A model reading the picture to write the caption (Mistral, server-side, as Memory) is **not V1**: it would send a customer's images to a model, which is a decision of its own (decision 9).

### Import — to start a customer fast

- **From a GitHub bank**: a writer gives the https folder of an `images.yaml`. The index is fetched through `fetchBytes` (the network door: https, no private address, 4 MB), parsed by `parseIndex`; each entry's `file` must be a relative path under that folder (no scheme, no `..`, no leading `/`), fetched through the same door, and checked **exactly as an upload** (formats, sizes, rebuild). Slugs, captions, tags, kind, fit, focal, status, source, credit and origin are kept, so a deck written against the GitHub bank works after changing only its prefix. An entry that fails is skipped and named in the report; the quota is checked before each file. WebP and GIF entries are refused, as uploads.
- **From a zip**: one `.zip` (50 MB, read by `tools/zip.mjs` with its caps: 32 MB an entry, a bomb stops at the cap), at most 500 entries; names with `..`, a leading `/` or a backslash are skipped. An `images.yaml` at its root gives the metadata (same parser, `file` resolved inside the zip only); files without an entry get the upload's suggestions and land as `draft`.

Both run in the request (the checks decode nothing; 500 files take seconds) and answer a report: imported, skipped with why, quota left. An import never replaces an existing slug: a collision is skipped and said.

**The route, as built (PR 5).** `POST /home/banks/<id>/import`, behind the same door as every bank route (the writers' rule, another origin 403, no `content-length` 411, over the cap 413):

- `application/x-www-form-urlencoded` with `url=` — the https folder (or its `…/images.yaml`), 16 KB of form at most;
- a body of any other type — the `.zip` itself, 50 MB at most (what the screen's « Importer » sends: `fetch(…, { method: 'POST', body: file })`);
- `multipart/form-data` — the form without script: a `file` (the zip) or a `url` field.

It answers `200` with the report whenever the source could be read, even when nothing landed:

```json
{ "source": "url" | "zip",
  "imported": [ /* each entry exactly as the upload answers it: slug, caption, tags, kind, fit, focal, status, width, height, bytes, used, file, preview */ ],
  "skipped":  [ { "name": "photos/x.webp", "slug": "x", "code": "type", "message": "not a JPEG, a PNG or an SVG" } ],
  "quota":    { "images": 132, "bytes": 51234567, "max_images": 500, "max_bytes": 262144000 } }
```

`name` is the `file` of the index or the zip member's name (text, 200 characters at most), `slug` is there when the index gave one. A skip's `code`: `path` (a `file` outside the folder or the zip), `name` (a zip member with `..`, a leading `/` or a backslash), `missing` (no such file in the zip), `fetch` (the host did not give it), `slug` (not of the shape), `slug-taken` (the bank has it, or the index names it twice), `quota`, `time` (a URL import holds the request 120 s at most, checked before each file: the files not reached are skipped, the answer carries `"late": true`, and importing again takes up the rest — what landed is skipped as taken), the upload's `type`, `png`, `jpeg`, `svg`, `pixels`, `big`, and a field of the wrong shape (`caption`, `tags`, `kind`, `fit`, `focal`, `status`, `source`, `credit`, `origin`). An entry the index gives without `status` is `approved` (it was the bank's); a file of a zip without an entry is a `draft` with the upload's suggestions, and when two of them suggest the same slug the second takes `-2`, as an upload. A zip's `images.yaml` is read at its root, or at the root of its one top folder (GitHub's « Download ZIP »); folders, `__MACOSX` and hidden files are not reported.

On the screen (« Importer » beside « Tout approuver » in Images): a zip picker and an address field. The script posts the zip as the body or the address as `url=`, asks for JSON and shows the report in the box — the count imported, each skipped entry by its name (as text) with the page's sentence for its code, the images the bank now holds. The form without script posts multipart with `Accept: text/html` and is answered, as every bank route, by a redirect back to the screen: `?said=imported&ok=<n>&n=<skipped>&no=<codes>`, or `?said=<error>` — a word and counts, never a name.

When the source itself cannot be read, nothing is stored and the answer is `{ "error", "message" }`: `400` with `url` (not an https address), `private` (a private network), `unreachable`, `index-big` (over 4 MB), `index` (no entry), `entries` (over 500, in an index or a zip), `zip` (not a zip), `nothing`; `413` with `big`.

### Exports

Nothing changes: a hosted bank image is a data URI in the built deck like any `img:`, so the PPTX, the PDF and the PNG take it as they take a GitHub bank's. One case per format in the tests (a PNG, a JPEG, an SVG from a hosted bank reach a `.pptx`, a page of the PDF, a PNG), and `jmd vendor` copies them to `assets/<prefix>/<slug>.<ext>` as before.

### Adversarial cases, in `mcp/test.mjs`, before it ships

*The doors:* not signed in, a person of another domain, a personal mailbox, a colleague of the domain once it has admins, a non-editor on a customer's bank, another person's style bank — each a 404 for GET and POST, nothing stored; a post from another origin refused before the body is read; a body without `content-length` (411), one cut past the cap (413).
*The bytes:* a PNG with a script after IEND; a PNG with a bad CRC; a chunk whose length runs past the file; an IHDR of 100 000 × 100 000; an APNG; a `tEXt` carrying `<script>` (dropped, the image kept); a JPEG without EOI; a JPEG followed by a zip (polyglot); a SOF of 0 × 0 and of 9 000 × 9 000; a truncated segment; a phone JPEG whose GPS EXIF is gone and orientation kept; an SVG with `onload`, `<script>`, `foreignObject`, `<image href="data:…">`, an external `href`, a `url(http…)` in a style, a `<!DOCTYPE>` with entities (billion laughs); an SVG with nothing drawable; a WebP, a GIF, an HTML file named `.png`, `.jpg`, `.svg` (415).
*The words:* a file name with `../`, a NUL, 300 characters, a right-to-left override, `<script>` → a slug of the shape; a caption with `</script>` shown as text in a real browser under the screen's real CSP; a caption with a line break and `- slug: evil` → the served index reads back as exactly the rows (`parseIndex`); 21 tags, a tag of 41 characters, a focal of `[2, -1]`, a kind or a status not in the list → refused by shape.
*The rules:* a used slug renamed → refused; a used image deleted → refused (retire); a retired image still built with a warning, absent from search; a withdrawn image → `missing-asset` naming the reason; quotas reached by count and by bytes, and two concurrent uploads at the edge → one lands; a prefix taken by the look's own `images:` → refused.
*The reading:* the local reader takes `https://<public>/bank/<id>/` and nothing else (`<public>.evil.com`, another port, an id of 21 or 23 characters, an id with `/` go through the network door, where they fail as any unknown host); a search answer never more than `limit` hits; `« de la »` lists nothing; `jmd_image_search` without `brand` for a signed-in person searches their organisation's bank; the served file's type is the row's whatever the extension; the journal names the bank by four characters and counts, never a caption or a file name.
*The import:* an `images.yaml` on a private address, of 5 MB, with a `file` that is absolute, another host, or climbs; a zip bomb; a zip with `../` names; a zip of 10 000 entries.

Then `spec/security.md` gets its line with the version (a new input channel: files and words from a browser, and a URL a customer writes).

### Split into PRs

| # | PR | What | Size |
|---|---|---|---|
| 1 | `bank-store` | the two tables, S3 keys, `pngWhole` / `jpegWhole` / the SVG rebuild for a bank, the index serializer; unit adversarial cases (bytes, words) | M, ~600 lines with tests |
| 2 | `bank-routes` | upload, edit, retire, delete-unused, withdraw; `/bank/<id>/…` served; the writers' rule; quotas; the doors' and rules' cases | M–L, ~800 |
| 3 | `bank-wiring` *(done)* | attach the bank in `resolveFor`, the local reader in `tools/images.mjs`, `first_used_at`, `jmd_image_search` through `resolveFor`, the `jmd_spec` line, retired-builds-with-a-warning; the reading cases; the export cases | M, ~400 |
| 4 | `bank-screen` | « Images » in Themes (#70 merged first): grid, drag and drop, cards, suggestions; one script by hash, `connect-src 'self'`; screenshots read with `tools/cdp.mjs` | L, ~900 |
| 5 | `bank-import` | GitHub `images.yaml` and zip, the report; the import cases | M, ~400 |

Each leaves its note in `mcp/doc/releases.d/` (1–3 `patch` — nothing a user sees yet, 4 and 5 `minor`), or 1–3 go in as one `minor` if Alain prefers one visible version for the feature. 4 waits for #70; 1–3 do not. #69 (the graphic elements of a charter) can take the same storage (`image_banks` with a `kind` of bank) when it comes.

### Decisions — taken by Alain, 2026-11-09, each as recommended

1. **Is a bank as public as its look** — files and index served to whoever has the (unguessable) address, no session? *Decided (Alain, 2026-11-09): yes*, as the logos and the GitHub bank; the screen says « rien de confidentiel ». A private bank is another chantier.
2. **Who may use**: anyone wearing the look, including from outside with `brand: acme.com`? *Decided (Alain, 2026-11-09): yes* — the rule of wearing since 1.31.0; restricting it would make a deck shared with a partner fail on rebuild.
3. **The prefix**: the domain's first label (or the style's name) by default, editable until first use, never one the look already declares? *Decided (Alain, 2026-11-09): yes.* For jamespot.com, which already has the GitHub `jamespot`, a name to choose (`jamespot-equipe`?).
4. **A named style's bank**: its own only, or its own **and** the organisation's of its owner? *Decided (Alain, 2026-11-09): its own and the organisation's* — a person who makes « salon » for a trade show still wants their company's product screens.
5. **`retired`**: today a GitHub bank's retired slug is a build **error**. *Decided (Alain, 2026-11-09): hidden from search, still built with a warning, for both kinds of bank* (the bank README already says « ceux qui la nomment encore la trouvent »), plus an admin-only **withdrawal** for a picture that must disappear. This changes the current resolver.
6. **Limits**: 2 MB a file; 500 images and 250 MB a domain bank; 100 images and 50 MB a style bank; ten files per form post. *Decided (Alain, 2026-11-09): as written*; raise per customer by hand if one asks.
7. **Metadata**: strip EXIF / XMP / PNG text chunks at upload, keep only the orientation. *Decided (Alain, 2026-11-09): yes* (a phone photo carries where it was taken).
8. **Drafts**: an upload lands as `draft` (searchable, marked) until a writer saves its card or approves all. *Decided (Alain, 2026-11-09): yes.*
9. **A model writing captions and tags from the picture**: not in V1; later, Mistral server-side, opt-in per bank? *Decided (Alain, 2026-11-09): later, opt-in* — it sends a customer's images to a model.
10. **The screen's CSP**: one script by hash and `connect-src 'self'` on that page only, for drag and drop and one POST per file. *Decided (Alain, 2026-11-09): yes*, the plain form staying as the fallback.
11. **One bank per domain** shared by our editors (customer's look prepared) and the domain's admins. *Decided (Alain, 2026-11-09): yes.*
12. **The release**: PRs 1–3 as `patch` notes (nothing visible) and 4–5 `minor`, or the whole as one `minor`? *Decided (Alain, 2026-11-09): one `minor` at PR 4*, PRs 1–3 merged with `patch` notes.

## Todo — V1, in the order it pays (2026-09-20)

The constraint that orders this list: a host such as SafeBrain gives an agent **four tool rounds** per turn. A deck with images is `jmd_spec` → one `jmd_image_search` → `jmd_build`; the search has one shot and must land it.

1. **Captions and tags at entry** — the lexical search is only as good as the bank's `caption` and `tags`; the `add-images` skill of the bank writes them (what is seen, the product, the use). Keep raising that bar before adding machinery.
2. **Synonyms** — a small dictionary applied to the query and the tags (crise ↔ PRA, PCA, cellule de crise · messagerie ↔ inbox, boîte de réception · RSE ↔ réseau social d'entreprise · capture ↔ écran, interface); in the bank's `images.yaml` (`synonyms:` at the top) or in `searchImages`, free at run time.
3. **Embeddings** — `images.index.json` precomputed in the bank (one vector per entry, from caption + tags), the query embedded at search time: « une équipe soudée » finds the seminar photo without the word. Still no state in JMD: the bank carries its own index.
4. **Stock adapter — an option, not scheduled (decided 2026-09-20)**. For what no bank has (a dinosaur), the model stays the drop box: the user finds the picture, drops it, the deck names it `up:<box>/<name>`. If a live source is ever wired, it is **Pexels**, not Unsplash: key issued at once with no production review, 200 requests/h and 20 000/month, numeric ids so `img:pexels/<id>` fits `REF` as it is, `locale=fr-FR` for French queries, credit recommended rather than a condition of the key (Unsplash: manual review of the attribution before a production key, case-sensitive ids that break `REF`, a download ping to make). Shape when it comes: the prefix is declared by the brand (`images: { pexels: stock }`, opt-in — a customer brand gets no stock unless it says so), the key lives in the server's environment (`PEXELS_API_KEY`, never in a brand.yaml), the stock hits come in the **same** `jmd_image_search` call after the bank's, three at most and marked; the file is fetched through `fetchBytes` with the host pinned and embedded like any bank image, the credit cached beside the bytes and printed by the runtime; and the agent's rule: a stock photo illustrates an idea, never a customer, a testimonial or a named user (the license forbids an implied endorsement). Adversarial cases before it ships: an id with `../`, an id of 10 000 chars, an API answer that is not an image, no key.
5. ~~**An image by https URL**~~ — done (branch `image-urls`): see *An image by URL* above. The host half remains: SafeBrain exposing a dropped file at a signed URL in the model's context.
5b. ~~**`jmd_upload`**~~ — done (branch `drop-box`): see *The drop box* above.
5c. ~~**A `.pptx` through the box**~~ — done (branch `import-box`): see *A PowerPoint through the same box* above.
6. **SVG recolored by the theme**, **usage feedback** (which slugs decks use, back to the bank as a counter).
7. **A bank kept on Slides, managed in the browser** (#72) — spec above, *A bank kept on Slides*, decided 2026-11-09, being built.

Each is a bank-side or search-side addition; the reference form `img:<bank>/<slug>` does not change.
