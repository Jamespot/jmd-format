/* The catalogue of open-licence typefaces (#83): faces a brand may name by their family alone — `font-display: Playfair Display`
   — and that the deck then carries, like Garet: @font-face rules with the woff2 inside as data URIs, nothing fetched when the
   deck is read, the deck's policy unchanged (`font-src data:`). Only the faces the brand names travel, never the catalogue.

   The files sit in themes/brands/fonts/catalogue/<id>/, each face with its licence (SIL OFL 1.1), fetched by
   tools/fontcatalogue.mjs from an npm package at an exact version, every file recorded with its sha256 in catalogue.json.
   They are ours, from the disk: no caller's word reaches a path here — a family is looked up by name in the manifest, and the
   file names come from the manifest alone.

   A .pptx names a face and never carries one (spec/export.md, "Fonts"): each face says which face every office suite has
   stands in for it there (`office`), and the card says it out loud. */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), '../themes/brands/fonts/catalogue');
let manifest = null;
/** The manifest, read once; an empty catalogue where the folder is absent (a tree that ships without it). */
export function catalogue() {
  if (!manifest) {
    const f = join(dir, 'catalogue.json');
    manifest = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')).faces : [];
  }
  return manifest;
}
/** The groups the card lists the faces in, in this order. */
export const FONT_GROUPS = ['sans', 'serif', 'display', 'mono'];
/** The family names of the catalogue, in the manifest's order. */
export const catalogueNames = () => catalogue().map(f => f.family);
/** A family as a brand writes it (any case, quoted or not) → its catalogue entry, or null. */
export function catalogueFace(name) {
  const n = String(name || '').trim().replace(/^['"]|['"]$/g, '').replace(/\s+/g, ' ').toLowerCase();
  return n ? catalogue().find(f => f.family.toLowerCase() === n) || null : null;
}
const cache = new Map();
/** One face's @font-face rules: one per file (weight × subset), each with its unicode-range, the woff2 as a data URI. */
export function faceCss(face) {
  if (cache.has(face.id)) return cache.get(face.id);
  const css = face.files.map(x => {
    const b64 = readFileSync(join(dir, face.id, x.file)).toString('base64');
    return `@font-face{font-family:'${face.family}';font-style:normal;font-weight:${x.weight};font-display:block;src:url(data:font/woff2;base64,${b64}) format('woff2');unicode-range:${x.range}}`;
  }).join('\n');
  cache.set(face.id, css);
  return css;
}
/** The catalogue faces a brand names (`font-display`, `font-body`), each once, unless its fonts CSS already declares it. */
export function brandCatalogueFaces(b, fontsCss = '') {
  const seen = new Set(), out = [];
  for (const k of ['font-display', 'font-body']) {
    const f = catalogueFace(b && b[k]);
    if (!f || seen.has(f.id)) continue;
    seen.add(f.id);
    if (new RegExp(`font-family:\\s*['"]?${f.family.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]?\\s*;`, 'i').test(fontsCss)) continue;
    out.push(f);
  }
  return out;
}
/** The face a .pptx names for a brand that says none: the stand-in of its catalogue face, else null (the caller's default). */
export const officeFor = b => (catalogueFace(b && b['font-display']) || catalogueFace(b && b['font-body']) || {}).office || null;
