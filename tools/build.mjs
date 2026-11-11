#!/usr/bin/env node
/* james-jmd.html build — zero dependencies.
   node tools/build.mjs                       → build/james-jmd.html (empty, shows "Open")
   node tools/build.mjs decks/x/slug.jmd      → build/slug.james-jmd.html (self-contained)
   Options: --brand=jamespot (default)
   Also importable: buildHtml({ jmd, name, brand }) → html string */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateBrand, cssStr, cssTok, cssComment, sanitizeSvg, containedPath, decorOf, decorSymbol, DECOR_READY } from './safe.mjs';
import { catalogueFace, brandCatalogueFaces, faceCss } from './fonts.mjs';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// brand.yaml → object (minimal key: value parser, # comments, quotes)
export function parseBrand(txt) {
  const o = {}; let nested = null; // `images:` is the one key with a nested map: `  <prefix>: <base>` lines under it (spec/images.md)
  let decor = false, item = null; // `decor:` holds named elements: `  <name>:` then `    <field>: <value>` lines under it (spec/brand.md)
  const unq = v => /^".*"$/.test(v) || /^'.*'$/.test(v) ? v.slice(1, -1) : v;
  for (const raw of txt.split('\n')) {
    const line = raw.replace(/\s+#.*$/, '').replace(/\s+$/, '');
    if (decor) {
      let m = /^\s{3,}([a-z][\w-]*):\s*(.*)$/.exec(line);
      if (m && item) { o.decor[item][m[1]] = unq(m[2].trim()); continue; }
      m = /^\s{1,2}([a-z][\w-]*):\s*(.*)$/.exec(line);
      if (m) { item = m[1]; o.decor[item] = m[2].trim() ? { svg: unq(m[2].trim()) } : {}; continue; }
      if (/^\s*$/.test(line)) continue;
      decor = false; item = null;
    }
    if (nested && /^\s+[a-z][a-z0-9-]*:\s*\S/.test(line)) { const m = /^\s+([a-z][a-z0-9-]*):\s*(.*)$/.exec(line); let v = m[2].trim(); if (/^".*"$/.test(v) || /^'.*'$/.test(v)) v = v.slice(1, -1); o[nested][m[1]] = v; continue; }
    nested = null;
    const m = /^([a-z][\w-]*):\s*(.*)$/.exec(line.trim());
    if (!m) continue;
    let v = m[2].trim();
    if (/^".*"$/.test(v) || /^'.*'$/.test(v)) v = v.slice(1, -1);
    if (m[1] === 'images' && v === '') { nested = 'images'; o.images = {}; continue; }
    if (m[1] === 'decor' && v === '') { decor = true; o.decor = {}; continue; }
    o[m[1]] = v;
  }
  return o;
}

export const brandsDir = join(root, 'themes/brands');

/** A brand is `name:` an id from themes/brands, a local .yaml path, or the YAML text itself (multi-line) — the URL form is
    resolved upstream (lib/jmd.mjs resolveBrand, async). Custom brands get defaults for what they leave out: only `primary` is required. */
const ALIASES = { 'jamespot-2026': 'jamespot', 'jamespot-basic': 'jamespot' }; // the two brands merged into `jamespot`: old decks still build
/* The brand a deck gets when it names none. `mono` is the neutral default of this tree; a deployment that has a house brand
   declares it once in the environment (the hosted service sets JMD_DEFAULT_BRAND=jamespot) rather than patching this file. */
export const DEFAULT_BRAND = process.env.JMD_DEFAULT_BRAND || 'mono';

/* Whether a `.yaml` *path* may be a brand. Locally it must: `--brand=./ours.yaml` is the whole point of the flag, and the
   disk belongs to whoever typed the command. Hosted it must not, and it was the one place left where a caller's words still
   reached the server's disk — `dir` has been confined under a scratch folder for the call since spec/security.md §2
   (mcp/tools.mjs withDir), while `brand` went straight to the readFileSync below. What that gave a caller of the connector:
   any .yaml of the server read as a brand, one line of it quoted back verbatim by the shape error that refused it
   (`brand accent: "…" is not a #hex color`, which mcp/tools.mjs hands to the client as is), and — because a file that is
   there fails differently from a file that is not — an oracle for which paths exist. Hosted, the answer is the same
   sentence whether or not the file is there, which is what closes the last of the three. mcp/tools.mjs setHosted flips it. */
let brandPaths = true;
export function setBrandPaths(v) { brandPaths = !!v; }

export function loadBrand(name = DEFAULT_BRAND) {
  if (typeof name === 'object' && name) return name;
  if (/^[\w-]+$/.test(name)) name = name.toLowerCase(); // an id is case-insensitive (`Jamespot-Basic`); a path, a URL or YAML text is not touched
  if (ALIASES[name]) name = ALIASES[name];
  if (/\n/.test(name) || /^[a-z][\w-]*:\s/i.test(name)) return customBrand(parseBrand(name), 'custom');
  if (/\.ya?ml$/.test(name)) {
    if (!brandPaths) throw new Error('brand: a path is not a brand on this server, which has no disk of yours to read — name one of the brands (' + brands().map(b => b.id).join(', ') + '), the https URL of a brand.yaml, or pass the YAML itself');
    if (existsSync(name)) { const b = customBrand(parseBrand(readFileSync(name, 'utf8')), basename(name).replace(/\.ya?ml$/, '')); b.decorDir = dirname(realpathSync(name)); return b; } // a decor .svg beside it is read from there
  }
  const file = join(brandsDir, name + '.yaml');
  if (!existsSync(file)) throw new Error(`unknown brand "${name}": not one of ${brands().map(b => b.id).join(', ')}, nor a .yaml path, URL or YAML text`);
  const b = withDecor(validateBrand(parseBrand(readFileSync(file, 'utf8')), { marks: marks() })); b.id = name; b.decorDir = brandsDir; return b;
}
export const marks = () => readdirSync(join(brandsDir, 'marks')).map(f => f.replace('.svg', '')).sort();

/** Fill a custom brand's blanks — the same look as the neutral brands, in the customer's colors. */
export function customBrand(b, id) {
  if (!b.primary || !/^#[0-9a-f]{3,8}$/i.test(b.primary)) throw new Error('a brand needs at least `primary: "#rrggbb"` — the deep color');
  const d = { accent: b.primary, highlight: '#FFD166', ink: b.primary, 'font-display': 'Helvetica Neue', 'font-body': 'Helvetica Neue', 'font-fallback': '"Segoe UI", system-ui, sans-serif', fonts: 'fonts/system.css', 'type-scale': '0.94', logo: 'dot', glyphs: '4', watermark: 'mark', 'card-marker': 'glyphs', 'card-fill': 'plain', 'card-shadow': 'none', motion: 'soft' };
  if (b.decor !== undefined && b.decor !== '') delete d.watermark; // `decor:` says it all; `watermark:` is its old name (1.49.0)
  for (const k in d) if (b[k] === undefined || b[k] === '') b[k] = d[k];
  validateBrand(b, { marks: marks() }); // every field against its shape (spec/security.md §1): a customer's YAML is the input we invite
  withDecor(b);
  b.id = b.id || id; b.name = b.name || ''; return b;
}

/** The decor, normalized on the brand (1.49.0): `watermark` is what the engine draws (mark | circles | none — the old key's
    values, so a brand that only says `watermark:` keeps its look), `decorItems` the elements the runtime poses. */
export function withDecor(b) {
  if (b.decor === undefined || b.decor === '') { b.decorItems = b.decorItems || []; return b; }
  const d = decorOf(b); b.watermark = d.watermark; b.decorItems = d.items; return b;
}

/** The `<symbol>` of every decor element: a ready one from themes/brands/decor, one fetched with its brand.yaml (resolveBrand,
    `decorSvgs`), or a file beside a local brand.yaml — under that folder's real path, nowhere else. */
export function decorSymbols(b) {
  const out = [], dropped = [];
  for (const it of b.decorItems || []) {
    let svg = b.decorSvgs && b.decorSvgs[it.name];
    if (svg === undefined && DECOR_READY.includes(it.svg)) svg = readFileSync(join(brandsDir, 'decor', it.svg + '.svg'), 'utf8');
    if (svg === undefined && !/^https:/.test(it.svg) && b.decorDir && b.decorDir !== brandsDir) {
      const c = containedPath(b.decorDir, it.svg);
      if (c.refused) throw new Error(`brand decor ${it.name}: ${it.svg}: ${c.refused}`);
      svg = readFileSync(c.path, 'utf8');
    }
    if (svg === undefined) throw new Error(`brand decor ${it.name}: ${it.svg} cannot be read here — a ready element (${DECOR_READY.join(', ')}), an https URL, or an .svg beside a brand.yaml`);
    const r = decorSymbol(it.name, svg, it.place, it.tint); out.push(r.symbol);
    if (r.dropped.length) dropped.push(it.name + ': ' + r.dropped.join(' '));
  }
  decorSymbols.dropped = dropped;
  return out.join('\n');
}

/** The brands shipped in themes/brands: [{ id, name, about, images }], `about` = the file's first comment line, `images` = its bank prefixes. */
export function brands() {
  return readdirSync(brandsDir).filter(f => f.endsWith('.yaml')).sort().map(f => {
    const txt = readFileSync(join(brandsDir, f), 'utf8'), b = parseBrand(txt);
    const about = (txt.split('\n').find(l => l.startsWith('#')) || '').replace(/^#\s*/, '').replace(/^[^—]*—\s*/, '');
    return { id: f.replace('.yaml', ''), name: b.name || '', about, images: Object.keys(b.images || {}) };
  });
}

/** A customer's logo SVG → the brand-mark symbol the runtime expects: parsed and rebuilt from an allowlist (tools/safe.mjs), never copied.
    `markSymbol.dropped` holds what the last call removed, for the warning jmd_brand shows. */
export function markSymbol(svg) {
  const r = sanitizeSvg(svg);
  markSymbol.dropped = r.dropped;
  return r.symbol;
}

/** The files a deck references, resolved under `dir`: { path → data URI } for the ones that are images under the folder's real path,
    `missing` for the rest, and `refused` { path → why }: file not found, outside the deck folder (also through a symlink), not an image. */
export const ASSET_LIMIT = 20 * 1024 * 1024;
export function resolveAssets(jmd, dir) {
  if (!globalThis.JMD) { const code = readFileSync(join(root, 'runtime/jmd-core.js'), 'utf8'); (0, eval)(code); }
  const refs = globalThis.JMD.assets(globalThis.JMD.parse(jmd));
  const assets = {}, missing = [], refused = {};
  let bytes = 0;
  for (const r of refs) {
    if (assets[r.src] || missing.includes(r.src)) continue;
    if (/^(img:|up:|https?:\/\/)/.test(r.src)) continue; // a bank image, a dropped file or an image by URL (spec/images.md): resolved by tools/images.mjs, merged in by the caller — never left live in the deck
    const c = containedPath(dir, r.src);
    if (c.refused) { missing.push(r.src); refused[r.src] = c.refused; continue; }
    bytes += statSync(c.path).size; // the ceiling is checked on sizes, before a byte is read: a 3 GB file is refused, not loaded into memory
    if (bytes > ASSET_LIMIT) throw new Error(`the deck's images weigh more than ${ASSET_LIMIT / 1048576} MB together, the limit — resize them`);
    const buf = readFileSync(c.path);
    assets[r.src] = `data:${c.mime};base64,${buf.toString('base64')}`;
  }
  return { assets, missing, refused, bytes };
}

export function coreVersion() {
  return /VERSION = '([^']+)'/.exec(readFileSync(join(root, 'runtime/jmd-core.js'), 'utf8'))[1];
}

/** Assemble the self-contained page. `jmd` empty → the bare runtime with the Open screen. */
/** The brand a deck asks for in its frontmatter (`brand: name`), if any. */
/** `brand:`, or its synonyms `template:` and `theme:` — users say all three, and all three mean the look. */
export function deckBrand(jmd) {
  const m = /^---\n([\s\S]*?)\n---/.exec(jmd || '');
  if (!m) return null;
  const val = key => { const l = m[1].split('\n').find(l => new RegExp('^' + key + ':\\s*\\S', 'i').test(l)); return l ? l.replace(/^[a-z]+:\s*/i, '').replace(/\s+#.*$/, '').trim() : null; }; // `Brand:` reads as `brand:`
  const v = val('brand') || val('template') || val('theme');
  return v && /^[\w-]+$/.test(v) ? v.toLowerCase() : v; // an id is case-insensitive; a URL is left as written
}

/* ── The page layout a charter decides (#73): what the CSS needs that a brand does not say outright ──
   Only for a brand that asks: a brand without these keys gets the very same :root as before. Every value here is computed from
   validated hex colours and a viewBox read as numbers — never a word of the brand copied into the CSS. */
const rgbOf = h => { let x = String(h).slice(1); if (x.length === 3 || x.length === 4) x = x.slice(0, 3).replace(/./g, c => c + c); return [0, 2, 4].map(i => parseInt(x.substr(i, 2), 16)); };
const lum = rgb => rgb.reduce((s, v, i) => { v /= 255; return s + [0.2126, 0.7152, 0.0722][i] * (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)); }, 0);
/** The WCAG contrast ratio of two #hex colours. */
export const contrast = (a, b) => { const [x, y] = [lum(rgbOf(a)), lum(rgbOf(b))].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const toHex = rgb => '#' + rgb.map(v => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();
/** `table-head: light`: the header in a light tint of the deep colour, its words in the brand's ink when they read on it (4.5:1),
    else in black. The tint is a quarter of the deep colour on white — a ministry's #B8CCE4 is about that of its navy. */
export function tableHead(b) {
  const p = rgbOf(/^#[0-9a-f]{3,8}$/i.test(b.primary || '') ? b.primary : '#000000');
  const bg = toHex(p.map(v => 255 + (v - 255) * 0.28));
  const ink = /^#[0-9a-f]{3,8}$/i.test(b.ink || '') && contrast(b.ink, bg) >= 4.5 ? toHex(rgbOf(b.ink)) : '#000000';
  return { bg, ink, ratio: contrast(ink, bg) };
}
/** `chrome-label: body`: the section's name, top right, at 4.5:1 on every page it can sit on. Light pages (white, the wash, lavender
    and butter tints, the highlight of `fun`, and the secondary when white cannot be read on it): the brand's ink when it reads on
    all of them, else black. Dark pages (the deep colour, the accent, the secondary): white when it reads there, else black.
    The tints are the engine's own color-mix (engine.css :root), or the brand's pinned backgrounds. */
export function chromeLabel(b) {
  const hex = k => /^#[0-9a-f]{3,8}$/i.test(b[k] || '') ? toHex(rgbOf(b[k])) : null;
  const mix = (c, t) => toHex(rgbOf(c).map(v => 255 + (v - 255) * t));
  const primary = hex('primary') || '#000000', accent = hex('accent') || primary, highlight = hex('highlight') || '#FFD166', secondary = hex('secondary') || accent;
  const skyDark = contrast('#FFFFFF', secondary) >= 4.5;
  const light = ['#FFFFFF', hex('bg-wash') || mix(accent, 0.08), hex('bg-lavender') || mix(accent, 0.13), hex('bg-butter') || mix(highlight, 0.30), highlight].concat(skyDark ? [] : [secondary]);
  const ink = hex('ink') && light.every(bg => contrast(b.ink, bg) >= 4.5) ? hex('ink') : '#000000';
  const on = bg => contrast('#FFFFFF', bg) >= 4.5 ? '#FFFFFF' : '#000000';
  return { ink, primary: on(primary), accent: on(accent), secondary: skyDark ? '#FFFFFF' : ink, light, ratios: { light: Math.min(...light.map(bg => contrast(ink, bg))), primary: contrast(on(primary), primary), accent: contrast(on(accent), accent), secondary: skyDark ? contrast('#FFFFFF', secondary) : Math.min(...light.map(bg => contrast(ink, bg))) } };
}
/** The logo's width over its height, from the brand-mark symbol's viewBox (1 when there is none to read). */
export function logoRatio(mark) {
  const sym = /<symbol\b[^>]*\bid="brand-mark"[^>]*>/.exec(String(mark)) || [''];
  const vb = /\bviewBox="\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*"/.exec(sym[0]);
  const r = vb && +vb[2] > 0 ? +vb[1] / +vb[2] : 1;
  return Math.min(8, Math.max(0.25, Math.round(r * 1000) / 1000 || 1));
}
function layoutCss(b, mark) {
  let css = '';
  if (b['table-head'] === 'light') { const t = tableHead(b); css += `  --brand-thead-bg:${cssTok(t.bg)};\n  --brand-thead-ink:${cssTok(t.ink)};\n`; }
  if (b['chrome-label'] === 'body') { const l = chromeLabel(b); css += `  --brand-label-ink:${cssTok(l.ink)};\n  --brand-label-on-primary:${cssTok(l.primary)};\n  --brand-label-on-accent:${cssTok(l.accent)};\n  --brand-label-on-secondary:${cssTok(l.secondary)};\n`; }
  if (b['cover-logo'] === 'large') css += `  --brand-logo-ratio:${cssTok(String(logoRatio(mark)))};\n`;
  return css;
}

/** `brand`: explicit name or object; omitted/null → the deck's frontmatter brand, else DEFAULT_BRAND (`mono`, or what JMD_DEFAULT_BRAND says).
    `edit`: the shared edit page (spec/espace.md §3) — the same runtime plus the room layer (runtime/vendor/collab.js: Yjs and the
    Hocuspocus provider, runtime/collab.js: the bridge), still one script, its own hash in the CSP; never in a delivered deck. */
export function buildHtml({ jmd = '', name = '', brand = null, dir = null, assets = null, edit = false } = {}) {
  const b = loadBrand(brand || deckBrand(jmd) || DEFAULT_BRAND);
  if (!b.markSvg && b.logo && !marks().includes(b.logo)) throw new Error(`brand logo "${b.logo}": an SVG logo is fetched next to a brand.yaml URL only; otherwise one of the marks (${marks().join(', ')})`);
  const mark = b.markSvg || readFileSync(join(root, 'themes/brands/marks', (b.logo || 'dot') + '.svg'), 'utf8');
  // every brand value was validated by shape (loadBrand); it is escaped here anyway — a value that cannot close a string, a rule or the <style>
  const optional = (css, key) => b[key] ? `  ${css}:${cssTok(b[key])};\n` : '';
  const family = k => (catalogueFace(b[k]) || {}).family || b[k]; // a catalogue face as the catalogue spells it, whatever the case it was written in
  const brandCss = `:root{
  --brand-primary:${cssTok(b.primary)};
  --brand-accent:${cssTok(b.accent)};
  --brand-highlight:${cssTok(b.highlight)};
  --brand-ink:${cssTok(b.ink)};
  --brand-secondary:${cssTok(b.secondary || b.accent)};
  --brand-font-display:"${cssStr(family('font-display'))}";
  --brand-font-body:"${cssStr(family('font-body'))}";
  --brand-font-fallback:${cssTok(b['font-fallback'] || 'system-ui')};
  --type-scale:${cssTok(b["type-scale"] || 1)};
  --brand-type-scale:${cssTok(b["type-scale"] || 1)};
${optional('--brand-bg-lavender', 'bg-lavender')}${optional('--brand-bg-wash', 'bg-wash')}${optional('--brand-bg-butter', 'bg-butter')}${optional('--brand-card', 'card')}${layoutCss(b, mark)}}`;
  // brand fonts: the brand names a CSS file of @font-face data URIs under themes/brands/fonts — nowhere else on the disk;
  // a brand's fonts: a file of themes/brands/fonts (never outside it), or the CSS fetched next to a brand.yaml URL and rebuilt by fontFaces().
  // Missing is an error, not a silent fallback: a deck built in the wrong face is a deck nobody asked for.
  let fontsCss;
  if (b.fontsCss) fontsCss = b.fontsCss;
  else {
    const fontsDir = join(root, 'themes/brands/fonts'), fontsPath = join(root, 'themes/brands', b.fonts || 'fonts/system.css');
    try { if (!realpathSync(fontsPath).startsWith(realpathSync(fontsDir) + sep)) throw new Error('outside'); fontsCss = readFileSync(fontsPath, 'utf8'); }
    catch { throw new Error(`brand fonts ${JSON.stringify(b.fonts)}: not a file of themes/brands/fonts — a licensed font that cannot ship with the brand is not a JMD font; pick a free face and pack it with tools/fontpack.py`); }
  }
  // a face of the catalogue (#83) the brand names travels with the deck, from the disk — that face and no other (tools/fonts.mjs)
  const named = brandCatalogueFaces(b, fontsCss);
  if (named.length) fontsCss = fontsCss.trim() + '\n' + named.map(faceCss).join('\n');
  const decor = decorSymbols(withDecor(b)); // the brand's own elements, each a symbol beside the mark
  const core = readFileSync(join(root, 'runtime/jmd-core.js'), 'utf8');
  const runtime = core + '\n' + readFileSync(join(root, 'runtime/james-jmd.js'), 'utf8')
    + (edit ? '\n' + readFileSync(join(root, 'runtime/vendor/collab.js'), 'utf8') + '\n' + readFileSync(join(root, 'runtime/collab.js'), 'utf8') : '');
  const version = /VERSION = '([^']+)'/.exec(core)[1], format = /FORMAT_MAX = (\d+)/.exec(core)[1];
  const safeJmd = jmd.replace(/<\/script/gi, '<\\/script');
  const assetMap = { ...(dir ? resolveAssets(jmd, dir).assets : {}), ...(assets || {}) }; // local files, then the bank images resolved upstream
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  // the runtime script is the one script the page may run: its hash goes in the CSP, so anything else that ever lands in the file stays inert
  const runtimeBody = '\n' + runtime.trim() + '\n'; // exactly what sits between <script> and </script> in the template
  const csp = contentSecurityPolicy(createHash('sha256').update(runtimeBody).digest('base64'));

  return readFileSync(join(root, 'runtime/index.html'), 'utf8')
    .replace('@@RUNTIME_VERSION@@', version)
    .replace('@@FORMAT@@', format)
    .replace('@@BUILD_DATE@@', new Date().toISOString().slice(0, 16).replace('T', ' '))
    .replace('@@CSP@@', () => csp)
    .replace('@@FONTS@@', () => fontsCss.trim())
    .replace('@@BRAND_NAME@@', () => cssComment(b.name))
    .replace('@@BRAND_CSS@@', () => brandCss)
    .replace('@@ENGINE@@', () => readFileSync(join(root, 'themes/engine/engine.css'), 'utf8').trim())
    .replace('@@BRAND_MARK@@', () => mark.trim() + (decor ? '\n' + decor : ''))
    .replace('@@BRAND_JSON@@', () => JSON.stringify({ ...b, decor: undefined, decorSvgs: undefined, decorDir: undefined, decorUrls: undefined, decorDropped: undefined, markSvg: undefined, logoDropped: undefined, fontsCss: undefined, fontsDropped: undefined, fontsUrl: undefined, logoUrl: undefined }).replace(/</g, '\\u003c'))
    .replace('@@ASSETS_JSON@@', () => JSON.stringify(assetMap).replace(/</g, '\\u003c'))
    .replace('@@JMD_NAME@@', () => esc(name))
    .replace('@@JMD@@', () => safeJmd) // exact bytes: the runtime strips only the newline on each side
    .replace('@@RUNTIME@@', () => runtime.trim());
}

/** The policy baked into every built file (a <meta>) and sent as a header on /d/… — spec/security.md §1.
    One script, ours, by hash; styles inline (the theme); images and fonts embedded (an https image is fetched and embedded at build; `img-src https:` stays for a deck built with force, whose refused image is then a live URL);
    connect 'self' for the runtime's ?src= sibling load over http; nothing else. `frame-ancestors` only works as a header: the server adds it. */
export const contentSecurityPolicy = hash =>
  `default-src 'none'; script-src 'sha256-${hash}'; style-src 'unsafe-inline'; img-src data: https:; font-src data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'`;

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const jmdPath = args.find(a => !a.startsWith('--'));
  const brandArg = args.find(a => a.startsWith('--brand='));
const brand = brandArg ? brandArg.split('=')[1] : null;
  const html = buildHtml({ jmd: jmdPath ? readFileSync(jmdPath, 'utf8') : '', name: jmdPath ? basename(jmdPath) : '', brand, dir: jmdPath ? dirname(jmdPath) : null });
  mkdirSync(join(root, 'build'), { recursive: true });
  const out = join(root, 'build', jmdPath ? basename(jmdPath).replace(/\.jmd$/, '') + '.james-jmd.html' : 'james-jmd.html');
  writeFileSync(out, html);
  console.log(`${out}  ${(html.length / 1024).toFixed(0)} KB  brand=${brand || deckBrand(jmdPath ? readFileSync(jmdPath, 'utf8') : '') || DEFAULT_BRAND}  runtime=${coreVersion()}`);
}
