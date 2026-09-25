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
import { validateBrand, cssStr, cssTok, cssComment, sanitizeSvg, containedPath } from './safe.mjs';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// brand.yaml → object (minimal key: value parser, # comments, quotes)
export function parseBrand(txt) {
  const o = {}; let nested = null; // `images:` is the one key with a nested map: `  <prefix>: <base>` lines under it (spec/images.md)
  for (const raw of txt.split('\n')) {
    const line = raw.replace(/\s+#.*$/, '').replace(/\s+$/, '');
    if (nested && /^\s+[a-z][a-z0-9-]*:\s*\S/.test(line)) { const m = /^\s+([a-z][a-z0-9-]*):\s*(.*)$/.exec(line); let v = m[2].trim(); if (/^".*"$/.test(v) || /^'.*'$/.test(v)) v = v.slice(1, -1); o[nested][m[1]] = v; continue; }
    nested = null;
    const m = /^([a-z][\w-]*):\s*(.*)$/.exec(line.trim());
    if (!m) continue;
    let v = m[2].trim();
    if (/^".*"$/.test(v) || /^'.*'$/.test(v)) v = v.slice(1, -1);
    if (m[1] === 'images' && v === '') { nested = 'images'; o.images = {}; continue; }
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
export function loadBrand(name = DEFAULT_BRAND) {
  if (typeof name === 'object' && name) return name;
  if (/^[\w-]+$/.test(name)) name = name.toLowerCase(); // an id is case-insensitive (`Jamespot-Basic`); a path, a URL or YAML text is not touched
  if (ALIASES[name]) name = ALIASES[name];
  if (/\n/.test(name) || /^[a-z][\w-]*:\s/i.test(name)) return customBrand(parseBrand(name), 'custom');
  if (/\.ya?ml$/.test(name) && existsSync(name)) return customBrand(parseBrand(readFileSync(name, 'utf8')), basename(name).replace(/\.ya?ml$/, ''));
  const file = join(brandsDir, name + '.yaml');
  if (!existsSync(file)) throw new Error(`unknown brand "${name}": not one of ${brands().map(b => b.id).join(', ')}, nor a .yaml path, URL or YAML text`);
  const b = validateBrand(parseBrand(readFileSync(file, 'utf8')), { marks: marks() }); b.id = name; return b;
}
export const marks = () => readdirSync(join(brandsDir, 'marks')).map(f => f.replace('.svg', '')).sort();

/** Fill a custom brand's blanks — the same look as the neutral brands, in the customer's colors. */
export function customBrand(b, id) {
  if (!b.primary || !/^#[0-9a-f]{3,8}$/i.test(b.primary)) throw new Error('a brand needs at least `primary: "#rrggbb"` — the deep color');
  const d = { accent: b.primary, highlight: '#FFD166', ink: b.primary, 'font-display': 'Helvetica Neue', 'font-body': 'Helvetica Neue', 'font-fallback': '"Segoe UI", system-ui, sans-serif', fonts: 'fonts/system.css', 'type-scale': '0.94', logo: 'dot', glyphs: '4', watermark: 'mark', 'card-marker': 'glyphs', 'card-fill': 'plain', 'card-shadow': 'none', motion: 'soft' };
  for (const k in d) if (b[k] === undefined || b[k] === '') b[k] = d[k];
  validateBrand(b, { marks: marks() }); // every field against its shape (spec/security.md §1): a customer's YAML is the input we invite
  b.id = b.id || id; b.name = b.name || ''; return b;
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
/** `brand:`, or its synonyms `template:` and — when it does not name a layout engine — `theme:` (users say all three). */
export const ENGINES = ['jamespot', 'keynote', 'document'];
export function deckBrand(jmd) {
  const m = /^---\n([\s\S]*?)\n---/.exec(jmd || '');
  if (!m) return null;
  const val = key => { const l = m[1].split('\n').find(l => new RegExp('^' + key + ':\\s*\\S', 'i').test(l)); return l ? l.replace(/^[a-z]+:\s*/i, '').replace(/\s+#.*$/, '').trim() : null; }; // `Brand:` reads as `brand:`
  const theme = val('theme'), v = val('brand') || val('template') || (theme && !ENGINES.includes(theme) ? theme : null);
  return v && /^[\w-]+$/.test(v) ? v.toLowerCase() : v; // an id is case-insensitive; a URL is left as written
}

/** `brand`: explicit name or object; omitted/null → the deck's frontmatter brand, else jamespot.
    `edit`: the shared edit page (spec/espace.md §3) — the same runtime plus the room layer (runtime/vendor/collab.js: Yjs and the
    Hocuspocus provider, runtime/collab.js: the bridge), still one script, its own hash in the CSP; never in a delivered deck. */
export function buildHtml({ jmd = '', name = '', brand = null, dir = null, assets = null, edit = false } = {}) {
  const b = loadBrand(brand || deckBrand(jmd) || DEFAULT_BRAND);
  // every brand value was validated by shape (loadBrand); it is escaped here anyway — a value that cannot close a string, a rule or the <style>
  const optional = (css, key) => b[key] ? `  ${css}:${cssTok(b[key])};\n` : '';
  const brandCss = `:root{
  --brand-primary:${cssTok(b.primary)};
  --brand-accent:${cssTok(b.accent)};
  --brand-highlight:${cssTok(b.highlight)};
  --brand-ink:${cssTok(b.ink)};
  --brand-secondary:${cssTok(b.secondary || b.accent)};
  --brand-font-display:"${cssStr(b['font-display'])}";
  --brand-font-body:"${cssStr(b['font-body'])}";
  --brand-font-fallback:${cssTok(b['font-fallback'] || 'system-ui')};
  --type-scale:${cssTok(b["type-scale"] || 1)};
  --brand-type-scale:${cssTok(b["type-scale"] || 1)};
${optional('--brand-bg-lavender', 'bg-lavender')}${optional('--brand-bg-wash', 'bg-wash')}${optional('--brand-bg-butter', 'bg-butter')}${optional('--brand-card', 'card')}}`;
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
  if (!b.markSvg && b.logo && !marks().includes(b.logo)) throw new Error(`brand logo "${b.logo}": an SVG logo is fetched next to a brand.yaml URL only; otherwise one of the marks (${marks().join(', ')})`);
  const mark = b.markSvg || readFileSync(join(root, 'themes/brands/marks', (b.logo || 'dot') + '.svg'), 'utf8');
  const core = readFileSync(join(root, 'runtime/jmd-core.js'), 'utf8');
  const runtime = core + '\n' + readFileSync(join(root, 'runtime/james-jmd.js'), 'utf8')
    + (edit ? '\n' + readFileSync(join(root, 'runtime/vendor/collab.js'), 'utf8') + '\n' + readFileSync(join(root, 'runtime/collab.js'), 'utf8') : '');
  const version = /VERSION = '([^']+)'/.exec(core)[1];
  const safeJmd = jmd.replace(/<\/script/gi, '<\\/script');
  const assetMap = { ...(dir ? resolveAssets(jmd, dir).assets : {}), ...(assets || {}) }; // local files, then the bank images resolved upstream
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  // the runtime script is the one script the page may run: its hash goes in the CSP, so anything else that ever lands in the file stays inert
  const runtimeBody = '\n' + runtime.trim() + '\n'; // exactly what sits between <script> and </script> in the template
  const csp = contentSecurityPolicy(createHash('sha256').update(runtimeBody).digest('base64'));

  return readFileSync(join(root, 'runtime/index.html'), 'utf8')
    .replace('@@RUNTIME_VERSION@@', version)
    .replace('@@BUILD_DATE@@', new Date().toISOString().slice(0, 16).replace('T', ' '))
    .replace('@@CSP@@', () => csp)
    .replace('@@FONTS@@', () => fontsCss.trim())
    .replace('@@BRAND_NAME@@', () => cssComment(b.name))
    .replace('@@BRAND_CSS@@', () => brandCss)
    .replace('@@ENGINE@@', () => readFileSync(join(root, 'themes/engine/engine.css'), 'utf8').trim())
    .replace('@@BRAND_MARK@@', () => mark.trim())
    .replace('@@BRAND_JSON@@', () => JSON.stringify({ ...b, markSvg: undefined, logoDropped: undefined, fontsCss: undefined, fontsDropped: undefined, fontsUrl: undefined, logoUrl: undefined }).replace(/</g, '\\u003c'))
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
