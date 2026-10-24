'use strict';
/**
 * #6724: the records of a zip WRITER, for downloading a folder of an agent's Files as one file (Josh viewing a board
 * from another computer, where Finder opens on the far Mac). Built-ins only (package.json has no dependencies).
 *
 * What it writes, and why that shape:
 *   - STORED entries only (method 0). The size of every entry is then its file's size, known before the first byte,
 *     so the whole zip's length is known too (`zipLength`) and is sent as content-length: a file that changes size
 *     mid-download ends the connection instead of producing a zip that says one thing and holds another. Deflate would
 *     need the compressed sizes up front or data descriptors (bit 3), which some unzippers mishandle for stored data;
 *     an agent's Files are mostly PDFs and pictures, which do not compress.
 *   - UTF-8 names (general-purpose bit 11), `/`-separated, a folder as `name/` with no data.
 *   - No ZIP64: the caller caps a folder well under 4 GB and 65535 entries (refuse() below is the backstop).
 * The CRC-32 is the caller's (zlib.crc32 over the bytes it sends).
 */

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;
const FLAG_UTF8 = 0x0800;
const VERSION = 20;   // 2.0: folders and stored entries
const MADE_BY_UNIX = (3 << 8) | VERSION;
const LIMIT_32 = 0xffffffff;
const LIMIT_ENTRIES = 0xffff;

function refuse(message) { throw new RangeError('zipwrite: ' + message); }

/* MS-DOS time and date (local time, two-second steps), as unzippers read them. Before 1980 is 1980-01-01. */
function dosStamp(date) {
  const d = date instanceof Date && !isNaN(date) ? date : new Date();
  const year = d.getFullYear();
  if (year < 1980) return { time: 0, date: (1 << 5) | 1 };
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((Math.min(year, 2107) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

function nameBytes(name, isDir) {
  const n = String(name || '');
  if (!n || n.startsWith('/') || n.includes('\\') || n.includes('\0') || n.split('/').some((s) => s === '' || s === '.' || s === '..')) refuse('bad entry name');
  const b = Buffer.from(isDir ? n + '/' : n, 'utf8');
  if (b.length > 0xffff) refuse('entry name too long');
  return b;
}

/** The local header of one entry: `entry` is { name, isDir, size, crc, mtime, mode }. */
function localHeader(entry) {
  const name = nameBytes(entry.name, entry.isDir);
  const size = entry.isDir ? 0 : entry.size;
  if (!Number.isInteger(size) || size < 0 || size >= LIMIT_32) refuse('entry too large');
  const { time, date } = dosStamp(entry.mtime);
  const h = Buffer.alloc(30);
  h.writeUInt32LE(LOCAL, 0);
  h.writeUInt16LE(VERSION, 4);
  h.writeUInt16LE(FLAG_UTF8, 6);
  h.writeUInt16LE(0, 8);   // stored
  h.writeUInt16LE(time, 10);
  h.writeUInt16LE(date, 12);
  h.writeUInt32LE((entry.isDir ? 0 : entry.crc) >>> 0, 14);
  h.writeUInt32LE(size, 18);
  h.writeUInt32LE(size, 22);
  h.writeUInt16LE(name.length, 26);
  h.writeUInt16LE(0, 28);
  return Buffer.concat([h, name]);
}

/** The central directory record of one entry, which starts at `offset` in the zip. */
function centralRecord(entry, offset) {
  const name = nameBytes(entry.name, entry.isDir);
  const size = entry.isDir ? 0 : entry.size;
  if (!Number.isInteger(offset) || offset < 0 || offset >= LIMIT_32) refuse('zip too large');
  const { time, date } = dosStamp(entry.mtime);
  const mode = entry.isDir ? 0o040755 : 0o100644;   // a plain folder or file: never the source's own bits
  const r = Buffer.alloc(46);
  r.writeUInt32LE(CENTRAL, 0);
  r.writeUInt16LE(MADE_BY_UNIX, 4);
  r.writeUInt16LE(VERSION, 6);
  r.writeUInt16LE(FLAG_UTF8, 8);
  r.writeUInt16LE(0, 10);
  r.writeUInt16LE(time, 12);
  r.writeUInt16LE(date, 14);
  r.writeUInt32LE((entry.isDir ? 0 : entry.crc) >>> 0, 16);
  r.writeUInt32LE(size, 20);
  r.writeUInt32LE(size, 24);
  r.writeUInt16LE(name.length, 28);
  r.writeUInt16LE(0, 30);   // extra
  r.writeUInt16LE(0, 32);   // comment
  r.writeUInt16LE(0, 34);   // disk
  r.writeUInt16LE(0, 36);   // internal attributes
  r.writeUInt32LE(((mode << 16) | (entry.isDir ? 0x10 : 0)) >>> 0, 38);   // Unix mode, and MS-DOS's folder bit
  r.writeUInt32LE(offset, 42);
  return Buffer.concat([r, name]);
}

/** The end of central directory record. */
function endRecord(count, centralSize, centralOffset) {
  if (count > LIMIT_ENTRIES) refuse('too many entries');
  if (centralOffset + centralSize >= LIMIT_32) refuse('zip too large');
  const e = Buffer.alloc(22);
  e.writeUInt32LE(END, 0);
  e.writeUInt16LE(0, 4);
  e.writeUInt16LE(0, 6);
  e.writeUInt16LE(count, 8);
  e.writeUInt16LE(count, 10);
  e.writeUInt32LE(centralSize, 12);
  e.writeUInt32LE(centralOffset, 16);
  e.writeUInt16LE(0, 20);
  return e;
}

/** The exact length of the zip these entries make ({ name, isDir, size }), before a byte is written. */
function zipLength(entries) {
  let n = 22;
  for (const e of entries) {
    const len = nameBytes(e.name, e.isDir).length;
    n += 30 + len + (e.isDir ? 0 : e.size) + 46 + len;
  }
  return n;
}

module.exports = { localHeader, centralRecord, endRecord, zipLength, dosStamp, LIMIT_32, LIMIT_ENTRIES };
