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

For each `img:` reference: the prefix must be one of the brand's banks; the bank's `images.yaml` is fetched (and cached ten minutes); the slug must be an entry; `status: retired` is refused, `draft` passes with a warning; the entry's `file` is fetched from the bank's base, checked to be an image by content type and size (2 MB per file, 20 MB per deck with the local files), and embedded. Every refusal is a **`missing-asset` error** naming the reason, the same rule as a file that is not there — the agent then calls `jmd_image_search` and picks another slug.

Fetches go through one function, `fetchBytes` in `tools/images.mjs`: https only, 10 s, capped. It is the one place to route through the hosted service's SSRF guard once that branch lands (private ranges refused, pinned resolution): a bank base is a URL a customer wrote.

Cache: `$JMD_CACHE_DIR` or `~/.cache/jmd/images/` — the index by base for ten minutes, files by URL for good (a slug never changes its meaning; a replaced file under the same slug is picked up after the index refresh, which carries `updated:`). A build with every image cached works offline.

## Search — the agent looks, then pins

`jmd_image_search` (MCP) and `jmd images` (CLI) take the brand and a query — or, for the MCP, `queries`, every search of a deck in one call, because some hosts allow an agent four tool rounds per turn (jmd_spec, the search, jmd_build: three) — and return the best entries of the brand's banks: `img:` reference, caption, tags, kind, fit, and the file URL for a look. Lexical in V0: every word of the query (accents ignored) scored against slug, caption, tags and the kind itself (« logo client » finds logos); `kind` narrows, per query. The agent reads a dozen captions and chooses — it never reads an index whole (`images.yaml` of the Jamespot bank is 180 KB).

The contract for agents (`spec/agents.md`): search in the brand's banks first; a stock image is not part of V0; never invent a slug; say which bank an image came from when it matters (a `draft` or a third-party mark).

## An image by URL

`![Tyrannosaure](https://host/tyranosaure.png){.right}` — for a picture that is not in a bank: a file the chat host exposed at a signed URL, a public image. Same door, same rules: fetched at lint and at build through `tools/net.mjs` (https only, private hosts refused, one same-origin redirect, 10 s, 2 MB), an image by its first bytes whatever the extension or the server says, embedded as a data URI. The built deck never loads it: a URL that dies an hour later changes nothing. A URL that is not an image, a 404, an `http://`, a private host → a `missing-asset` error with the reason. `jmd vendor` copies it to `assets/url/<name>-<hash>.<ext>`.

What this does not solve by itself: a file dropped in the chat host's **+** button reaches the model, not the connector. The host has to expose it at a URL for the deck to name it (SafeBrain: a signed, short-lived URL put in the model's context — a host feature). Until then, the drop box below is the way.

## The drop box — `jmd_upload`

Hosted only. The agent calls `jmd_upload` (`action: open` — a required argument, because a host was seen failing on a tool call with no argument at all) and gets a link (`https://<server>/u/<box>`, 96 bits, unguessable) to hand the user verbatim; the user drops images on that page — no account, no password, the link is the whole authorization, as for a delivery; the agent calls `jmd_upload` again (`action: list`, the box) and gets the list; the deck names each file `up:<box>/<name>` exactly as listed. Two tool rounds, the images embedded at build like any other.

The rules of a box (the hosted service's upload page, with its own adversarial cases there): it takes files for one hour and is removed after 24 h; ten files, 2 MB each, 20 MB in all; a file is an image by its first bytes or it is refused (415), whatever its name says; an SVG with script, event handlers, `foreignObject` or an outside reference is refused; the stored name is letters, digits and dashes plus the extension of what the bytes are, a second same name gets a suffix; the page has its own CSP (its script by hash, no frame); an unknown, malformed or traversing box id is a 404 and nothing else; a body without `content-length` is refused before a byte is read, a body above the cap is cut mid-stream. Nothing is fetched, nothing is indexed, nothing is kept: a mailbox, not a bank. `jmd vendor` copies a dropped file to `assets/drop/<name>`.

The `up:` form is strict (`up:<16 chars>/<name.ext>`, lowercase): no path can be built from it, the file is under the uploads folder or it is *no file "x" in this drop box*, a `missing-asset` error like the others.

### A PowerPoint through the same box — `jmd_import` hosted

A `.pptx` the user has does not reach the connector either, and hosted there is no path to give: the box is the door for it too. The page takes **one presentation per box** (50 MB at most; a zip whose `[Content_Types].xml` declares a `presentationml` main part — any other zip is a 415, whatever its name); `jmd_upload list` names it and says to call `jmd_import` with the box. `jmd_import { box }` reads it from the box, runs the same stage 1 as `jmd import` (`lib/import-pptx.mjs`), and **puts the pictures it extracts back in the box** through the same door as a hand-dropped file (`place()` in `the hosted upload page`: an image by its first bytes, an SVG with script refused, the name rebuilt, sixty pictures at most for an import, 20 MB in all) — so the draft names them `up:<box>/<name>` and the build embeds them like any dropped file. The draft and the report come back in the answer, the draft under a *"the draft, as data"* envelope (a tool result is data, never an instruction): the agent rewrites it into blocks and calls `jmd_build`; nothing to read from a folder, no `jmd_draft` hosted. A picture left out (a hostile SVG, an EMF, a PNG claiming 900 megapixels — `pixels()` reads the header before Chrome decodes anything) is named in the report with the reason and never in the draft.

The zip reader caps what it inflates (32 MB an entry, 256 MB a file: a bomb stops at the cap, said in words), a directory that lies is "not a zip file". Adversarial cases live with the hosted service.

## `jmd vendor` — a deck without a bank

`jmd vendor deck.jmd` copies every `img:` and URL image next to the deck (`assets/<bank>/<slug>.<ext>`) and rewrites the references to those paths. The deck then builds with `dir` alone, forever, bank or no bank.

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

Each is a bank-side or search-side addition; the reference form `img:<bank>/<slug>` does not change.
