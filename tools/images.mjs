/* Image banks (spec/images.md): a brand declares `images: { <prefix>: <https folder> }`, a deck says `img:<prefix>/<slug>`, the build
   reads the bank's images.yaml, fetches the file and embeds it. No state here but a disposable cache; no bank known to the code.
   fetchBytes() is the one network door of this file (the SSRF guard of spec/security.md plugs in there). */
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { fetchAt } from './net.mjs';

export const REF = /^img:([a-z][a-z0-9-]*)\/([a-z0-9]+(?:-[a-z0-9]+)*)$/;
export const PREFIX = /^[a-z][a-z0-9-]*$/;
/** `up:<box>/<name>`: a file the user dropped in a box the agent opened (mcp/upload.mjs) — hosted only, read from JMD_UPLOADS_DIR. */
export const UPLOAD_REF = /^up:([A-Za-z0-9_-]{16})\/([a-z0-9][a-z0-9-]{0,63}\.(png|jpg|gif|webp|svg))$/;
export const uploadsDir = () => process.env.JMD_UPLOADS_DIR || null;
const INDEX_TTL = 10 * 60 * 1000, FILE_MAX = 2 * 1024 * 1024, INDEX_MAX = 4 * 1024 * 1024;
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml', gif: 'image/gif' };

/** The brand's banks, normalized: { prefix → base URL with a trailing slash }. `origin`: the brand.yaml URL, for relative bases. */
export function banks(brand, origin = null) {
  const out = {}, decl = brand && brand.images;
  if (!decl) return out;
  for (const [prefix, base] of Object.entries(decl)) {
    if (!PREFIX.test(prefix)) throw new Error(`brand images: "${prefix}" is not a bank prefix (letters, digits, dashes, starting with a letter)`);
    let url;
    if (/^https:\/\//.test(base) || (process.env.JMD_BRAND_HTTP && /^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(base))) url = base;
    else if (origin && (/^https:\/\//.test(origin) || (process.env.JMD_BRAND_HTTP && /^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(origin))) && !/^[a-z]+:/.test(base)) url = new URL(base, origin).href;
    else throw new Error(`brand images: "${prefix}: ${base}" — a bank is an https folder, or a path relative to a brand.yaml fetched by URL`);
    out[prefix] = url.endsWith('/') ? url : url + '/';
  }
  return out;
}

/** Bytes from an https URL, through the network door of tools/net.mjs (guard, pinned socket, one same-origin redirect, 10 s, capped). */
export async function fetchBytes(url, max = FILE_MAX) {
  const r = await fetchAt(url, max);
  return { bytes: r.body, type: (r.headers['content-type'] || '').split(';')[0].trim() };
}

/** What the bytes are, by their first bytes — never by the URL's extension nor the server's word: png, jpg, gif, webp, svg, or null. */
export function sniff(bytes) {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return 'image/gif';
  if (bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  const head = bytes.toString('utf8', 0, Math.min(bytes.length, 512)).replace(/^\uFEFF/, '').trimStart();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?<svg[\s>]/i.test(head)) return 'image/svg+xml';
  return null;
}

/* ---- cache: the index by base (ten minutes), files by URL (for good) ---- */
export const cacheDir = () => process.env.JMD_CACHE_DIR || join(homedir(), '.cache', 'jmd', 'images');
const key = s => createHash('sha256').update(s).digest('hex').slice(0, 32);
function cached(url, ttl) {
  const p = join(cacheDir(), key(url));
  try { const st = statSync(p); if (ttl && Date.now() - st.mtimeMs > ttl) return null; return readFileSync(p); } catch { return null; }
}
function store(url, bytes) { try { mkdirSync(cacheDir(), { recursive: true }); writeFileSync(join(cacheDir(), key(url)), bytes); } catch { } }
const memory = new Map(); // index per base, per process

/** The bank's images.yaml parsed: a list of flat entries (scalars and inline lists) — the only shape a bank's index has. */
export function parseIndex(text) {
  const out = []; let cur = null;
  const unq = s => (/^".*"$/.test(s) ? s.slice(1, -1).replace(/\\"/g, '"') : /^'.*'$/.test(s) ? s.slice(1, -1) : s);
  const set = (o, k, v) => { v = v.trim(); o[k] = v.startsWith('[') ? v.slice(1, v.lastIndexOf(']')).split(',').map(x => unq(x.trim())).filter(Boolean) : unq(v); };
  for (const raw of String(text).split('\n')) {
    const line = raw.replace(/\s+$/, ''); if (!line || line.startsWith('#') || line === '[]') continue;
    let m = /^- (\w+): (.*)$/.exec(line); if (m) { cur = {}; out.push(cur); set(cur, m[1], m[2]); continue; }
    m = /^  (\w+): (.*)$/.exec(line); if (m && cur) set(cur, m[1], m[2]);
  }
  return out.filter(e => e.slug && e.file);
}

/** The index of a bank: from memory, then the disk cache (ten minutes), then the network. */
export async function loadIndex(base) {
  const url = base + 'images.yaml';
  const mem = memory.get(url); if (mem && Date.now() - mem.at < INDEX_TTL) return mem.entries;
  let text = cached(url, INDEX_TTL);
  if (!text) { text = (await fetchBytes(url, INDEX_MAX)).bytes; store(url, text); }
  const entries = parseIndex(text.toString('utf8'));
  memory.set(url, { at: Date.now(), entries });
  return entries;
}

/** Every `img:` reference of a deck resolved against the brand's banks: { assets: { ref → data URI }, refused: { ref → why }, warnings: [{ ref, message }] }.
    `refs`: the deck's asset references (runtime JMD.assets). Nothing here throws for a bad reference: a refusal is a linter error, said in words. */
export async function resolveImages(refs, brandBanks) {
  const assets = {}, refused = {}, warnings = [];
  const wanted = [...new Set(refs.map(r => r.src).filter(s => /^(img:|up:|https?:\/\/)/.test(s)))];
  const indexes = {};
  for (const src of wanted) {
    if (/^up:/.test(src)) { // a dropped file: under the uploads folder or nowhere — the reference form is strict, no path can be built from it
      const m = UPLOAD_REF.exec(src), dir = uploadsDir();
      if (!m) { refused[src] = 'not a drop-box reference: up:<box>/<name.ext>, as jmd_upload listed it'; continue; }
      if (!dir) { refused[src] = 'drop boxes exist on the hosted connector only: use a file next to the .jmd'; continue; }
      const file = join(dir, m[1], m[2]);
      let bytes; try { bytes = readFileSync(file); } catch { refused[src] = `no file "${m[2]}" in this drop box (the box is unknown, gone after 24 h, or the file was never dropped — jmd_upload lists what it holds)`; continue; }
      const mime = sniff(bytes); if (!mime) { refused[src] = `"${m[2]}" is not an image`; continue; }
      assets[src] = `data:${mime};base64,${bytes.toString('base64')}`;
      continue;
    }
    if (/^https?:\/\//.test(src)) { // an image by URL (a file the host exposed, a public picture): fetched now, embedded, never left live in the deck
      let bytes = cached(src, 0), mime = bytes && sniff(bytes);
      if (!bytes) {
        try { const got = await fetchBytes(src, FILE_MAX); mime = sniff(got.bytes); if (!mime) throw new Error(`not an image (${got.type || 'no content type'})`); bytes = got.bytes; store(src, bytes); }
        catch (err) { refused[src] = `image by URL: ${err.message.replace(src + ': ', '')}`; continue; }
      }
      assets[src] = `data:${mime};base64,${bytes.toString('base64')}`;
      continue;
    }
    const m = REF.exec(src);
    if (!m) { refused[src] = 'not an image reference: img:<bank>/<slug>, lowercase, dashes'; continue; }
    const [, bank, slug] = m;
    if (!Object.keys(brandBanks).length) { refused[src] = 'no image bank declared by this brand (images: in its brand.yaml)'; continue; }
    if (!brandBanks[bank]) { refused[src] = `unknown bank "${bank}": this brand declares ${Object.keys(brandBanks).join(', ')}`; continue; }
    const base = brandBanks[bank];
    try { indexes[bank] ||= await loadIndex(base); } catch (e) { refused[src] = `bank "${bank}" unreachable: ${e.message}`; continue; }
    const e = indexes[bank].find(x => x.slug === slug);
    if (!e) { refused[src] = `no image "${slug}" in bank "${bank}" — search it (jmd_image_search) and pin a slug the bank has`; continue; }
    if (e.status === 'retired') { refused[src] = `"${slug}" is retired in bank "${bank}": pick another`; continue; }
    if (e.status === 'draft') warnings.push({ ref: src, message: `${src} is a draft in its bank, not approved yet` });
    const ext = (e.file.split('.').pop() || '').toLowerCase(), mime = MIME[ext];
    if (!mime) { refused[src] = `"${slug}": ${e.file} is not an image file`; continue; }
    const url = new URL(e.file, base).href;
    let bytes = cached(url, 0);
    if (!bytes) {
      try { const got = await fetchBytes(url, FILE_MAX); if (!sniff(got.bytes)) throw new Error(`${e.file} is not an image (${got.type || 'no content type'})`); bytes = got.bytes; store(url, bytes); }
      catch (err) { refused[src] = `"${slug}": ${err.message}`; continue; }
    }
    assets[src] = `data:${mime};base64,${bytes.toString('base64')}`;
  }
  return { assets, refused, warnings };
}

/** Lexical search over the brand's banks: every word of the query against slug, caption and tags (accents ignored); `kind` narrows.
    Returns the best `limit` entries with their `img:` reference and file URL — what an agent reads before pinning a slug. */
export async function searchImages(brandBanks, query, { kind = null, limit = 12 } = {}) {
  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const words = norm(query).split(/[^a-z0-9]+/).filter(w => w.length > 1);
  const hits = [];
  for (const [bank, base] of Object.entries(brandBanks)) {
    let entries; try { entries = await loadIndex(base); } catch (e) { hits.push({ bank, error: e.message }); continue; }
    for (const e of entries) {
      if ((e.status || 'approved') === 'retired' || (kind && e.kind !== kind)) continue;
      const slug = norm(e.slug), cap = norm(e.caption), tags = (Array.isArray(e.tags) ? e.tags : []).map(norm), kindWord = norm(e.kind);
      let score = 0;
      for (const w of words) {
        if (kindWord && (w === kindWord || w === kindWord + 's')) score += 2; // "logo client": the kind is a word of the query, no `kind` argument needed
        if (tags.some(t => t === w)) score += 3; else if (tags.some(t => t.includes(w))) score += 2;
        if (slug.includes(w)) score += 2;
        if (cap.includes(w)) score += 1;
      }
      if (words.length && score === 0) continue;
      if (!words.length) score = 1;
      hits.push({ ref: `img:${bank}/${e.slug}`, bank, slug: e.slug, caption: e.caption, tags: e.tags || [], kind: e.kind, fit: e.fit || [], status: e.status || 'approved', url: new URL(e.file, base).href, origin: e.origin, score });
    }
  }
  const errors = hits.filter(h => h.error), found = hits.filter(h => !h.error).sort((a, b) => b.score - a.score || a.slug.localeCompare(b.slug)).slice(0, limit);
  return { hits: found, errors };
}

/** `jmd vendor`: the `img:` and `https://` images of a deck copied next to it (assets/<bank>/<slug>.<ext>, assets/url/<name>.<ext>)
    and the source rewritten to those paths. */
export async function vendor(jmd, refs, brandBanks, dir) {
  const { assets, refused } = await resolveImages(refs, brandBanks);
  let src = jmd; const written = [];
  for (const [ref, dataUri] of Object.entries(assets)) {
    const mime = /^data:([^;]+);/.exec(dataUri)[1], ext = Object.keys(MIME).find(k => MIME[k] === mime) || 'bin';
    const m = REF.exec(ref);
    const u = UPLOAD_REF.exec(ref);
    const bank = m ? m[1] : u ? 'drop' : 'url', slug = m ? m[2] : u ? u[2].replace(/\.[^.]*$/, '') : ((new URL(ref).pathname.split('/').pop() || '').replace(/\.[^.]*$/, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/^-|-$/g, '') || 'image') + '-' + key(ref).slice(0, 8);
    const rel = `assets/${bank}/${slug}.${ext}`;
    mkdirSync(join(dir, 'assets', bank), { recursive: true });
    writeFileSync(join(dir, rel), Buffer.from(dataUri.slice(dataUri.indexOf(',') + 1), 'base64'));
    src = src.split('(' + ref + ')').join('(' + rel + ')'); written.push(rel);
  }
  return { jmd: src, written, refused };
}
