/* jmd → .pptx, native (spec/export.md, "PowerPoint"). Not a second theme engine: the deck is drawn by the runtime in Chromium,
   as for the PDF, and each screen is then *read back* — where every block of text sits, in which face, size, weight and colour,
   which boxes are filled — and written again as PowerPoint objects at the same place. So every block, brand and intent comes
   along without a line of code of its own, and what PowerPoint cannot draw the way a browser does is kept as a picture:

     1. the slide's own fill                                   → the slide background (a colour)
     2. the watermark (glyphs, circles), behind everything     → one transparent picture, "back"
     3. every box with a plain fill or a border                → a native shape (rectangle, rounded, ellipse)
     4. what is left of the drawing (SVG glyphs, charts, lines, gradients, list markers) → one transparent picture, "front"
     5. every photo                                            → a picture of its own, cropped as on screen
     6. every run of text                                      → a native text box, editable, in the deck's words

   Motion is turned off before anything is read: a table or a chart mid-animation is not a state to freeze.
   The speaker notes travel. Not a round-trip: a .pptx edited in PowerPoint never becomes the source again (README).
   Zero dependencies: the OOXML is written here, zipped by tools/zip.mjs. */
import { writeZip } from '../tools/zip.mjs';

const EMU = 9525; // one CSS px at 96 dpi
const emu = px => Math.round(px * EMU);
const xml = s => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* ---------------------------------------------------------------- reading the page (runs inside Chromium) ---- */

/* Marks the text, the boxes and the photos of one screen, returns them in page order, and tags the elements so that the
   pictures can be shot with each layer alone. Coordinates are relative to the screen, in CSS px. */
const READ = `(i => {
  const slide = jamesJmd.state.slides[i], base = slide.getBoundingClientRect();
  // a Doc page is shown zoomed out, a Story screen scaled up: sizes read in CSS px are multiplied by what the screen does to them
  const K = base.width / (parseFloat(getComputedStyle(slide).width) || base.width);
  const out = { w: base.width, h: base.height, bg: null, notes: (t => { t.innerHTML = slide.dataset.notes || ''; return t.value; })(document.createElement('textarea')), boxes: [], texts: [], images: [] };
  const vis = cs => cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0.01;
  // any CSS colour (rgb, color(srgb …), oklch, color-mix) → rgba, by painting one pixel: the browser converts, we read
  const cx = document.createElement('canvas').getContext('2d', { willReadFrequently: true }); cx.canvas.width = cx.canvas.height = 1;
  const memo = new Map();
  const rgba = c => { if (!c || c === 'transparent') return null; if (memo.has(c)) return memo.get(c); cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; const v = d[3] ? { r: d[0], g: d[1], b: d[2], a: +(d[3] / 255).toFixed(3) } : { r: 0, g: 0, b: 0, a: 0 }; memo.set(c, v); return v; };
  const box = r => ({ x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height });
  const INLINE = /^(inline|inline-block|contents)$/;
  const leafBlock = el => [...el.childNodes].every(n => n.nodeType === 3 || (n.nodeType === 1 && (INLINE.test(getComputedStyle(n).display) && !n.matches('svg,img') || n.matches('br'))));
  const hasText = el => /\\S/.test(el.textContent);
  let opacityOf = el => { let o = 1; for (let e = el; e && e !== slide.parentNode; e = e.parentElement) o *= parseFloat(getComputedStyle(e).opacity); return o; };
  const runs = (el, acc = []) => {
    for (const n of el.childNodes) {
      if (n.nodeType === 3) { if (n.textContent) { const cs = getComputedStyle(n.parentElement); acc.push({ t: n.textContent, font: cs.fontFamily, size: parseFloat(cs.fontSize) * K, weight: parseInt(cs.fontWeight) || 400, mono: /monospace/i.test(cs.fontFamily), italic: cs.fontStyle === 'italic', color: rgba(cs.color), caps: cs.textTransform === 'uppercase', spacing: (parseFloat(cs.letterSpacing) || 0) * K, href: n.parentElement.closest('a')?.getAttribute('href') || null, underline: /underline/.test(cs.textDecorationLine) }); } }
      else if (n.nodeType === 1 && n.matches('br')) acc.push({ br: true });
      else if (n.nodeType === 1 && vis(getComputedStyle(n))) runs(n, acc);
    }
    return acc;
  };
  const walk = el => {
    const cs = getComputedStyle(el);
    if (!vis(cs) || el.matches('.slide-chrome .chrome-meta:empty')) return;
    // said to a screen reader, never shown (a chart's data as a list): clipped to nothing, or one pixel
    const er0 = el.getBoundingClientRect();
    if ((cs.clip && cs.clip !== 'auto') || /inset\\(50%/.test(cs.clipPath) || (cs.position === 'absolute' && er0.width <= 2 && er0.height <= 2)) return;
    // a sign drawn as a letter (the quote's “, an arrow): it stays a drawing — a different face would move it
    if (leafBlock(el) && /^[\\s\\u2000-\\u2BFF\\u201C-\\u201F"«»→←↑↓✓✔•·]+$/.test(el.textContent) && /\\S/.test(el.textContent)) { el.dataset.pxKeep = '1'; return; }
    if (el.matches('img')) { const r = box(el.getBoundingClientRect()); if (r.w > 1 && r.h > 1) { el.dataset.pxImg = out.images.length; out.images.push({ ...r }); } return; }
    if (el.matches('svg')) return; // drawing: stays in the picture layers
    if (el !== slide && !el.matches('.wm, .wm *')) {
      const bg = rgba(cs.backgroundColor), bw = ['Top','Right','Bottom','Left'].map(s => (parseFloat(cs['border' + s + 'Width']) || 0) * K);
      const bc = ['Top','Right','Bottom','Left'].map(s => rgba(cs['border' + s + 'Color']));
      const plainBg = cs.backgroundImage === 'none';
      const filled = bg && bg.a > 0.01, bordered = bw.some(w => w > 0) && bc.some(c => c && c.a > 0.01);
      if (plainBg && (filled || bordered)) {
        const r = box(el.getBoundingClientRect());
        const uniform = bw.every(w => w === bw[0]) && bc.every(c => c && bc[0] && c.r === bc[0].r && c.g === bc[0].g && c.b === bc[0].b && c.a === bc[0].a);
        out.boxes.push({ ...r, fill: filled ? bg : null, line: bordered && uniform ? { w: bw[0], c: bc[0] } : null, radius: (parseFloat(cs.borderTopLeftRadius) || 0) * K, opacity: opacityOf(el) });
        if (bordered && !uniform) bw.forEach((w, k) => { if (w > 0 && bc[k] && bc[k].a > 0.01) out.boxes.push({ x: k === 1 ? r.x + r.w - w : r.x, y: k === 2 ? r.y + r.h - w : r.y, w: k % 2 ? w : r.w, h: k % 2 ? r.h : w, fill: bc[k], radius: 0, opacity: opacityOf(el) }); });
        el.dataset.pxBox = '1';
      }
    }
    if (el !== slide && hasText(el) && leafBlock(el)) {
      const range = document.createRange(); range.selectNodeContents(el);
      const rects = [...range.getClientRects()].filter(r => r.width > 0 && r.height > 0);
      if (!rects.length) return;
      const tr = range.getBoundingClientRect(), er = el.getBoundingClientRect();
      const padR = parseFloat(cs.paddingRight) || 0, padL = parseFloat(cs.paddingLeft) || 0;
      const lines = new Set(rects.map(r => Math.round(r.top))).size;
      const align = /center/.test(cs.textAlign) ? 'ctr' : /right|end/.test(cs.textAlign) ? 'r' : 'l';
      const left = align === 'l' ? tr.left : Math.min(tr.left, er.left + padL), right = align === 'r' ? tr.right : Math.max(tr.right, er.right - padR);
      const lh = parseFloat(cs.lineHeight);
      out.texts.push({ ...box({ left, top: tr.top, width: right - left, height: tr.height }), runs: runs(el), align, lines, lineHeight: isNaN(lh) ? null : lh * K, opacity: opacityOf(el) });
      return;
    }
    // mixed content (a word beside a drawing: the lockup's name next to its mark): each bare run of text is a box of its own
    if (el !== slide) for (const n of el.childNodes) if (n.nodeType === 3 && /\\S/.test(n.textContent)) {
      const range = document.createRange(); range.selectNodeContents(n);
      const rects = [...range.getClientRects()].filter(r => r.width > 0 && r.height > 0); if (!rects.length) continue;
      const tr = range.getBoundingClientRect(), lh = parseFloat(cs.lineHeight);
      const r0 = runs({ childNodes: [n] });
      out.texts.push({ ...box(tr), runs: r0, align: 'l', lines: new Set(rects.map(r => Math.round(r.top))).size, lineHeight: isNaN(lh) ? null : lh * K, opacity: opacityOf(el) });
    }
    for (const c of el.children) walk(c);
  };
  out.bg = rgba(getComputedStyle(slide).backgroundColor);
  walk(slide);
  return JSON.stringify(out);
})`;

/* The layers, by CSS: real text goes invisible (a pseudo-element keeps its own colour — a counter, a ✓, an arrow is a
   drawing), the boxes written as shapes lose their fill, photos are taken out; then either the watermark alone (back) or
   everything but it (front). The slide's own fill is a native background, never in a picture. */
const LAYER_CSS = `
  .px-shoot .slide, .px-shoot .slide * { -webkit-text-fill-color: transparent !important; text-shadow: none !important; text-decoration-color: transparent !important; caret-color: transparent !important; }
  .px-shoot .slide *::before, .px-shoot .slide *::after { -webkit-text-fill-color: currentColor !important; }
  .px-shoot .slide { background: transparent !important; box-shadow: none !important; }
  .px-shoot, .px-shoot body, .px-shoot :has(> .slide), .px-shoot :has(.slide.is-active) { background: transparent !important; box-shadow: none !important; }
  .px-shoot [data-px-keep] { -webkit-text-fill-color: currentColor !important; }
  .px-shoot [data-px-box] { background-color: transparent !important; border-color: transparent !important; box-shadow: none !important; }
  .px-shoot [data-px-img] { visibility: hidden !important; }
  .px-back .slide > :not(.wm) { visibility: hidden !important; }
  .px-back .slide::before, .px-back .slide::after { visibility: hidden !important; }
  .px-front .slide .wm { visibility: hidden !important; }
  .px-img .slide, .px-img .slide * { visibility: hidden !important; }
  .px-img .slide [data-px-img="\${N}"] { visibility: visible !important; }
`;

/* ---------------------------------------------------------------- writing the OOXML ---- */

const hex = c => [c.r, c.g, c.b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();
const solid = (c, opacity = 1) => {
  const a = Math.round(c.a * opacity * 100000);
  return `<a:solidFill><a:srgbClr val="${hex(c)}">${a < 100000 ? `<a:alpha val="${a}"/>` : ''}</a:srgbClr></a:solidFill>`;
};
/** The first face of a CSS stack that PowerPoint can name; the generic keywords mean nothing there. */
const face = stack => (String(stack).split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).find(s => s && !/^(system-ui|-apple-system|sans-serif|serif|monospace|ui-\w+|BlinkMacSystemFont)$/i.test(s)) || 'Arial');

function shapeXml(id, b) {
  const min = Math.min(b.w, b.h), r = Math.min(b.radius || 0, min / 2);
  const geom = r >= min / 2 - 0.5 && Math.abs(b.w - b.h) < 1 ? '<a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom>'
    : r > 0.5 ? `<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val ${Math.round(r / min * 100000)}"/></a:avLst></a:prstGeom>`
    : '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>';
  const fill = b.fill ? solid(b.fill, b.opacity) : '<a:noFill/>';
  const line = b.line ? `<a:ln w="${emu(b.line.w)}">${solid(b.line.c, b.opacity)}</a:ln>` : '<a:ln><a:noFill/></a:ln>';
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Shape ${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>`
    + `<p:spPr><a:xfrm><a:off x="${emu(b.x)}" y="${emu(b.y)}"/><a:ext cx="${emu(b.w)}" cy="${emu(b.h)}"/></a:xfrm>${geom}${fill}${line}</p:spPr>`
    + `<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="fr-FR"/></a:p></p:txBody></p:sp>`;
}

function picXml(id, rid, b, name) {
  return `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="${xml(name)}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>`
    + `<p:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>`
    + `<p:spPr><a:xfrm><a:off x="${emu(b.x)}" y="${emu(b.y)}"/><a:ext cx="${emu(b.w)}" cy="${emu(b.h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
}

/** Only links a reader may follow leave the deck as links (spec/security.md): https, http, mailto. Anything else stays text. */
const SAFE_HREF = /^(https?:\/\/|mailto:)/i;

function textXml(id, t, links, lang, office) {
  // a few px of slack on the right: PowerPoint's metrics are not Chrome's, and a line that wraps one word earlier pushes the box
  const slack = t.lines === 1 ? 0 : Math.max(4, t.w * 0.03);
  const paras = [[]];
  for (const r of t.runs) { if (r.br) paras.push([]); else paras[paras.length - 1].push(r); }
  // the line height: one line is centred in its measured box and given the face's own spacing — an exact spacing tighter
  // than the face (a 0.9 metric) is drawn differently by each suite, OnlyOffice lifts the glyphs out of the box; several
  // lines get the CSS ratio as a proportion of the face's single spacing (~1.17 of the size for the sans faces we name)
  const size = t.runs.find(r => r.size)?.size;
  const ln = t.lines > 1 && t.lineHeight && size ? `<a:lnSpc><a:spcPct val="${Math.round(Math.min(2, Math.max(0.7, t.lineHeight / size / 1.17)) * 100000)}"/></a:lnSpc>` : '';
  const body = paras.map(rs => {
    // collapse the HTML whitespace the way the browser did: runs of spaces and newlines are one space, trimmed at the ends
    let first = true;
    const runsXml = rs.map((r, k) => {
      let s = r.t.replace(/\s+/g, ' ');
      if (first) s = s.replace(/^ /, ''); if (k === rs.length - 1) s = s.replace(/ $/, '');
      if (!s) return ''; first = false;
      let link = '';
      if (r.href && SAFE_HREF.test(r.href)) { const rid = `rIdL${links.length + 1}`; links.push({ rid, href: r.href }); link = `<a:hlinkClick r:id="${rid}"/>`; }
      // the face: the brand's office face (its heavy cut for the heaviest weights, which then needs no bold), a mono for a mono
      const heavy = office.heavy && r.weight >= 800, f = r.mono ? 'Courier New' : heavy ? office.heavy : office.face || face(r.font);
      const attrs = [`lang="${lang}"`, `sz="${Math.round(r.size * 75)}"`, !heavy && r.weight >= 600 ? 'b="1"' : 'b="0"', r.italic ? 'i="1"' : '', r.underline ? 'u="sng"' : (r.href ? 'u="none"' : ''), r.caps ? 'cap="all"' : '', r.spacing ? `spc="${Math.round(r.spacing * 75)}"` : '', 'dirty="0"'].filter(Boolean).join(' ');
      return `<a:r><a:rPr ${attrs}>${r.color ? solid(r.color, t.opacity) : ''}<a:latin typeface="${xml(f)}"/><a:cs typeface="${xml(f)}"/>${link}</a:rPr><a:t>${xml(s)}</a:t></a:r>`;
    }).join('');
    return `<a:p><a:pPr algn="${t.align}">${ln}<a:spcBef><a:spcPts val="0"/></a:spcBef><a:buNone/></a:pPr>${runsXml}<a:endParaRPr lang="${lang}"/></a:p>`;
  }).join('');
  const x = t.align === 'r' ? t.x - slack : t.align === 'ctr' ? t.x - slack / 2 : t.x;
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Text ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>`
    + `<p:spPr><a:xfrm><a:off x="${emu(x)}" y="${emu(t.y)}"/><a:ext cx="${emu(t.w + slack)}" cy="${emu(t.h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>`
    + `<p:txBody><a:bodyPr wrap="${t.lines === 1 ? 'none' : 'square'}" lIns="0" tIns="0" rIns="0" bIns="0" anchor="${t.lines === 1 ? 'ctr' : 't'}"><a:noAutofit/></a:bodyPr><a:lstStyle/>${body}</p:txBody></p:sp>`;
}

const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const rels = list => HEAD + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list.map(r => `<Relationship Id="${r.id}" Type="${REL}/${r.type}" Target="${xml(r.target)}"${r.external ? ' TargetMode="External"' : ''}/>`).join('')}</Relationships>`;

function slideXml(s, n, lang, office) {
  let id = 2;
  const media = [], links = [], tree = [];
  const pic = (png, b, name) => { const rid = `rIdM${media.length + 1}`; media.push({ rid, name: `s${n}-${media.length + 1}.png`, png }); tree.push(picXml(id++, rid, b, name)); };
  const full = { x: 0, y: 0, w: s.w, h: s.h };
  if (s.back) pic(s.back, full, 'Watermark');
  for (const b of s.boxes) tree.push(shapeXml(id++, b));
  if (s.front) pic(s.front, full, 'Drawing');
  s.images.forEach((im, k) => im.png && pic(im.png, im, `Picture ${k + 1}`));
  for (const t of s.texts) tree.push(textXml(id++, t, links, lang, office));
  const bg = s.bg && s.bg.a > 0 ? `<p:bg><p:bgPr>${solid(s.bg)}<a:effectLst/></p:bgPr></p:bg>` : '';
  const body = HEAD + `<p:sld ${NS}><p:cSld>${bg}<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${tree.join('')}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
  const r = [{ id: 'rIdLayout', type: 'slideLayout', target: '../slideLayouts/slideLayout1.xml' },
    ...(s.notes ? [{ id: 'rIdNotes', type: 'notesSlide', target: `../notesSlides/notesSlide${n}.xml` }] : []),
    ...media.map(m => ({ id: m.rid, type: 'image', target: `../media/${m.name}` })),
    ...links.map(l => ({ id: l.rid, type: 'hyperlink', target: l.href, external: true }))];
  return { body, rels: rels(r), media };
}

const notesXml = (text, n, lang) => ({
  body: HEAD + `<p:notes ${NS}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>`
    + `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp>`
    + `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/>`
    + `<p:txBody><a:bodyPr/><a:lstStyle/>${String(text).split(/\n/).map(l => `<a:p><a:r><a:rPr lang="${lang}"/><a:t>${xml(l)}</a:t></a:r></a:p>`).join('')}</p:txBody></p:sp>`
    + `</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`,
  rels: rels([{ id: 'rId1', type: 'notesMaster', target: '../notesMasters/notesMaster1.xml' }, { id: 'rId2', type: 'slide', target: `../slides/slide${n}.xml` }]),
});

/* The fixed parts: one master, one blank layout, one theme, one notes master. The theme only names the brand's colours and
   face, so that what someone *adds* in PowerPoint starts on-brand; what we write carries its own values. */
function themeXml(name, palette, font) {
  const c = k => `<a:srgbClr val="${palette[k] || '000000'}"/>`;
  return HEAD + `<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="${xml(name)}"><a:themeElements>`
    + `<a:clrScheme name="${xml(name)}"><a:dk1>${c('dk1')}</a:dk1><a:lt1>${c('lt1')}</a:lt1><a:dk2>${c('dk2')}</a:dk2><a:lt2>${c('lt2')}</a:lt2>`
    + ['accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'].map(k => `<a:${k}>${c(k)}</a:${k}>`).join('')
    + `<a:hlink>${c('accent1')}</a:hlink><a:folHlink>${c('accent2')}</a:folHlink></a:clrScheme>`
    + `<a:fontScheme name="${xml(name)}"><a:majorFont><a:latin typeface="${xml(font)}"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="${xml(font)}"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>`
    + `<a:fmtScheme name="${xml(name)}"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>`
    + `<a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="28575"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>`
    + `<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>`
    + `<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme>`
    + `</a:themeElements></a:theme>`;
}
const CLRMAP = '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>';
const EMPTY_TREE = '<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree>';
const MASTER = HEAD + `<p:sldMaster ${NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>${EMPTY_TREE}</p:cSld>${CLRMAP}<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>`;
const LAYOUT = HEAD + `<p:sldLayout ${NS} type="blank" preserve="1"><p:cSld name="Blank">${EMPTY_TREE}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;
const NOTES_MASTER = HEAD + `<p:notesMaster ${NS}><p:cSld>${EMPTY_TREE}</p:cSld>${CLRMAP}</p:notesMaster>`;

function packageFiles(slides, { title = '', lang = 'fr-FR', palette = {}, font = 'Arial', office = {}, w, h } = {}) {
  const files = {}, n = slides.length, withNotes = slides.some(s => s.notes);
  const built = slides.map((s, i) => slideXml(s, i + 1, lang, office));
  files['[Content_Types].xml'] = HEAD + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>`
    + `<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>`
    + `<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>`
    + `<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>`
    + `<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>`
    + (withNotes ? `<Override PartName="/ppt/notesMasters/notesMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml"/><Override PartName="/ppt/theme/theme2.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>` : '')
    + built.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('')
    + slides.map((s, i) => s.notes ? `<Override PartName="/ppt/notesSlides/notesSlide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>` : '').join('')
    + `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;
  files['_rels/.rels'] = rels([{ id: 'rId1', type: 'officeDocument', target: 'ppt/presentation.xml' },
    { id: 'rId2', type: 'metadata/core-properties', target: 'docProps/core.xml' }, { id: 'rId3', type: 'extended-properties', target: 'docProps/app.xml' }])
    .replace(`${REL}/metadata/core-properties`, 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties');
  files['docProps/core.xml'] = HEAD + `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${xml(title)}</dc:title><dc:creator>Jamespot Slides</dc:creator></cp:coreProperties>`;
  files['docProps/app.xml'] = HEAD + `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Jamespot Slides</Application><Slides>${n}</Slides></Properties>`;
  files['ppt/presentation.xml'] = HEAD + `<p:presentation ${NS} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rIdMaster"/></p:sldMasterIdLst>`
    + (withNotes ? '<p:notesMasterIdLst><p:notesMasterId r:id="rIdNotesMaster"/></p:notesMasterIdLst>' : '')
    + `<p:sldIdLst>${built.map((_, i) => `<p:sldId id="${256 + i}" r:id="rIdS${i + 1}"/>`).join('')}</p:sldIdLst>`
    + `<p:sldSz cx="${emu(w)}" cy="${emu(h)}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`;
  files['ppt/_rels/presentation.xml.rels'] = rels([{ id: 'rIdMaster', type: 'slideMaster', target: 'slideMasters/slideMaster1.xml' },
    { id: 'rIdTheme', type: 'theme', target: 'theme/theme1.xml' },
    ...(withNotes ? [{ id: 'rIdNotesMaster', type: 'notesMaster', target: 'notesMasters/notesMaster1.xml' }] : []),
    ...built.map((_, i) => ({ id: `rIdS${i + 1}`, type: 'slide', target: `slides/slide${i + 1}.xml` }))]);
  files['ppt/slideMasters/slideMaster1.xml'] = MASTER;
  files['ppt/slideMasters/_rels/slideMaster1.xml.rels'] = rels([{ id: 'rId1', type: 'slideLayout', target: '../slideLayouts/slideLayout1.xml' }, { id: 'rId2', type: 'theme', target: '../theme/theme1.xml' }]);
  files['ppt/slideLayouts/slideLayout1.xml'] = LAYOUT;
  files['ppt/slideLayouts/_rels/slideLayout1.xml.rels'] = rels([{ id: 'rId1', type: 'slideMaster', target: '../slideMasters/slideMaster1.xml' }]);
  files['ppt/theme/theme1.xml'] = themeXml(title || 'Jamespot Slides', palette, font);
  if (withNotes) {
    files['ppt/notesMasters/notesMaster1.xml'] = NOTES_MASTER;
    files['ppt/notesMasters/_rels/notesMaster1.xml.rels'] = rels([{ id: 'rId1', type: 'theme', target: '../theme/theme2.xml' }]);
    files['ppt/theme/theme2.xml'] = themeXml('Notes', palette, font);
  }
  built.forEach((b, i) => {
    files[`ppt/slides/slide${i + 1}.xml`] = b.body;
    files[`ppt/slides/_rels/slide${i + 1}.xml.rels`] = b.rels;
    for (const m of b.media) files[`ppt/media/${m.name}`] = m.png;
    if (slides[i].notes) { const nx = notesXml(slides[i].notes, i + 1, lang); files[`ppt/notesSlides/notesSlide${i + 1}.xml`] = nx.body; files[`ppt/notesSlides/_rels/notesSlide${i + 1}.xml.rels`] = nx.rels; }
  });
  return files;
}

/* ---------------------------------------------------------------- the export ---- */

/** Reads every screen of an open, motionless deck page and returns the .pptx buffer. `page` is a tools/cdp.mjs Page already
    sized to the layout, at the pictures' density (lib/jmd.mjs pptx() does both). `office`: the faces the file names. */
export async function pptxFromPage(page, { title = '', lang = 'fr', office = {} } = {}) {
  const n = await page.eval('jamesJmd.state.slides.length');
  await page.eval(`(() => { const st = document.createElement('style'); st.id = 'px-css'; document.head.appendChild(st); return true; })()`);
  const setLayer = (cls, css = LAYER_CSS) => page.eval(`(() => { document.getElementById('px-css').textContent = ${JSON.stringify(css)}; const h = document.documentElement.classList; [...h].filter(c => c.startsWith('px-')).forEach(c => h.remove(c)); ${JSON.stringify(cls)}.split(' ').filter(Boolean).forEach(c => h.add(c)); return true; })()`);
  await page.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
  const [innerW, innerH] = JSON.parse(await page.eval('JSON.stringify([innerWidth, innerHeight])'));
  const slides = [];
  for (let i = 0; i < n; i++) {
    await setLayer('');
    await page.eval(`jamesJmd.show(${i}); document.querySelectorAll('[data-px-box],[data-px-img],[data-px-keep]').forEach(e => { delete e.dataset.pxBox; delete e.dataset.pxImg; delete e.dataset.pxKeep; }); true`);
    await page.settle(60);
    const s = JSON.parse(await page.eval(`${READ}(${i})`));
    const clip = JSON.parse(await page.eval(`(r => JSON.stringify({ x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height }))(jamesJmd.state.slides[${i}].getBoundingClientRect())`));
    // a screen that fills the window is shot whole: Chrome paints a clipped shot of a CSS-zoomed page (the Story's zoom: 1.687)
    // at the wrong density; a Doc page, shown among others, is clipped out of the scroll as render() does
    const whole = Math.abs(clip.x) < 1 && Math.abs(clip.y) < 1 && Math.abs(clip.width - innerW) < 2 && Math.abs(clip.height - innerH) < 2;
    const shot = async () => Buffer.from((await page.send('Page.captureScreenshot', whole ? { format: 'png' } : { format: 'png', clip: { ...clip, scale: 1 }, captureBeyondViewport: false })).data, 'base64');
    const hasWm = await page.eval(`!!jamesJmd.state.slides[${i}].querySelector('.wm')`);
    if (hasWm) { await setLayer('px-shoot px-back'); await page.settle(30); s.back = await shot(); }
    await setLayer('px-shoot px-front'); await page.settle(30); s.front = await shot();
    for (let k = 0; k < s.images.length; k++) {
      await setLayer('px-img', LAYER_CSS.replace('${N}', k)); await page.settle(30);
      const im = s.images[k];
      s.images[k].png = Buffer.from((await page.send('Page.captureScreenshot', { format: 'png', clip: { x: clip.x + im.x, y: clip.y + im.y, width: im.w, height: im.h, scale: 1 }, captureBeyondViewport: false })).data, 'base64');
    }
    slides.push(s);
  }
  await setLayer('');
  await page.send('Emulation.setDefaultBackgroundColorOverride', {});
  const w = slides[0]?.w || 1280, h = slides[0]?.h || 720;
  const palette = JSON.parse(await page.eval(`(() => { const cs = getComputedStyle(document.documentElement), v = k => cs.getPropertyValue(k).trim(); return JSON.stringify({ primary: v('--brand-primary'), accent: v('--brand-accent'), ink: v('--jp-ink'), font: getComputedStyle(document.querySelector('.slide') || document.body).fontFamily }); })()`));
  const toHex = c => { const p = parseColor(c) || parseColor(cssHex(c)); return p ? hex(p) : null; };
  const pal = { dk1: toHex(palette.ink) || '1A1A2E', lt1: 'FFFFFF', dk2: toHex(palette.primary) || '1A1A2E', lt2: 'F4F4F8', accent1: toHex(palette.primary) || '7364E3', accent2: toHex(palette.accent) || 'FFC857', accent3: '4CB8A4', accent4: 'FF7B85', accent5: '5A8DEE', accent6: 'A0A0B0' };
  return writeZip(packageFiles(slides, { title, lang: officeLang(lang), palette: pal, font: office.face || face(palette.font), office, w, h }), { paths: true, deflate: true });
}

/** PowerPoint's proofing language: a deck says `lang: en`, Office wants a region. */
const REGION = { en: 'en-US', fr: 'fr-FR', de: 'de-DE', es: 'es-ES', it: 'it-IT', pt: 'pt-PT', nl: 'nl-NL' };
function officeLang(lang) { const l = String(lang || ''); return /^[a-z]{2}-[A-Z]{2}$/.test(l) ? l : REGION[l.slice(0, 2).toLowerCase()] || 'fr-FR'; }

function parseColor(c) {
  if (!c) return null;
  const m = /rgba?\(([^)]+)\)/.exec(c);
  if (!m) return null;
  const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
  return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
}
function cssHex(c) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(c).trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].replace(/./g, x => x + x) : m[1];
  return `rgb(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)})`;
}
