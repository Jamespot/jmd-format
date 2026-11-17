/* Stock photos (spec/images.md, « Stock photos — Pixabay »): what no bank of the brand has, a photo bank on the web has. One source,
   Pixabay — key issued at once with an account, numeric ids that fit `img:pixabay/<id>`, French queries and French tags, a license
   that asks no credit (we keep one anyway). Pexels was the first choice (2026-09-20) and stopped issuing keys (2026-11-17).
   On by default for every look once the server has a key (Alain, 2026-11-17: « partout, coupable »); a brand turns it off with
   `images: { stock: off }`.

   What it never does: send the key anywhere but to the API's own host, nor let it out in a message (Pixabay takes it in the URL,
   so every error is scrubbed of it); fetch a file from any host but Pixabay's; take an id that is not digits; embed bytes that are
   not a JPEG or a PNG. The built deck holds the bytes, as every image: it loads nothing from Pixabay when it is opened (Pixabay
   forbids hotlinking its files, and a deck must not depend on a site). */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fetchAt } from './net.mjs';
import { sniff, cacheDir } from './images.mjs';

export const STOCK_BANK = 'pixabay';
export const STOCK_ID = /^[1-9][0-9]{0,11}$/; // Pixabay ids are numbers; anything else — `../`, a word, 10 000 digits — is no id
const FILE_MAX = 2 * 1024 * 1024, API_MAX = 512 * 1024, SEARCH_TTL = 24 * 60 * 60 * 1000, PER_QUERY = 3; // Pixabay asks for 24 h of cache
/* The two places, fixed. The environment may move them for the suite (a local fake under JMD_BRAND_HTTP), never a caller. */
const api = () => process.env.JMD_PIXABAY_API || 'https://pixabay.com/api/';
const imageOrigin = () => new URL(process.env.JMD_PIXABAY_IMAGES || 'https://pixabay.com/').origin;
const key = () => (process.env.PIXABAY_API_KEY || '').trim();
const scrub = s => { const k = key(); return k ? String(s).split(k).join('…') : String(s); };

/** Stock is on for this brand: the server has a key and the brand did not say `images: { stock: off }`. */
export function stockOn(brand) {
  if (!key()) return false;
  const v = brand && brand.images && brand.images.stock;
  return !(v !== undefined && /^(off|no|false|0)$/i.test(String(v).trim()));
}

async function apiGet(params) {
  let r; try { r = await fetchAt(`${api()}?key=${encodeURIComponent(key())}&${params}`, API_MAX); }
  catch (e) { throw new Error(scrub(e.message).replace(/^\S+: /, '')); }
  try { return JSON.parse(r.text); } catch { throw new Error('the photo service answered something that is not JSON'); }
}
/* A hit of the API, reduced to what we keep: never the API's word for what a URL is — only an https URL on the image host. */
function photoOf(p) {
  if (!p || !STOCK_ID.test(String(p.id))) return null;
  let u; try { u = new URL(String(p.largeImageURL || p.webformatURL)); } catch { return null; }
  if (u.origin !== imageOrigin()) return null;
  const clip = (s, n) => String(s || '').replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
  const tags = [...new Set(String(p.tags || '').split(',').map(t => clip(t, 40)).filter(Boolean))].slice(0, 8);
  return { id: String(p.id), file: u.href, tags, photographer: clip(p.user, 80), page: /^https:\/\/pixabay\.com\//.test(String(p.pageURL || '')) ? String(p.pageURL) : '', width: +p.imageWidth || 0, height: +p.imageHeight || 0 };
}

const searches = new Map(); // query → { at, photos }: Pixabay asks that a search be kept 24 h, and an agent asks the same words twice
/** The best few stock photos for a query: [{ ref, bank, caption, tags, photographer, url, page, kind: 'photo', fit }]. Throws on a service error. */
export async function searchStock(query, { orientation = 'landscape', limit = PER_QUERY } = {}) {
  const q = String(query || '').replace(/\s+/g, ' ').trim().slice(0, 100);
  if (!q || !key()) return [];
  const id = `${orientation}|${q.toLowerCase()}`, mem = searches.get(id);
  let photos = mem && Date.now() - mem.at < SEARCH_TTL ? mem.photos : null;
  if (!photos) {
    const j = await apiGet(`q=${encodeURIComponent(q)}&lang=fr&image_type=photo&safesearch=true&per_page=${PER_QUERY * 2}&orientation=${orientation === 'portrait' ? 'vertical' : 'horizontal'}`);
    photos = (Array.isArray(j.hits) ? j.hits : []).map(photoOf).filter(Boolean);
    searches.set(id, { at: Date.now(), photos });
    if (searches.size > 500) searches.delete(searches.keys().next().value);
  }
  return photos.slice(0, limit).map(p => ({
    ref: `img:${STOCK_BANK}/${p.id}`, bank: STOCK_BANK, slug: p.id, caption: p.tags.join(', ') || q, tags: p.tags, photographer: p.photographer, page: p.page,
    url: p.page || p.file, kind: 'photo', fit: p.width && p.height && p.height > p.width ? ['right'] : ['cover', 'right', 'wide'], status: 'stock',
  }));
}

const metaPath = id => join(cacheDir(), 'pixabay-' + createHash('sha256').update(id).digest('hex').slice(0, 24));
/** One stock photo's bytes, for the build: { mime, bytes, credit } — from the cache when it was fetched once (a deck rebuilt without a key
    still finds its photo), else the API by id, then the file from the image host. Throws with a sentence. */
export async function stockPhoto(id) {
  if (!STOCK_ID.test(String(id))) throw new Error('not a stock photo id (digits only)');
  const p = metaPath(id);
  try { const bytes = readFileSync(p + '.bin'), meta = JSON.parse(readFileSync(p + '.json', 'utf8')), mime = sniff(bytes); if (mime) return { mime, bytes, credit: meta.credit || '' }; } catch { }
  if (!key()) throw new Error('stock photos are not set up on this server (no Pixabay key)');
  const j = await apiGet(`id=${id}`).catch(e => { throw new Error(/HTTP 400/.test(e.message) ? `no photo ${id} at Pixabay` : `the photo service: ${e.message}`); });
  const hit = Array.isArray(j.hits) ? j.hits[0] : null;
  if (!hit) throw new Error(`no photo ${id} at Pixabay`);
  const photo = photoOf(hit);
  if (!photo || photo.id !== String(id)) throw new Error(`photo ${id}: the photo service gave no file on its image host`);
  let got; try { got = await fetchAt(photo.file, FILE_MAX); } catch (e) { throw new Error(`photo ${id}: ${scrub(e.message).replace(/^\S+: /, '')}`); }
  const mime = sniff(got.body);
  if (mime !== 'image/jpeg' && mime !== 'image/png') throw new Error(`photo ${id} is not a JPEG or a PNG`);
  const credit = photo.photographer ? `Photo : ${photo.photographer} / Pixabay` : 'Photo : Pixabay';
  try { mkdirSync(cacheDir(), { recursive: true }); writeFileSync(p + '.bin', got.body); writeFileSync(p + '.json', JSON.stringify({ id, credit, page: photo.page })); } catch { }
  return { mime, bytes: got.body, credit };
}
