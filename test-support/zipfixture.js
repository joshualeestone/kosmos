'use strict';
/**
 * A tiny zip WRITER for the win32zip and win32update suites, so every archive a test reads is
 * built in the test -- including the broken ones a real zip tool will not produce (a wrong CRC,
 * a lying size, a name that climbs out of its folder, a symlink, a zip64 marker).
 *
 * It writes the same shape Info-ZIP wrote for the real 0.6.55 build: Unix-made entries, no data
 * descriptors, stored (0) or deflate (8).
 *
 *   buildZip([{ name, data, method, crc, declaredSize, unixMode, flags, localName, madeByHost }], { zip64Locator })
 *
 * Every override is optional; without one the entry is well formed.
 */
const zlib = require('node:zlib');

const DEFAULT_FILE_MODE = 0o100644;
const DEFAULT_DIRECTORY_MODE = 0o040755;
const HOST_UNIX = 3;
const DOS_DATE_1980_01_01 = 0x0021;

function buildZip(entries, options) {
  const o = options || {};
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const e of entries) {
    const isDirectory = e.name.endsWith('/');
    const raw = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data === undefined ? '' : String(e.data), 'utf8');
    const method = e.method !== undefined ? e.method : (isDirectory ? 0 : 8);
    const body = method === 8 ? zlib.deflateRawSync(raw) : raw;
    const crc = e.crc !== undefined ? e.crc : (zlib.crc32(raw) >>> 0);
    const size = e.declaredSize !== undefined ? e.declaredSize : raw.length;
    const nameBytes = Buffer.from(e.name, 'utf8');
    const localNameBytes = Buffer.from(e.localName !== undefined ? e.localName : e.name, 'utf8');
    const utf8 = /[^\x00-\x7f]/.test(e.name) ? 0x0800 : 0;
    const flags = (e.flags !== undefined ? e.flags : 0) | utf8;
    const mode = e.unixMode !== undefined ? e.unixMode : (isDirectory ? DEFAULT_DIRECTORY_MODE : DEFAULT_FILE_MODE);
    const host = e.madeByHost !== undefined ? e.madeByHost : HOST_UNIX;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(DOS_DATE_1980_01_01, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(localNameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, localNameBytes, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((host << 8) | 30, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(DOS_DATE_1980_01_01, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE((mode << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);

    offset += local.length + localNameBytes.length + body.length;
  }
  const directory = Buffer.concat(centrals);
  const tail = [];
  if (o.zip64Locator) {
    const locator = Buffer.alloc(20);
    locator.writeUInt32LE(0x07064b50, 0);
    locator.writeUInt32LE(1, 16);
    tail.push(locator);
  }
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(directory.length, 12);
  eocd.writeUInt32LE(offset, 16);
  tail.push(eocd);
  return Buffer.concat([...locals, directory, ...tail]);
}

module.exports = { buildZip };
