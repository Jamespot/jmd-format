/* A minimal ZIP reader — enough for Office files (.pptx, .docx): stored or DEFLATE entries, read from the central directory.
   Zero dependencies: node's zlib inflates DEFLATE. No ZIP64, no encryption (Office never writes them).
   The bytes may come from outside (a .pptx dropped in a box): a truncated or lying directory is "not a zip file", an entry is
   inflated to ENTRY_MAX at most and a zip to TOTAL_MAX at most over its life — a bomb stops at the cap, in words. */
import { inflateRawSync, crc32 } from 'node:zlib';

export const ENTRY_MAX = 32 * 1024 * 1024, TOTAL_MAX = 256 * 1024 * 1024;
const tooBig = name => Object.assign(new Error(`${name}: entry too large (${ENTRY_MAX >> 20} MB at most)`), { code: 'ZIP_TOO_LARGE' });

export function readZip(buf, { entryMax = ENTRY_MAX, totalMax = TOTAL_MAX } = {}) {
  const entries = new Map();
  try {
    // end of central directory: signature 0x06054b50, searched backwards (the comment may follow it)
    let eocd = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
      if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('no directory');
    const count = buf.readUInt16LE(eocd + 10);
    let p = buf.readUInt32LE(eocd + 16);
    for (let n = 0; n < count; n++) {
      if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central directory');
      const method = buf.readUInt16LE(p + 10);
      const csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
      const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
      const offset = buf.readUInt32LE(p + 42);
      if (offset + 30 > buf.length) throw new Error('entry beyond the file');
      const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
      entries.set(name, { method, csize, usize, offset });
      p += 46 + nameLen + extraLen + commentLen;
    }
  } catch { throw new Error('not a zip file'); }
  let inflated = 0;
  function read(name) {
    const e = entries.get(name);
    if (!e) return null;
    if (e.usize > entryMax) throw tooBig(name);
    // local header: skip its own name/extra lengths (they can differ from the central ones)
    const q = e.offset;
    if (buf.readUInt32LE(q) !== 0x04034b50) throw new Error('bad local header for ' + name);
    const nameLen = buf.readUInt16LE(q + 26), extraLen = buf.readUInt16LE(q + 28);
    const start = q + 30 + nameLen + extraLen;
    if (start + e.csize > buf.length) throw new Error('entry beyond the file: ' + name);
    const data = buf.subarray(start, start + e.csize);
    let out;
    if (e.method === 0) out = Buffer.from(data);
    else if (e.method === 8) { try { out = inflateRawSync(data, { maxOutputLength: entryMax }); } catch (err) { if (err && err.code === 'ERR_BUFFER_TOO_LARGE') throw tooBig(name); throw err; } }
    else throw new Error('unsupported compression ' + e.method + ' for ' + name);
    inflated += out.length; // the directory's `usize` is a claim; what came out is the fact
    if (out.length > entryMax || inflated > totalMax) throw tooBig(name);
    return out;
  }
  return { names: [...entries.keys()], has: n => entries.has(n), read, text: n => { const b = read(n); return b ? b.toString('utf8') : null; } };
}

/* The writer, in *store* mode only (spec/export.md): what we zip is PNGs, already compressed — deflating them costs CPU to
   save nothing. No dependency: `zlib.crc32` is in Node 22. No ZIP64 either, and that is a ceiling we say out loud — a member
   over 4 GB, or more than 65 535 of them, is refused rather than written as a file no reader would open. Names are ours
   (`<slug>-01.png`), never a caller's path: a name with a separator or a `..` in it is refused here too, because a zip is a
   folder someone will unpack. */
export const ZIP_MEMBER_MAX = 0xffffffff, ZIP_MEMBERS_MAX = 0xffff;
const NAME_OK = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

export function writeZip(files) {
  const names = Object.keys(files);
  if (names.length > ZIP_MEMBERS_MAX) throw new Error(`too many files for a zip without ZIP64 (${ZIP_MEMBERS_MAX} at most)`);
  const parts = [], dir = [];
  let at = 0;
  for (const name of names) {
    if (!NAME_OK.test(name)) throw new Error(`${name}: a zip member is a plain name, no path, no separator`);
    const body = Buffer.isBuffer(files[name]) ? files[name] : Buffer.from(files[name]);
    if (body.length > ZIP_MEMBER_MAX) throw new Error(`${name}: too large for a zip without ZIP64`);
    const nm = Buffer.from(name, 'utf8'), crc = crc32(body);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(1 << 11, 6); // 2.0, names are UTF-8
    local.writeUInt16LE(0, 8); local.writeUInt16LE(0, 10); local.writeUInt16LE(0x21, 12);            // stored; a fixed moment, not the clock
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(body.length, 22);
    local.writeUInt16LE(nm.length, 26); local.writeUInt16LE(0, 28);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt16LE(1 << 11, 8);
    entry.writeUInt16LE(0, 10); entry.writeUInt16LE(0, 12); entry.writeUInt16LE(0x21, 14);
    entry.writeUInt32LE(crc, 16); entry.writeUInt32LE(body.length, 20); entry.writeUInt32LE(body.length, 24);
    entry.writeUInt16LE(nm.length, 28); entry.writeUInt32LE(at, 42);
    parts.push(local, nm, body); dir.push(entry, nm);
    at += 30 + nm.length + body.length;
  }
  const central = Buffer.concat(dir), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(names.length, 8); end.writeUInt16LE(names.length, 10);
  end.writeUInt32LE(central.length, 12); end.writeUInt32LE(at, 16);
  return Buffer.concat([...parts, central, end]);
}
