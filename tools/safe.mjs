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
  // the page layout a charter decides once for every page (#73); the first word is the default, the look every brand had before
  align: ['center', 'left'],
  'footer-band': ['none', 'line'],
  'cover-logo': ['small', 'large'],
  'table-head': ['strong', 'light'],
  'chrome-label': ['mono', 'body'],
};
export const COLOR_KEYS = ['primary', 'accent', 'highlight', 'ink', 'secondary', 'bg-lavender', 'bg-wash', 'bg-butter', 'card'];
const FONT = /^[\p{L}\p{N}\s,'"_-]+$/u; // a font list: names (any script), quotes, commas — never `<`, `}`, `;`, `\`, `(`
const FONT_ONE = /^[\p{L}\p{N}][\p{L}\p{N} _-]{0,63}$/u; // one face, as an Office file names it: no list, no quote
const MARK_ID = /^[\w-]+$/;

/** Every brand value against its shape; a field out of shape is an Error naming it, and nothing is built.
    `marks`: the ids of the shipped marks (logo may also be an https URL, or a .svg path next to a brand.yaml URL). */
export function validateBrand(b, { marks = [] } = {}) {
  const bad = (k, why) => { throw new Error(`brand ${k}: ${JSON.stringify(String(b[k]))} ${why}`); };
  for (const k of COLOR_KEYS) if (b[k] !== undefined && b[k] !== '' && !HEX.test(b[k])) bad(k, 'is not a #hex color');
  for (const k of ['font-display', 'font-body', 'font-fallback']) if (b[k] !== undefined && b[k] !== '' && !FONT.test(b[k])) bad(k, 'is not a font name (letters, spaces, commas, quotes)');
  for (const k of ['font-office', 'font-office-heavy']) if (b[k] !== undefined && b[k] !== '' && !FONT_ONE.test(b[k])) bad(k, 'is not one font name (letters, digits, spaces — no list, no quotes)');
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
  if (b.decor !== undefined && b.decor !== '') decorOf(b); // throws, naming the element and the field
  if (b.logo !== undefined && b.logo !== '' && b.logo !== 'custom' && !/^https?:\/\/\S+$/.test(b.logo) && !/^[\w./-]+\.(svg|png)$/.test(b.logo) && !(MARK_ID.test(b.logo) && marks.includes(b.logo)))
    bad('logo', `is not one of the marks (${marks.join(', ')}) nor an https URL`);
  return b;
}

/* ── decor: the brand's own graphic elements (1.49.0, #69) ──
   What a charter brings that is neither a colour nor a typeface: a corner shape, a band along an edge, curves on the dark
   pages, a glow. Each one is an SVG drawing — never a picture — rebuilt from the logo's allowlist and always painted in a
   colour of the brand, posed by data: a place, a size, the pages it goes on. `decor:` replaces `watermark:`, which is still
   read as its old name (mark and circles are two of the ready elements, drawn by the engine). */
export const DECOR_READY = ['quarter', 'glow', 'waves', 'band', 'dots']; // themes/brands/decor/<id>.svg
export const DECOR_ENGINE = ['mark', 'circles']; // what `watermark:` drew, still drawn by the engine
export const DECOR_PLACES = ['corner-tl', 'corner-tr', 'corner-bl', 'corner-br', 'edge-top', 'edge-bottom', 'edge-left', 'edge-right', 'full'];
export const DECOR_TINTS = ['primary', 'accent', 'highlight', 'secondary', 'ink', 'lavender', 'wash', 'butter', 'card', 'white'];
const DECOR_INTENTS = ['hook', 'problem', 'reveal', 'prove', 'explain', 'decide', 'recap', 'celebrate', 'fun', 'act'];
export const DECOR_ON = ['all', 'cover', 'dark', 'light', ...DECOR_INTENTS];
export const DECOR_LAYOUTS = ['slide', 'memo', 'doc', 'story', 'webpage'];
export const DECOR_MAX = 6, DECOR_SVG_MAX = 100 * 1024;
export const DECOR_SVG_ONLY = 'a charter element must be an SVG file (no PNG, no JPEG): a drawing takes the brand\'s colours and stays sharp at every size, a picture can do neither';
// where a ready element goes when it is named alone — a designer's choice, one line each
export const DECOR_DEFAULTS = {
  quarter: { place: 'corner-br', size: '46', tint: 'lavender', on: 'light', opacity: '1' },
  glow: { place: 'corner-tr', size: '60', tint: 'secondary', on: 'all', opacity: '.5' },
  waves: { place: 'full', size: '100', tint: 'white', on: 'dark', opacity: '.35' },
  band: { place: 'edge-bottom', size: '2', tint: 'accent', on: 'light', opacity: '1' },
  dots: { place: 'corner-tr', size: '30', tint: 'accent', on: 'light', opacity: '.35' },
};
const DECOR_NAME = /^[a-z][a-z0-9-]{0,23}$/;
const DECOR_REF = /^(https:\/\/[^\s"'<>]+|[\w-][\w.-]*(\/[\w.-]+)*)$/; // an https URL, or a path beside the brand file (never `..`)

/** The brand's decor, normalized — { watermark: mark|circles|none, items: [{ name, svg, place, size, tint, on, layouts, opacity }] } —
    or an Error naming the element and the field. `decor:` is `none`, a list of ready element names (`quarter waves`, `mark`), or a
    map of named elements; left out, the old `watermark:` says it (`none` → no decor). */
export function decorOf(b) {
  const bad = (n, why) => { throw new Error(`brand decor${n ? ' ' + n : ''}: ${why}`); };
  let d = b.decor;
  if (d === undefined || d === '') return { watermark: b.watermark || 'none', items: [] };
  if (typeof d === 'string') {
    const words = d.trim().toLowerCase().split(/[\s,]+/).filter(Boolean);
    if (words.includes('none')) { if (words.length > 1) bad('', '`none` stands alone'); return { watermark: 'none', items: [] }; }
    d = {};
    for (const w of words) {
      if (!DECOR_READY.includes(w) && !DECOR_ENGINE.includes(w)) bad(w, /\.(png|jpe?g|gif|webp)$/i.test(w) ? DECOR_SVG_ONLY : `not one of the ready elements (${[...DECOR_READY, ...DECOR_ENGINE].join(', ')}) — an element of your own is a map: decor: / name: / svg: file.svg`);
      d[w] = { svg: w };
    }
  }
  if (typeof d !== 'object' || Array.isArray(d)) bad('', 'is `none`, ready element names, or a map of named elements');
  const entries = Object.entries(d);
  if (entries.length > DECOR_MAX + DECOR_ENGINE.length) bad('', `${entries.length} elements, ${DECOR_MAX} at most`);
  let watermark = 'none'; const items = [];
  for (const [name, raw] of entries) {
    if (!DECOR_NAME.test(name)) bad(JSON.stringify(name).slice(0, 40), 'is not a name (a-z, digits, dashes, 24 at most)');
    const given = typeof raw === 'string' ? { svg: raw } : raw && typeof raw === 'object' ? raw : bad(name, 'is a map (svg, place, size, tint, on, layouts, opacity)');
    const svg = String(given.svg || (DECOR_READY.includes(name) || DECOR_ENGINE.includes(name) ? name : '')).trim();
    if (DECOR_ENGINE.includes(svg)) { watermark = svg; continue; } // the engine's drawing: no place, no size
    if (/\.(png|jpe?g|gif|webp|avif|bmp)$/i.test(svg)) bad(name, DECOR_SVG_ONLY);
    const testHttp = process.env.JMD_BRAND_HTTP && /^http:\/\/(127\.0\.0\.1|localhost)[:/][^\s"'<>]*$/.test(svg); // tests only, as for the image banks
    if (!DECOR_READY.includes(svg) && !(/\.svg$/i.test(svg) && (DECOR_REF.test(svg) || testHttp) && !svg.split('/').includes('..')))
      bad(name, /\.svg$/i.test(svg) ? `svg ${JSON.stringify(svg.slice(0, 80))} is neither a file beside the brand file (a plain path, never \`..\`) nor an https URL` : `svg ${JSON.stringify(svg.slice(0, 80))} is neither a ready element (${DECOR_READY.join(', ')}) nor an .svg file — ${DECOR_SVG_ONLY}`);
    for (const k of Object.keys(given)) if (!['svg', 'place', 'size', 'tint', 'on', 'layouts', 'opacity'].includes(k)) bad(name, `unknown field \`${String(k).slice(0, 24)}\` (svg, place, size, tint, on, layouts, opacity)`);
    const it = { ...(DECOR_DEFAULTS[svg] || { place: 'corner-br', size: '40', tint: 'accent', on: 'all', opacity: '1' }), ...given, svg };
    const place = String(it.place).toLowerCase(), tint = String(it.tint).toLowerCase();
    if (!DECOR_PLACES.includes(place)) bad(name, `place ${JSON.stringify(String(it.place).slice(0, 24))} is not one of ${DECOR_PLACES.join(', ')}`);
    if (!/^\d{1,3}$/.test(String(it.size)) || +it.size < 1 || +it.size > 100) bad(name, 'size is a percentage, 1 to 100 (of the page\'s short side for a corner, its thickness for an edge)');
    if (!DECOR_TINTS.includes(tint)) bad(name, `tint ${JSON.stringify(String(it.tint).slice(0, 24))} is not one of the brand's colours: ${DECOR_TINTS.join(', ')} — an element is always drawn in the brand's colours`);
    if (!/^(0?\.\d{1,3}|1(\.0+)?)$/.test(String(it.opacity)) || +it.opacity < .05) bad(name, 'opacity is a number from 0.05 to 1');
    const on = String(it.on).toLowerCase().split(/[\s,]+/).filter(Boolean);
    for (const o of on) if (!DECOR_ON.includes(o)) bad(name, `on ${JSON.stringify(o.slice(0, 24))} is not one of ${DECOR_ON.join(', ')}`);
    // a page-sized drawing is drawn for a 16:9 page: on a phone it would be cropped to its middle, so a story has it only when asked
    const layouts = it.layouts ? String(it.layouts).toLowerCase().split(/[\s,]+/).filter(Boolean) : DECOR_LAYOUTS.filter(l => !(place === 'full' && l === 'story'));
    for (const l of layouts) if (!DECOR_LAYOUTS.includes(l)) bad(name, `layout ${JSON.stringify(l.slice(0, 24))} is not one of ${DECOR_LAYOUTS.join(', ')}`);
    items.push({ name, svg, place, size: +it.size, tint, on: on.length ? on : ['all'], layouts, opacity: +it.opacity });
  }
  if (items.length > DECOR_MAX) bad('', `${items.length} elements, ${DECOR_MAX} at most`);
  return { watermark, items };
}

/** A decor SVG, rebuilt by the logo's allowlist, then repainted: every colour it carries becomes the brand's (`currentColor`, set by
    its tint) — `none` and the gradients of its own stay. { symbol, dropped }: the symbol is `brand-decor-<name>`, its ids prefixed. */
export function decorSymbol(name, svg, place, tint = 'accent') {
  if (Buffer.byteLength(String(svg)) > DECOR_SVG_MAX) throw new Error(`brand decor ${name}: the SVG is ${Math.round(Buffer.byteLength(String(svg)) / 1024)} KB, ${DECOR_SVG_MAX / 1024} KB at most`);
  const r = sanitizeSvg(svg, { prefix: 'dc-' + name + '-' });
  const aspect = { 'corner-tl': 'xMinYMin meet', 'corner-tr': 'xMaxYMin meet', 'corner-bl': 'xMinYMax meet', 'corner-br': 'xMaxYMax meet', full: 'xMidYMid slice' }[place] || 'none';
  const paint = v => /^\s*(none|transparent|url\(#[\w-]+\))\s*$/i.test(v) ? v : 'currentColor';
  // a gradient's stops are painted where the gradient is defined, not where it is used: currentColor would be the hidden sprite's,
  // so a stop takes the tint by its custom property (engine.css, --decor-<tint>), which every element of the page inherits
  const stopPaint = `var(--decor-${DECOR_TINTS.includes(tint) ? tint : 'accent'})`;
  const symbol = r.symbol
    .replace(/ (fill|stroke)="([^"]*)"/g, (_, k, v) => ` ${k}="${paint(v)}"`)
    .replace(/ style="([^"]*)"/g, (_, st) => ` style="${st.replace(/(^|;)\s*(fill|stroke)\s*:\s*([^;]*)/g, (m, sep, k, v) => `${sep}${k}:${paint(v)}`)}"`)
    .replace(/<stop([^>]*?)(\/?)>/g, (_, attrs, close) => {
      let st = ''; attrs = attrs.replace(/ stop-color="[^"]*"/g, '').replace(/ style="([^"]*)"/g, (m, v) => { st = v.replace(/(^|;)\s*stop-color\s*:[^;]*/g, '').replace(/^;+/, ''); return ''; });
      return `<stop${attrs} style="${st ? st + ';' : ''}stop-color:${stopPaint}"${close}>`;
    })
    .replace('<symbol id="brand-mark"', `<symbol id="brand-decor-${name}" preserveAspectRatio="${aspect}"`);
  return { symbol, dropped: r.dropped };
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

/* A logo that only exists as a PNG (1.31.0). A raster is not a shape: it cannot be the watermark, the statement's blob or a
   card's marker, so it is only ever the lockup's picture (lib/jmd.mjs turns those decorations off). What is checked here is
   that it is a PNG and nothing else — the signature, an IHDR first with sane dimensions, an IEND last with nothing after it
   (so a file that is a PNG *and* something else is refused, not carried) — and its size. It then travels as base64 in a
   `data:image/png` URI inside the brand-mark symbol: a picture the deck's policy already allows (`img-src data:`), never
   markup, never a fetch. */
export const PNG_MAX = 300 * 1024;
export function pngInfo(bytes) {
  const b = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
  if (b.length > PNG_MAX) throw new Error(`the PNG is ${Math.round(b.length / 1024)} KB, the limit is ${PNG_MAX / 1024} KB`);
  if (b.length < 57 || b.readUInt32BE(0) !== 0x89504e47 || b.readUInt32BE(4) !== 0x0d0a1a0a) throw new Error('not a PNG file');
  if (b.readUInt32BE(8) !== 13 || b.toString('latin1', 12, 16) !== 'IHDR') throw new Error('not a PNG file: no header first');
  const width = b.readUInt32BE(16), height = b.readUInt32BE(20);
  if (!width || !height || width > 8192 || height > 8192) throw new Error(`a PNG of ${width}×${height} pixels: 1 to 8192 on each side`);
  if (b.toString('latin1', b.length - 8, b.length - 4) !== 'IEND' || b.readUInt32BE(b.length - 12) !== 0) throw new Error('not a PNG file: it does not end where a PNG ends');
  return { width, height };
}
/** { symbol, width, height } — the `<symbol id="brand-mark">` of a PNG logo: one <image>, its own size as the viewBox. */
export function rasterMark(bytes) {
  const { width, height } = pngInfo(bytes);
  return { width, height, symbol: `<symbol id="brand-mark" viewBox="0 0 ${width} ${height}"><image width="${width}" height="${height}" href="data:image/png;base64,${Buffer.from(bytes).toString('base64')}"/></symbol>` };
}
