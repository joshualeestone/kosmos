'use strict';
/**
 * A tiny zip WRITER for the win32zip and win32update suites, so every archive a test reads is
 * built in the test -- including the broken ones a real zip tool will not produce (a wrong CRC,
 * a lying size, a name that climbs out of its folder, a symlink, a zip64 marker, a local header
 * that disagrees with the table of contents, two entries sharing bytes).
 *
 * It writes the same shape Info-ZIP wrote for the real 0.6.55 build: Unix-made entries, no data
 * descriptors, stored (0) or deflate (8).
 *
 *   buildZip(entries, { zip64Locator, eocd })
 *
 * Each entry: `{ name, data, method }`, and optionally
 *   crc, declaredSize, compressedSize   the central directory's CRC and sizes
 *   local: { flags, crc, compressedSize, size }   the local header's, when they should disagree
 *   flags, unixMode, madeByHost, localName, noUtf8Flag
 *   centralOffset(offsets)              where the central record says the local header is, given
 *                                       the real offset of every earlier entry by name
 * `eocd` overrides the end record's { diskNumber, directoryDisk, entriesOnDisk, entryCount,
 * directorySize, directoryOffset }. Without an override everything is well formed.
 */
const zlib = require('node:zlib');

const DEFAULT_FILE_MODE = 0o100644;
const DEFAULT_DIRECTORY_MODE = 0o040755;
const HOST_UNIX = 3;
const DOS_DATE_1980_01_01 = 0x0021;
const pick = (value, fallback) => (value !== undefined ? value : fallback);

function buildZip(entries, options) {
  const o = options || {};
  const locals = [];
  const records = [];
  const offsets = {};
  let offset = 0;
  for (const e of entries) {
    const isDirectory = e.name.endsWith('/');
    const raw = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data === undefined ? '' : String(e.data), 'utf8');
    const method = pick(e.method, isDirectory ? 0 : 8);
    const body = method === 8 ? zlib.deflateRawSync(raw) : raw;
    const crc = pick(e.crc, zlib.crc32(raw) >>> 0);
    const size = pick(e.declaredSize, raw.length);
    const compressedSize = pick(e.compressedSize, body.length);
    const nameBytes = Buffer.from(e.name, 'utf8');
    const localNameBytes = Buffer.from(pick(e.localName, e.name), 'utf8');
    const utf8 = !e.noUtf8Flag && /[^\x00-\x7f]/.test(e.name) ? 0x0800 : 0;
    const flags = pick(e.flags, 0) | utf8;
    const l = e.local || {};

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(pick(l.flags, flags), 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(DOS_DATE_1980_01_01, 12);
    local.writeUInt32LE(pick(l.crc, crc), 14);
    local.writeUInt32LE(pick(l.compressedSize, compressedSize), 18);
    local.writeUInt32LE(pick(l.size, size), 22);
    local.writeUInt16LE(localNameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, localNameBytes, body);

    if (!(e.name in offsets)) offsets[e.name] = offset;
    records.push({ e, offset, flags, method, crc, size, compressedSize, nameBytes, isDirectory });
    offset += local.length + localNameBytes.length + body.length;
  }
  const centrals = [];
  for (const r of records) {
    const { e } = r;
    const mode = pick(e.unixMode, r.isDirectory ? DEFAULT_DIRECTORY_MODE : DEFAULT_FILE_MODE);
    const host = pick(e.madeByHost, HOST_UNIX);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((host << 8) | 30, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(r.flags, 8);
    central.writeUInt16LE(r.method, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(DOS_DATE_1980_01_01, 14);
    central.writeUInt32LE(r.crc, 16);
    central.writeUInt32LE(r.compressedSize, 20);
    central.writeUInt32LE(r.size, 24);
    central.writeUInt16LE(r.nameBytes.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE((mode << 16) >>> 0, 38);
    central.writeUInt32LE(e.centralOffset ? e.centralOffset(offsets) : r.offset, 42);
    centrals.push(central, r.nameBytes);
  }
  const directory = Buffer.concat(centrals);
  const tail = [];
  if (o.zip64Locator) {
    const locator = Buffer.alloc(20);
    locator.writeUInt32LE(0x07064b50, 0);
    locator.writeUInt32LE(1, 16);
    tail.push(locator);
  }
  const x = o.eocd || {};
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(pick(x.diskNumber, 0), 4);
  eocd.writeUInt16LE(pick(x.directoryDisk, 0), 6);
  eocd.writeUInt16LE(pick(x.entriesOnDisk, entries.length), 8);
  eocd.writeUInt16LE(pick(x.entryCount, entries.length), 10);
  eocd.writeUInt32LE(pick(x.directorySize, directory.length), 12);
  eocd.writeUInt32LE(pick(x.directoryOffset, offset), 16);
  tail.push(eocd);
  return Buffer.concat([...locals, directory, ...tail]);
}

module.exports = { buildZip };
