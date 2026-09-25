/* What keeps a deck data, never code — spec/security.md §1 and §2.
   A brand (a customer's YAML, a logo fetched from their site) and a path (an image reference, a folder the caller names)
   are the inputs we *invite*; this module gives each one a shape and refuses the rest.
   validateBrand(): every brand field against its shape.   cssStr()/cssTok(): escape at interpolation anyway.
   sanitizeSvg(): a logo is parsed and rebuilt from an allowlist, never copied.   containedPath(): a real path under a real folder. */
import { realpathSync, existsSync } from 'node:fs';
import { resolve, sep } from 'node:path';

const HEX = /^#[0-9a-f]{3,8}$/i;
const ENUMS = {
  watermark: ['mark', 'circles', 'none'],
  'card-marker': ['glyphs', 'icon', 'mark', 'letter', 'none'],
  'card-fill': ['alternate', 'plain'],
  'card-shadow': ['offset', 'none'],
  motion: ['none', 'soft', 'slide', 'zoom', 'step'],
};
export const COLOR_KEYS = ['primary', 'accent', 'highlight', 'ink', 'secondary', 'bg-lavender', 'bg-wash', 'bg-butter', 'card'];
const FONT = /^[\p{L}\p{N}\s,'"_-]+$/u; // a font list: names (any script), quotes, commas — never `<`, `}`, `;`, `\`, `(`
const MARK_ID = /^[\w-]+$/;

/** Every brand value against its shape; a field out of shape is an Error naming it, and nothing is built.
    `marks`: the ids of the shipped marks (logo may also be an https URL, or a .svg path next to a brand.yaml URL). */
export function validateBrand(b, { marks = [] } = {}) {
  const bad = (k, why) => { throw new Error(`brand ${k}: ${JSON.stringify(String(b[k]))} ${why}`); };
  for (const k of COLOR_KEYS) if (b[k] !== undefined && b[k] !== '' && !HEX.test(b[k])) bad(k, 'is not a #hex color');
  for (const k of ['font-display', 'font-body', 'font-fallback']) if (b[k] !== undefined && b[k] !== '' && !FONT.test(b[k])) bad(k, 'is not a font name (letters, spaces, commas, quotes)');
  if (b['type-scale'] !== undefined && b['type-scale'] !== '' && !(/^\d+(\.\d+)?$/.test(b['type-scale']) && +b['type-scale'] >= 0.5 && +b['type-scale'] <= 2)) bad('type-scale', 'is not a number between 0.5 and 2');
  if (b.glyphs !== undefined && b.glyphs !== '' && !/^\d{1,2}$/.test(b.glyphs)) bad('glyphs', 'is not a count');
  for (const k in ENUMS) if (b[k] !== undefined && b[k] !== '' && !ENUMS[k].includes(b[k])) bad(k, 'is not one of ' + ENUMS[k].join(', '));
  if (b.fonts !== undefined && b.fonts !== '' && b.fonts !== 'custom' && !/^fonts\/[\w.-]+(\/[\w.-]+)*\.css$/.test(b.fonts) && !/^https?:\/\/\S+\.css$/.test(b.fonts) && !/^[\w.-]+(\/[\w.-]+)*\.css$/.test(b.fonts))
    bad('fonts', 'is not a fonts/….css file of the brands folder, nor a .css next to the brand.yaml URL, nor an https URL');
  if (b.images !== undefined) {
    if (!b.images || typeof b.images !== 'object' || Array.isArray(b.images)) bad('images', 'is not a map of bank prefixes to https folders');
    const badBank = (k, why) => { throw new Error(`brand images: bank "${k}" ${why}`); };
    for (const [k, v] of Object.entries(b.images)) {
      if (!/^[a-z][a-z0-9-]*$/.test(k)) badBank(k, 'is not a prefix (letters, digits, dashes, starting with a letter)');
      const testHttp = process.env.JMD_BRAND_HTTP && /^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(String(v)); // tests only
      if (typeof v !== 'string' || !(/^https:\/\/\S+$/.test(v) || testHttp || /^[\w./-]+\/?$/.test(v)) || v.split('/').includes('..')) badBank(k, `is not an https folder nor a path next to the brand.yaml: ${JSON.stringify(String(v))}`);
    }
  }
  if (b.logo !== undefined && b.logo !== '' && b.logo !== 'custom' && !/^https?:\/\/\S+$/.test(b.logo) && !/^[\w./-]+\.svg$/.test(b.logo) && !(MARK_ID.test(b.logo) && marks.includes(b.logo)))
    bad('logo', `is not one of the marks (${marks.join(', ')}) nor an https URL`);
  return b;
}

/** A fetched fonts CSS (a brand's `fonts:` URL) is never copied into the page: it is parsed and rebuilt from an allowlist —
    @font-face blocks only, each with a font-family (validated as a font name), an optional style / weight / display, and a src that is
    one woff2 or woff data URI. Anything else (other at-rules, selectors, url(https://…), unicode-range tricks, comments) is dropped
    and counted in fontFaces.dropped. What comes out can neither close the <style> nor reach the network. */
export function fontFaces(css) {
  const out = [], dropped = []; let seen = 0;
  const src = String(css).replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /@font-face\s*\{([^{}]*)\}/g; let m;
  while ((m = re.exec(src))) {
    seen++; const d = {};
    const dre = /([\w-]+)\s*:\s*((?:[^;()]|\([^()]*\))*)/g; let x; while ((x = dre.exec(m[1]))) d[x[1].toLowerCase()] = x[2].trim(); // `;` inside url(data:…;base64,…) stays in the value
    const family = (d['font-family'] || '').replace(/^['"]|['"]$/g, '');
    const data = /^url\(\s*['"]?data:font\/(woff2?);base64,([A-Za-z0-9+/=]+)['"]?\s*\)(?:\s*format\(\s*['"]?(woff2?)['"]?\s*\))?$/.exec(d.src || '');
    const style = d['font-style'] || 'normal', weight = d['font-weight'] || '400', display = d['font-display'] || 'block';
    if (!family || !FONT.test(family) || !data || !/^(normal|italic|oblique)$/.test(style) || !/^\d{1,4}( \d{1,4})?$/.test(weight) || !/^(auto|block|swap|fallback|optional)$/.test(display)) { dropped.push(family || '?'); continue; }
    out.push(`@font-face{font-family:'${family}';font-style:${style};font-weight:${weight};font-display:${display};src:url(data:font/${data[1]};base64,${data[2]}) format('${data[3] || data[1]}')}`);
  }
  const other = src.replace(re, '').replace(/\s+/g, ''); if (other) dropped.push('other rules');
  fontFaces.dropped = dropped; fontFaces.seen = seen;
  return out.join('\n');
}

/** A value inside a quoted CSS string: `"` `\` `<` `>` `}` `;` and line breaks become CSS hex escapes — nothing can close the string, the rule or the <style>. */
export const cssStr = v => String(v).replace(/["\\<>{};\n\r\f]/g, c => '\\' + c.charCodeAt(0).toString(16) + ' ');
/** A bare CSS token (a color, a number, a font list): anything but the characters those are made of is dropped. */
export const cssTok = v => String(v).replace(/[^\w#.,'" %-]/g, '');
/** Text inside a CSS comment: no `*`, no `/` (so no closer can be assembled), no `<` `>`. */
export const cssComment = v => String(v).replace(/[*\/<>]/g, '');

/* ── SVG: a logo is parsed, then rebuilt from what a drawing needs ──
   Elements and attributes outside the lists are dropped and counted; every id is prefixed so a logo can never shadow a runtime id;
   href and url() may only point inside the logo (#…). Comments, CDATA, processing instructions, doctype, text: gone. */
const SVG_ELEMENTS = new Set(['svg', 'g', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon', 'defs', 'symbol', 'use', 'title',
  'lineargradient', 'radialgradient', 'stop', 'clippath', 'mask']);
const SVG_CASE = { lineargradient: 'linearGradient', radialgradient: 'radialGradient', clippath: 'clipPath', viewbox: 'viewBox', gradientunits: 'gradientUnits', gradienttransform: 'gradientTransform', spreadmethod: 'spreadMethod', clippathunits: 'clipPathUnits', maskunits: 'maskUnits', maskcontentunits: 'maskContentUnits' };
const SVG_ATTRS = new Set(['d', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'fx', 'fy', 'width', 'height', 'points', 'viewbox',
  'fill', 'fill-rule', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-opacity',
  'opacity', 'clip-rule', 'clip-path', 'mask', 'transform', 'id', 'class', 'style', 'offset', 'stop-color', 'stop-opacity',
  'gradientunits', 'gradienttransform', 'spreadmethod', 'clippathunits', 'maskunits', 'maskcontentunits', 'href', 'xlink:href']);
const HTML_VOID = new Set(['br', 'img', 'input', 'hr', 'meta', 'link', 'source', 'wbr', 'area', 'base', 'col', 'embed', 'param', 'track']);
const STYLE_PROPS = new Set(['fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset', 'opacity', 'clip-rule', 'stop-color', 'stop-opacity', 'display']);
/** The class rules of a logo's <style> (Illustrator, Figma: `.st0{fill:#123}`), as { class → 'prop:value;…' } — paint properties only, values
    made of color/number characters or a local url(#id). A <style> in an inline SVG would apply to the whole page, so it is never kept:
    its rules are inlined on the elements that carry the class. Everything else in it (selectors by tag or id, @import, url(http…)) is dropped. */
function styleRules(svg, prefix) {
  const rules = {}; let dropped = 0;
  for (const m of String(svg).matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
    const css = m[1].replace(/<!\[CDATA\[|\]\]>/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const r of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const sel = r[1].trim(), decls = [];
      for (const d of r[2].split(';')) {
        const kv = /^\s*([a-z-]+)\s*:\s*([^!]+?)\s*$/i.exec(d); if (!kv) continue;
        const k = kv[1].toLowerCase(); let v = kv[2];
        const u = /^url\(\s*['"]?#([\w-]+)['"]?\s*\)$/i.exec(v);
        if (!STYLE_PROPS.has(k) || !(u || /^[\w#.,% -]+$/.test(v))) { dropped++; continue; }
        if (u) v = `url(#${prefix}${u[1]})`;
        decls.push(k + ':' + v);
      }
      const classes = sel.split(',').map(x => x.trim());
      if (!decls.length || !classes.every(c => /^\.[\w-]+$/.test(c))) { if (r[2].trim()) dropped++; continue; }
      for (const c of classes) rules[c.slice(1)] = (rules[c.slice(1)] ? rules[c.slice(1)] + ';' : '') + decls.join(';');
    }
  }
  return { rules, dropped };
}
const TOKEN = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<![^>]*>|<\/\s*([\w:-]+)\s*>|<([\w:-]+)((?:\s+[\w:.-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*(\/?)\s*>|([^<]+)|</g;
const ATTR = /([\w:.-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
const escAttr = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** { symbol, viewBox, dropped: ['<script>', 'onload', …] } — the `<symbol id="brand-mark">` the runtime expects, and what did not pass. */
export function sanitizeSvg(svg, { prefix = 'lg-' } = {}) {
  if (!/<svg[\s>]/i.test(String(svg))) throw new Error('logo: not an <svg> document');
  const dropped = [], out = [], open = [];
  const { rules, dropped: badRules } = styleRules(svg, prefix); if (badRules) dropped.push('style rules');
  let viewBox = null, seenRoot = false, skipping = 0; // skipping: depth inside a dropped element
  for (const m of String(svg).matchAll(TOKEN)) {
    const [tok, closeName, name, attrs, selfClose, text] = m;
    if (text !== undefined) { if (!skipping && text.trim() && open[open.length - 1] === 'title') out.push(escAttr(text.trim())); continue; }
    if (closeName !== undefined) {
      const n = closeName.toLowerCase();
      if (skipping) { if (!HTML_VOID.has(n)) skipping--; continue; }
      if (open[open.length - 1] === n) { open.pop(); if (n !== 'svg') out.push(`</${SVG_CASE[n] || n}>`); }
      continue;
    }
    if (name === undefined) continue; // prolog, doctype, comments: not a drawing, not worth a warning
    const n = name.toLowerCase();
    if (skipping) { if (!selfClose && !HTML_VOID.has(n)) skipping++; continue; }
    if (n === 'style') { if (!selfClose) skipping = 1; continue; } // its class rules were read upstream, inlined below
    if (!SVG_ELEMENTS.has(n)) { dropped.push('<' + n + '>'); if (!selfClose) skipping = 1; continue; }
    const kept = []; let classes = null, style = '';
    for (const a of attrs.matchAll(ATTR)) {
      const k = a[1].toLowerCase(), v = a[2] ?? a[3] ?? a[4] ?? '';
      if (k.startsWith('xmlns') || (n === 'svg' && !k.startsWith('on') && k !== 'viewbox')) continue; // namespaces and the root's own attributes: dropped without a word
      if (k.startsWith('on') || !SVG_ATTRS.has(k)) { dropped.push(k); continue; }
      let val = v.trim();
      if (k === 'href' || k === 'xlink:href') { if (!/^#[\w-]+$/.test(val)) { dropped.push(k + '=' + val.slice(0, 24)); continue; } val = '#' + prefix + val.slice(1); }
      else if (k === 'id') { if (!/^[\w-]+$/.test(val)) { dropped.push('id'); continue; } val = prefix + val; }
      else if (k === 'class') { val = val.replace(/[^\w\s-]/g, ''); classes = val.split(/\s+/).filter(Boolean); }
      else if (k === 'style') { if (!/^[\w\s:;#.,%-]*$/.test(val)) { dropped.push('style'); continue; } style = val; continue; }
      else if (/url\s*\(/i.test(val)) { const u = /^url\(\s*['"]?#([\w-]+)['"]?\s*\)$/i.exec(val); if (!u) { dropped.push(k + '=url(…)'); continue; } val = `url(#${prefix}${u[1]})`; }
      else if (/[<>"]/.test(val) || /javascript:|data:|&#|expression\(/i.test(val)) { dropped.push(k); continue; }
      if (k === 'viewbox' && n === 'svg' && !seenRoot) viewBox = val;
      if (n === 'svg') continue; // the root: its viewBox goes on the symbol, nothing else survives
      kept.push(`${SVG_CASE[k] || k}="${escAttr(val)}"`);
    }
    // the logo's own class rules, inlined on the element (the <style> itself never reaches the page); the attribute style wins
    const fromRules = classes ? classes.map(c => rules[c]).filter(Boolean).join(';') : '';
    const styleAttr = [fromRules, style].filter(Boolean).join(';');
    if (styleAttr) kept.push(`style="${escAttr(styleAttr)}"`);
    if (n === 'svg') { if (seenRoot) { dropped.push('<svg>'); if (!selfClose) skipping = 1; continue; } seenRoot = true; if (!selfClose) open.push('svg'); continue; }
    if (!seenRoot) continue; // nothing before the root
    const tag = SVG_CASE[n] || n;
    if (n === 'use' && !kept.some(a => a.endsWith('href="#' + prefix) || /href="#/.test(a))) { if (!selfClose) skipping = 1; continue; } // a <use> without a local target draws nothing
    if (selfClose) out.push(`<${tag}${kept.length ? ' ' + kept.join(' ') : ''}/>`);
    else { out.push(`<${tag}${kept.length ? ' ' + kept.join(' ') : ''}>`); open.push(n); }
  }
  while (open.length) { const n = open.pop(); if (n !== 'svg') out.push(`</${SVG_CASE[n] || n}>`); }
  return { symbol: `<symbol id="brand-mark" viewBox="${escAttr(viewBox || '0 0 100 100')}">${out.join('')}</symbol>`, viewBox, dropped };
}

/* ── paths: a file is embedded only when its real path sits under the real folder ── */
export const IMAGE_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif' };

/** The real path of `src` under `dir`, or { refused: why }: outside the folder (also through a symlink), missing, or not an image. */
export function containedPath(dir, src) {
  if (!dir) return { refused: 'no folder given' };
  let base; try { base = realpathSync(dir); } catch { return { refused: 'folder not found' }; }
  const p = resolve(base, src);
  if (!p.startsWith(base + sep)) return { refused: 'outside the deck folder' }; // by path, before touching the disk
  if (!existsSync(p)) return { refused: 'file not found' };
  let real; try { real = realpathSync(p); } catch { return { refused: 'file not found' }; }
  if (!real.startsWith(base + sep)) return { refused: 'outside the deck folder' }; // by real path: a symlink pointing out
  const ext = src.split('.').pop().toLowerCase();
  if (!IMAGE_MIME[ext]) return { refused: `not an image (${Object.keys(IMAGE_MIME).join(', ')})` };
  return { path: real, mime: IMAGE_MIME[ext] };
}

/** Hosted: a caller's folder is never absolute and never climbs; it is resolved under `scratch`. */
export function confinedDir(dir, scratch) {
  if (dir === undefined || dir === null || dir === '') return null;
  const d = String(dir);
  if (/^([a-zA-Z]:)?[\\/]/.test(d) || d.split(/[\\/]/).includes('..')) throw new Error('absolute paths and `..` are refused on a hosted server: the server\'s disk is not yours, pass images by building next to them locally');
  return resolve(scratch, d);
}
