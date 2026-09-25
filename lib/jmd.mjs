/* jmd service layer — the one implementation behind the CLI, the MCP server and (V3) the platform endpoint.
   lint(): static rules, pure Node.   lintDom(): + overflow measured in headless Chrome.
   build(): self-contained html.      pdf(): PDF buffer.      render(): one PNG per slide.      cover(): the first screen. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { buildHtml, resolveAssets, root, coreVersion, loadBrand, customBrand, parseBrand, deckBrand, markSymbol, brands, DEFAULT_BRAND } from '../tools/build.mjs';
import { fontFaces } from '../tools/safe.mjs';
import { banks, resolveImages, searchImages, vendor as vendorImages } from '../tools/images.mjs';
import { fetchAt, requestOnce, assertPublicHost, isPrivateAddress } from '../tools/net.mjs';
import { Browser } from '../tools/cdp.mjs';

await import('../runtime/jmd-core.js'); // defines globalThis.JMD
const JMD = globalThis.JMD;

export const VERSION = coreVersion();
export { brands };

/** Resolve what a caller means by `brand` into a brand object: an id (themes/brands), a local .yaml path, the YAML text itself,
    or an https URL of a brand.yaml (whose `logo:` may be an SVG URL, absolute or relative to it). null → the deck's frontmatter
    `brand:`, resolved the same way, else jamespot. Fetches are https-only, 200 KB, 10 s. */
export async function resolveBrand(spec, jmd = '') {
  spec = spec || deckBrand(jmd) || DEFAULT_BRAND;
  if (typeof spec === 'object') return spec;
  let b;
  const isUrl = u => typeof u === 'string' && (/^https:\/\//.test(u) || (process.env.JMD_BRAND_HTTP && /^http:\/\//.test(u))); // http only for tests
  let base = null; // the brand file's final URL (after its one allowed redirect): what a relative `logo:` or `fonts:` resolves against
  if (isUrl(spec)) { const got = await fetchAt(spec, 200_000); base = got.url; b = customBrand(parseBrand(got.text), spec); }
  else if (/^https?:\/\//.test(spec)) throw new Error('brand URL: https only');
  else b = loadBrand(spec);
  if (b.logo && (/^https?:/.test(b.logo) || (/\.svg$/.test(b.logo) && base))) {
    const url = new URL(b.logo, base || undefined).href;
    if (!isUrl(url)) throw new Error('brand logo: https URLs only');
    b.markSvg = markSymbol(await fetchText(url, 500_000)); b.logo = 'custom'; b.logoUrl = url; // remembered so jmd_brand's YAML round-trips (logo: <url>)
    if (markSymbol.dropped.length) b.logoDropped = markSymbol.dropped; // what the sanitizer removed from the logo (scripts, handlers, external refs, unknown elements)
  }
  // `fonts:` next to a brand.yaml URL (or an https URL): fetched, rebuilt from an allowlist (@font-face with data URIs only), embedded
  if (b.fonts && b.fonts !== 'custom' && (/^https?:/.test(b.fonts) || base)) {
    const url = new URL(b.fonts, base || undefined).href; // relative to the brand file's final URL, like the logo
    b.fontsUrl = url; // remembered so jmd_brand's YAML round-trips (fonts: <url>)
    if (!isUrl(url)) throw new Error('brand fonts: https URLs only');
    let css; try { css = await fetchText(url, 4_000_000); } catch (e) { throw new Error(`brand fonts ${url}: ${e.message.replace(url + ': ', '')} — a fonts CSS (@font-face rules with woff2 data URIs) is expected next to the brand.yaml`); }
    b.fontsCss = fontFaces(css); b.fonts = 'custom';
    if (!b.fontsCss) throw new Error(`brand fonts ${url}: no usable @font-face (a fonts CSS is @font-face rules with woff2 data URIs, as tools/fontpack.py writes them)`);
    if (fontFaces.dropped.length) b.fontsDropped = fontFaces.dropped;
  }
  b.banks = banks(b, base); // { prefix → https folder }: what `img:` references resolve against (spec/images.md)
  return b;
}
/** The network door is tools/net.mjs (spec/security.md §3): the guard, the pinned connection, one same-origin redirect, a capped body. */
const fetchText = async (url, max) => (await fetchAt(url, max)).text;
export { requestOnce, assertPublicHost, isPrivateAddress };
export const FORMAT = 'jmd/' + JMD.FORMAT_MAX;

/** Ceilings, checked before anything touches the disk or the browser (spec/security.md §3): a 5 000-slide deck is a memory bomb on an XS instance. */
export const LIMITS = { slides: 200, sourceBytes: 2 * 1024 * 1024, assetBytes: 20 * 1024 * 1024 };
export function guard(jmd) {
  const bytes = Buffer.byteLength(jmd || '');
  if (bytes > LIMITS.sourceBytes) throw new Error(`source is ${(bytes / 1048576).toFixed(1)} MB, the limit is ${LIMITS.sourceBytes / 1048576} MB`);
  const n = (jmd.match(/^---\s*$/gm) || []).length; // an upper bound on the slide count, before parsing
  if (n > LIMITS.slides * 2 + 2 || JMD.parse(jmd).slides.length > LIMITS.slides) throw new Error(`more than ${LIMITS.slides} slides, the limit — split the deck`);
}

/** Static lint, no browser. `dir`: where the deck's files live (default: no file check).
    Returns { ok, errors, warnings, findings, slides }. */
export function lint(jmd, { dir = null, images = null } = {}) {
  guard(jmd);
  const doc = JMD.parse(jmd);
  const local = dir ? pick(resolveAssets(jmd, dir), 'assets', 'refused') : { assets: {}, refused: {} };
  // bank and URL images (spec/images.md): resolved upstream by bankImages(); a refused one is an error whether or not the disk is known
  const ctx = dir || images ? { assets: { ...local.assets, ...(images?.assets || {}) }, refused: { ...local.refused, ...(images?.refused || {}) }, assetsAuthoritative: !!dir } : null;
  const findings = JMD.lint(doc, ctx);
  for (const w of images?.warnings || []) { const ref = JMD.assets(doc).find(a => a.src === w.ref); findings.push({ slide: ref ? ref.slide : 1, block: null, rule: 'image-draft', level: 'warning', message: w.message }); }
  return shape(findings, doc);
}
/** The brand's banks for a deck: `brand` an object from resolveBrand, or an id / YAML resolved locally (https banks only then). */
function banksOf(jmd, brand) {
  if (brand && typeof brand === 'object') return brand.banks || banks(brand);
  return banks(loadBrand(brand || deckBrand(jmd) || DEFAULT_BRAND));
}
/** Every `img:` reference of the deck fetched from the brand's banks, every `https://` image fetched from where it is, every `up:` file read from its drop box (spec/images.md):
    { assets, refused, warnings } — null when the deck names neither. */
export async function bankImages(jmd, brand) {
  const refs = JMD.assets(JMD.parse(jmd)).filter(r => /^(img:|up:|https?:\/\/)/.test(r.src));
  if (!refs.length) return null;
  return resolveImages(refs, banksOf(jmd, brand));
}
/** Search the brand's banks — what an agent reads before pinning a slug (spec/images.md). */
export async function imageSearch(brand, query, opts) { return searchImages(banksOf('', brand), query, opts); }
/** `jmd vendor`: the deck's bank images copied next to it, the source rewritten to those paths. */
export async function vendor(jmd, brand, dir) { return vendorImages(jmd, JMD.assets(JMD.parse(jmd)), banksOf(jmd, brand), dir); }
const pick = (o, ...keys) => Object.fromEntries(keys.map(k => [k, o[k]]));
function shape(findings, doc) {
  const errors = findings.filter(f => f.level === 'error'), warnings = findings.filter(f => f.level === 'warning');
  return { ok: errors.length === 0, errors: errors.length, warnings: warnings.length, slides: doc.slides.length, findings };
}

/** One shared headless Chrome, launched on first use, closed after 60 s idle — launching costs ~1 s per call otherwise. */
let shared = null, idleTimer = null;
async function browser() {
  if (!shared) shared = await Browser.launch();
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { try { shared?.close(); } catch { } shared = null; }, 60_000);
  idleTimer.unref?.();
  return shared;
}
export function closeBrowser() { clearTimeout(idleTimer); try { shared?.close(); } catch { } shared = null; }

/** Open a self-contained build in a fresh tab and hand the page to `fn`; always cleans up. */
async function withPage(jmd, { brand = null, name = 'deck.jmd', dir: assetDir = null, images = undefined } = {}, fn) {
  guard(jmd);
  if (images === undefined) images = await bankImages(jmd, brand);
  const dir = mkdtempSync(join(tmpdir(), 'jmd-'));
  const file = join(dir, 'deck.james-jmd.html');
  writeFileSync(file, buildHtml({ jmd, name, brand, dir: assetDir, assets: images?.assets }));
  let page;
  try {
    page = await (await browser()).page('file://' + file, { network: false }); // the render page has no network (spec/security.md §3)
    await page.settle(250);
    return await fn(page);
  } catch (e) {
    if (shared && /ECONNREFUSED|fetch failed|closed/i.test(String(e))) { closeBrowser(); } // a dead browser: next call relaunches
    throw e;
  } finally { try { await page?.close(); } catch { } rmSync(dir, { recursive: true, force: true }); }
}

/** Full lint: static rules plus overflow measured in the DOM (what the runtime itself reports). */
export async function lintDom(jmd, opts = {}) {
  guard(jmd);
  const images = await bankImages(jmd, opts.brand);
  const stat = lint(jmd, { dir: opts.dir || null, images });
  return withPage(jmd, { ...opts, images }, async page => {
    // static rules from Node (they know the disk), overflow and fit (a slide shown smaller so that it fits) from the DOM
    const dom = JSON.parse(await page.eval('JSON.stringify(jamesJmd.state.lint)')).filter(f => f.rule === 'overflow' || f.rule === 'fit');
    return shape(stat.findings.concat(dom), { slides: Array(stat.slides) });
  });
}

/** Self-contained html string. */
export async function build(jmd, { brand = null, name = 'deck.jmd', dir = null, edit = false } = {}) {
  guard(jmd);
  const images = await bankImages(jmd, brand);
  return buildHtml({ jmd, name, brand, dir, edit, assets: images?.assets });
}

/** The deck's layout — spec/jmd.md: 'slide' (16:9 screens), 'doc' (A4 portrait pages), 'story' (9:16 screens), 'webpage' (one continuous page). */
export function layout(jmd) { return JMD.layout(JMD.parse(jmd)); }
export function parse(jmd) { return JMD.parse(jmd); } // the runtime's parser: slides with their line ranges (`map`), the front matter
/** The page of a layout in CSS px on screen, from the runtime's table: Slide 1280×720, Doc 794×1122 (A4 at 96 dpi), Story 1080×1920, Webpage 1280 × as tall as its content (height 0). */
export function pageSize(lay) { const p = JMD.PAGES[lay] || JMD.PAGES.slide; return { width: Math.round(p.w * p.zoom), height: Math.round(p.h * p.zoom), flow: p.flow }; }

/** PDF buffer, same as the runtime's P key: Slide 1280×720 px pages (960×540 pt), Doc A4 portrait pages, Story 1080×1920 px pages, Webpage flowed onto A4. */
export async function pdf(jmd, opts) {
  return withPage(jmd, opts, page => page.pdf());
}

/** One PNG buffer per slide (the page size × scale: 1280×720 for Slide, 794×1122 for Doc, 1080×1920 for Story, 1280 × its own height for a Webpage section), chrome (HUD, counter, panels) hidden.
    `slides`: 1-based numbers to capture (default all).
    `sheet: true`: a single PNG contact sheet instead — every slide in a grid of `columns` (default 3), each `scale`-sized. */
export async function render(jmd, { scale = 1, slides, sheet = false, columns = 3, ...opts } = {}) {
  const lay = layout(jmd), pg = pageSize(lay), doc = pg.flow === 'scroll';
  return withPage(jmd, opts, async page => {
    // scroll layouts (Doc, Webpage): the viewport is wider than the page so it renders at full size, and each page is clipped out of the scroll;
    // a Webpage section is as tall as its content, so the viewport takes the tallest one
    let tallest = pg.height;
    if (!tallest) { // measured at full width (the runtime shrinks the pages to a narrow window)
      await page.send('Emulation.setDeviceMetricsOverride', { width: pg.width + 48, height: 1200, deviceScaleFactor: scale, mobile: false });
      await page.eval('window.dispatchEvent(new Event("resize")); true'); await page.settle(60);
      tallest = Math.min(8000, Math.ceil(await page.eval('Math.max(720, ...jamesJmd.state.slides.map(s => s.getBoundingClientRect().height))'))); // no slide at all: a viewport, never -Infinity
    }
    await page.send('Emulation.setDeviceMetricsOverride', { width: pg.width + (doc ? 48 : 0), height: tallest + (doc ? 48 : 0), deviceScaleFactor: scale, mobile: false });
    await page.eval(`['hud','counter','notes','info','open'].forEach(id => document.getElementById(id).style.display = 'none');
      const st = document.createElement('style'); st.textContent = '.slide,.slide *{transition:none!important;animation:none!important}'; document.head.appendChild(st); jamesJmd.motion && jamesJmd.motion('none');
      jamesJmd.state.notesOpen = false; window.dispatchEvent(new Event('resize')); true`);
    await page.settle(100);
    const n = await page.eval('jamesJmd.state.slides.length');
    const wanted = (slides && slides.length ? slides : Array.from({ length: n }, (_, i) => i + 1)).filter(i => i >= 1 && i <= n);
    const shots = [];
    for (const i of wanted) {
      await page.eval(`jamesJmd.show(${i - 1}); true`);
      await page.settle(60);
      const clip = doc ? JSON.parse(await page.eval(`(r => JSON.stringify({ x: r.left, y: r.top, width: r.width, height: r.height }))(jamesJmd.state.slides[${i - 1}].getBoundingClientRect())`)) : null;
      shots.push(await page.screenshot(clip));
    }
    if (!sheet) return shots;
    // stitch in-page with a canvas: no image library needed; the cell is the largest shot (a Webpage's sections differ in height)
    const gap = Math.round(12 * scale) || 4;
    const dataUrl = await page.eval(`(async () => {
      const srcs = ${JSON.stringify(shots.map(b => 'data:image/png;base64,' + b.toString('base64')))};
      const labels = ${JSON.stringify(wanted)};
      const imgs = []; for (const s of srcs) { const img = new Image(); img.src = s; await img.decode(); imgs.push(img); }
      const cols = ${columns}, gap = ${gap}, rows = Math.ceil(srcs.length / cols);
      const w = Math.max(1, ...imgs.map(i => i.width)), h = Math.max(1, ...imgs.map(i => i.height)); // no slide at all: a 1×1 sheet, never a 0×0 canvas
      const c = document.createElement('canvas'); c.width = cols * w + (cols + 1) * gap; c.height = rows * h + (rows + 1) * gap;
      const g = c.getContext('2d'); g.fillStyle = '#2a2a3a'; g.fillRect(0, 0, c.width, c.height);
      for (let k = 0; k < srcs.length; k++) {
        const img = imgs[k];
        const x = gap + (k % cols) * (w + gap), y = gap + Math.floor(k / cols) * (h + gap);
        g.drawImage(img, x, y);
        g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(x, y, ${Math.round(34 * scale) + 8}, ${Math.round(16 * scale) + 6});
        g.fillStyle = '#fff'; g.font = 'bold ' + ${Math.max(10, Math.round(12 * scale))} + 'px system-ui'; g.fillText(String(labels[k]), x + 4, y + ${Math.round(12 * scale) + 3});
      }
      return c.toDataURL('image/png');
    })()`);
    return Buffer.from(dataUrl.split(',')[1], 'base64');
  });
}

/** Ceiling on a cover: a card on a list page, never a payload. A PNG is a poor photo codec — a full-bleed photo
    on the first screen can weigh several megabytes at 1280×720 — and this one is written to the deck's folder at every
    save and served to every visitor of that page. */
export const COVER_MAX = 2 * 1024 * 1024;
/** The deck's cover: its FIRST screen as a PNG at the layout's own size (Slide 1280×720, Doc A4, Story 1080×1920,
    a Webpage its first section), through the same render() as everything else — chrome hidden, no network in the page.
    Over `max`, it is rendered once more at half the size rather than dropped: a deck of photographs is exactly the deck
    whose cover is worth showing. Returns null when there is nothing to show (a deck with no slide — front matter alone)
    or when even the half-size shot is too heavy; throws only what the render itself throws. */
export async function cover(jmd, { max = COVER_MAX, ...opts } = {}) {
  guard(jmd); // the ceilings first, as everywhere else: nothing is parsed or drawn for a source over them
  if (!parse(jmd).slides.length) return null; // no first screen: not even a browser is launched for it
  for (const scale of [1, 0.5]) {
    const [png] = await render(jmd, { ...opts, slides: [1], scale });
    if (!png) return null;
    if (png.length <= max) return png;
  }
  return null;
}

/* Exporting the screens as images (spec/export.md). A Story goes to Instagram and TikTok, which take images and not a PDF;
   a Slide goes into a post or a mail as one picture. The size is the layout's own, not a number someone picks: a Story page
   is already 1080×1920 (640 × 1138 × 1.687), so it leaves at scale 1, exactly what Instagram wants; a Slide and a Doc page
   leave at twice their CSS size, sharp on a retina screen and in print; a Webpage section stays at 1, because a section can
   be eight thousand pixels tall and twice that is a picture nobody can open. */
export const PNG_SCALE = { slide: 2, doc: 2, story: 1, webpage: 1 };
/** Ceilings on one export: sixty screens (a 200-screen deck is a book, and each screen is a browser shot), and what the set
    may weigh all together — a zip of photographs is a download, never a surprise. */
export const PNG_SCREENS_MAX = 60, PNG_SET_MAX = 60 * 1024 * 1024;

/** One PNG per screen at the layout's own size, in the deck's order: [{ n, png }]. `slides` picks some (1-based) — the Slide
    case, one image to paste somewhere. Refuses a screen the deck does not have, and refuses by count and by weight before
    handing back anything. Throws what render() throws; the caller lints first, as the PDF does — an overflow shows on a
    picture and cannot be fixed after the fact. */
export async function images(jmd, { slides, scale, ...opts } = {}) {
  guard(jmd);
  const lay = layout(jmd), count = parse(jmd).slides.length;
  if (!count) throw Object.assign(new Error('this deck has no screen to export'), { code: 'JMD_NO_SCREEN' });
  const want = slides && slides.length ? slides.map(Number) : Array.from({ length: count }, (_, i) => i + 1);
  const missing = [...new Set(want.filter(n => !Number.isInteger(n) || n < 1 || n > count))];
  if (missing.length) throw Object.assign(new Error(`no screen ${missing.join(', ')} in this deck: it has ${count}`), { code: 'JMD_NO_SCREEN' });
  if (want.length > PNG_SCREENS_MAX) throw Object.assign(new Error(`${want.length} screens is more than one export carries (${PNG_SCREENS_MAX} at most): ask for the screens you need with slides`), { code: 'JMD_TOO_MANY' });
  const pngs = await render(jmd, { ...opts, slides: want, scale: scale || PNG_SCALE[lay] || 1 });
  const total = pngs.reduce((n, p) => n + (p ? p.length : 0), 0);
  if (total > PNG_SET_MAX) throw Object.assign(new Error(`the images weigh ${Math.round(total / 1048576)} MB together, more than one export carries (${PNG_SET_MAX >> 20} MB): ask for fewer screens`), { code: 'JMD_TOO_HEAVY' });
  return want.map((n, i) => ({ n, png: pngs[i] })).filter(x => x.png);
}

/** The contract and the grammar, for agents. */
export function spec(name = 'agents') {
  return readFileSync(join(root, 'spec', name + '.md'), 'utf8');
}
