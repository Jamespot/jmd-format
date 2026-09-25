/* The network door of JMD (spec/security.md §3). Everything the server fetches on a caller's word — a brand.yaml by URL, a bank's
   images.yaml, a bank image, an https image named in a deck — comes through fetchAt(): https only (http and loopback for tests, under
   JMD_BRAND_HTTP), the host resolved and refused when any address is private, the socket pinned to the vetted address, one redirect
   within the same origin, ten seconds, a body cut at `max` bytes mid-stream. */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';

/** A fetch from the server never joins the network's inside (spec/security.md §3): the host is resolved first and refused when any
    of its addresses is loopback, link-local (the cloud metadata endpoint lives there), private, CGNAT or unique-local; one redirect
    is followed, to the same scheme and host only. JMD_BRAND_HTTP (tests) also allows http and loopback.
    Returns { body (Buffer), text, headers, url } — the brand file, a bank index, a bank image, an https image of a deck: one door. */
export async function fetchAt(url, max, hop = 0) {
  if (!/^https:\/\//.test(url) && !(process.env.JMD_BRAND_HTTP && /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(url))) throw new Error(`${url}: https only`);
  const pinned = await assertPublicHost(url); // the addresses the guard vetted: the socket connects to one of them, never to a second resolution
  const r = await requestOnce(url, pinned, max);
  if (r.status >= 300 && r.status < 400 && r.headers.location) {
    const to = new URL(r.headers.location, url), from = new URL(url);
    if (hop > 0) throw new Error(`${url}: too many redirects`);
    if (to.protocol !== from.protocol || to.host !== from.host) throw new Error(`${url}: redirects to ${to.origin} — a fetch may only redirect within its own origin`);
    return fetchAt(to.href, max, hop + 1);
  }
  if (r.status < 200 || r.status >= 300) throw new Error(`${url}: HTTP ${r.status}`);
  if (r.body.length > max) throw new Error(`${url}: larger than ${max} bytes`);
  return { body: r.body, get text() { return r.body.toString('utf8'); }, headers: r.headers, url };
}
/** One HTTP(S) request whose socket goes to `pinned[0]` (the address the guard checked) while TLS still verifies the certificate against
    the hostname (servername): a DNS answer that changes between the check and the connection changes nothing. Body capped at `max`. */
export function requestOnce(url, pinned, max) {
  const u = new URL(url), https = u.protocol === 'https:';
  const { address, family } = pinned[0];
  return new Promise((resolve, reject) => {
    const req = (https ? httpsRequest : httpRequest)(u, {
      method: 'GET', headers: { accept: '*/*', 'user-agent': 'jmd' }, timeout: 10_000,
      lookup: (_host, opts, cb) => (opts && opts.all) ? cb(null, [{ address, family }]) : cb(null, address, family),
    }, res => {
      const chunks = []; let size = 0, cut = false;
      res.on('data', c => { if (cut) return; size += c.length; if (size > max) { cut = true; reject(new Error(`${url}: larger than ${max} bytes`)); res.destroy(); return; } chunks.push(c); });
      res.on('end', () => { if (!cut) resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }); });
      res.on('error', e => { if (!cut) reject(e); }); // after a cut, the stream's own error is noise
    });
    req.on('timeout', () => req.destroy(new Error(`${url}: timed out`)));
    req.on('error', e => reject(e)); req.end();
  });
}
/** Refuses a URL whose host resolves (or is) a private address; returns the vetted addresses for the connection to pin. */
export async function assertPublicHost(url) {
  const { hostname } = new URL(url);
  const host = hostname.replace(/^\[|\]$/g, '');
  const addrs = isIP(host) ? [{ address: host, family: isIP(host) }] : await lookup(host, { all: true }).catch(() => { throw new Error(`${url}: host not found`); });
  if (!addrs.length) throw new Error(`${url}: host not found`);
  for (const { address } of addrs) if (isPrivateAddress(address)) { if (process.env.JMD_BRAND_HTTP && /^(127\.|::1$|::ffff:7f)/.test(address)) continue; throw new Error(`${url}: ${address} is a private address, refused`); }
  return addrs;
}
/** An IPv6 address as 8 groups of 16 bits, or null: handles `::`, and a dotted IPv4 tail (`::ffff:127.0.0.1`). */
function v6Groups(ip) {
  let s = ip.toLowerCase(); const zone = s.indexOf('%'); if (zone >= 0) s = s.slice(0, zone);
  const dotted = /^(.*:)(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(s);
  if (dotted) { const [, head, a, b, c, d] = dotted; s = head + ((+a << 8) | +b).toString(16) + ':' + ((+c << 8) | +d).toString(16); }
  const halves = s.split('::'); if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [], right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  if (halves.length === 1 && left.length !== 8) return null;
  const groups = [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right];
  if (groups.length !== 8 || groups.some(g => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map(g => parseInt(g, 16));
}
function isPrivateV4(a, b) {
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}
/** Loopback, unspecified, link-local, unique-local, multicast, RFC 1918, CGNAT — in IPv4, in IPv6, and in every IPv6 form that carries an
    IPv4 (mapped ::ffff:0:0/96 in hex or dotted form, NAT64 64:ff9b::/96 and 64:ff9b:1::/48, 6to4 2002::/16): the URL parser rewrites
    `[::ffff:127.0.0.1]` as `[::ffff:7f00:1]`, so the hex forms are the ones that reach the guard. */
export function isPrivateAddress(ip) {
  if (isIP(ip) === 4) { const [a, b] = ip.split('.').map(Number); return isPrivateV4(a, b); }
  const g = v6Groups(ip); if (!g) return true; // not an address we can read: never let it through
  const v4 = (hi, lo) => isPrivateV4(hi >> 8, hi & 255) || (hi === 0 && lo === 0);
  if (g.slice(0, 5).every(x => x === 0) && g[5] === 0xffff) return v4(g[6], g[7]);      // ::ffff:a.b.c.d
  if (g.slice(0, 6).every(x => x === 0)) return true;                                  // :: and ::1, and the deprecated ::a.b.c.d
  if (g[0] === 0x64 && g[1] === 0xff9b && (g[2] === 0 || g[2] === 1)) return v4(g[6], g[7]); // NAT64
  if (g[0] === 0x2002) return v4(g[1], g[2]);                                          // 6to4
  if (g[0] === 0x2001 && g[1] === 0) return true;                                      // Teredo: the server and client addresses are embedded, obfuscated — refuse the whole prefix
  const top = g[0] >> 8;
  return top === 0xfc || top === 0xfd || (g[0] & 0xffc0) === 0xfe80 || top === 0xff;
}
