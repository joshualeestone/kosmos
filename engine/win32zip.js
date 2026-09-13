'use strict';
/**
 * A minimal zip reader for the Windows updater (engine/win32update.js), on Node built-ins only.
 *
 * 🛑 IT UNPACKS A FILE FROM THE NETWORK INTO THE FOLDER KOSMOS RUNS FROM, so it refuses far more
 * than it accepts. The archive's sha-256 has already matched the channel pointer and its sidecar
 * by the time this runs, so these refusals are not the trust boundary; they stop one damaged or
 * mis-built archive from writing outside the staging folder, or writing names Windows would read
 * as something else.
 *
 * What a real Kosmos zip is (measured on the 0.6.55 build, 37 MB, 139 entries, made by Info-ZIP
 * on a Mac): methods 0 (stored) and 8 (deflate) only, general-purpose flags all 0 (no data
 * descriptors, no encryption), no zip64 records, Unix-made entries with directory entries
 * present, seven top-level names, and every name plain printable ASCII. So this reads exactly
 * that shape and refuses the rest, zip64 included: the whole archive is far under the 4 GB where
 * zip64 would be needed.
 *
 * Everything is decided from the CENTRAL DIRECTORY, and each local header is checked against it
 * (name, method, flags, and CRC and sizes when they are not deferred to a data descriptor), so
 * another unzipper -- Explorer's Extract All reads the local headers -- cannot unpack a different
 * tree from the one this stages.
 */

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const SIGNATURE_END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const SIGNATURE_ZIP64_LOCATOR = 0x07064b50;
const SIGNATURE_CENTRAL_HEADER = 0x02014b50;
const SIGNATURE_LOCAL_HEADER = 0x04034b50;
const END_OF_CENTRAL_DIRECTORY_BYTES = 22;
const ZIP64_LOCATOR_BYTES = 20;
const MAX_ARCHIVE_COMMENT_BYTES = 0xffff;
const CENTRAL_HEADER_BYTES = 46;
const LOCAL_HEADER_BYTES = 30;

const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;

/* General-purpose flag bits this reader refuses: traditional encryption, strong encryption, and
   a masked central directory. Bit 3 (CRC and sizes in a data descriptor after the data) is
   harmless here because they come from the central directory, and bit 11 (UTF-8 names) is read. */
const FLAG_ENCRYPTED = 0x0001;
const FLAG_DATA_DESCRIPTOR = 0x0008;
const FLAG_STRONG_ENCRYPTION = 0x0040;
const FLAG_MASKED_DIRECTORY = 0x2000;
const FLAG_UTF8_NAMES = 0x0800;
const REFUSED_FLAGS = FLAG_ENCRYPTED | FLAG_STRONG_ENCRYPTION | FLAG_MASKED_DIRECTORY;

/* A Unix-made entry carries its st_mode in the high 16 bits of the external attributes. A symlink
   entry would make the extractor write a LINK, whose target the name checks never see. */
const HOST_UNIX = 3;
const UNIX_FILE_TYPE_MASK = 0o170000;
const UNIX_SYMLINK = 0o120000;

/* The field values that mean "look in the zip64 record instead". */
const ZIP64_MARKER_16 = 0xffff;
const ZIP64_MARKER_32 = 0xffffffff;

/* Names Windows maps to devices whatever folder they are in, with any extension, and with spaces
   before the extension (`con .txt` is still the console). Checked per path segment. */
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[0-9\xb9\xb2\xb3]|lpt[0-9\xb9\xb2\xb3]|conin\$|conout\$|clock\$) *(\..*)?$/i;
/* Characters Windows cannot store in a file name. `\` and `:` are refused separately, with their
   own sentences, because each is a known trick rather than a mere impossibility. */
const WINDOWS_FORBIDDEN_CHARACTERS = /[<>"|?*]/;
const CONTROL_CHARACTERS = /[\x00-\x1f\x7f]/;
/* Every name in a Kosmos build is plain printable ASCII. Anything else -- a right-to-left
   override, a zero-width space, a letter NTFS folds to another letter's case -- is a name that
   can look like, or land on, a different one. */
const NOT_PRINTABLE_ASCII = /[^\x20-\x7e]/;
/* An 8.3 short name (`AVERYL~1.TXT`) can name, on a volume with short names on, a file or folder
   written a moment earlier under its long name. No name in a Kosmos build has `~` then a digit
   (engine/win32update.test.js checks what the build stages). */
const SHORT_NAME_ALIAS = /~\d/;

class ZipRefusal extends Error {
  constructor(message) { super(message); this.name = 'ZipRefusal'; }
}
function refuse(message) { throw new ZipRefusal(message); }
function quoted(name) { return JSON.stringify(name); }

function requireLimits(limits) {
  const l = limits || {};
  if (!Array.isArray(l.allowedTopLevel) || l.allowedTopLevel.length === 0) {
    throw new TypeError('win32zip: allowedTopLevel is required, so no caller can unpack an archive without naming what it may contain');
  }
  for (const key of ['maxEntries', 'maxEntryBytes', 'maxTotalBytes']) {
    if (!(Number.isFinite(l[key]) && l[key] > 0)) throw new TypeError(`win32zip: ${key} is required and must be a positive number`);
  }
  return l;
}

/**
 * The checks on one entry name. Returns the name's path segments; throws a ZipRefusal naming the
 * entry and the rule it broke.
 */
function checkEntryName(name, allowedTopLevel) {
  if (!name) refuse('the archive has an entry with no name');
  if (name.includes('\\')) refuse(`the archive entry ${quoted(name)} uses a backslash, which Windows would read as a folder separator`);
  if (name.includes(':')) refuse(`the archive entry ${quoted(name)} contains a colon, which Windows reads as a drive letter or a hidden data stream`);
  if (CONTROL_CHARACTERS.test(name)) refuse(`the archive entry ${quoted(name)} contains a control character`);
  if (NOT_PRINTABLE_ASCII.test(name)) refuse(`the archive entry ${quoted(name)} is not plain printable ASCII, which every name in a Kosmos build is`);
  if (name.startsWith('/')) refuse(`the archive entry ${quoted(name)} is an absolute path`);
  const body = name.endsWith('/') ? name.slice(0, -1) : name;
  const segments = body.split('/');
  for (const segment of segments) {
    if (segment === '') refuse(`the archive entry ${quoted(name)} has an empty folder name in it`);
    if (segment === '.' || segment === '..') refuse(`the archive entry ${quoted(name)} climbs out of its folder with ${quoted(segment)}`);
    /* Windows drops trailing dots and spaces, so `app.` and `app ` would land on `app`. */
    if (/[. ]$/.test(segment)) refuse(`the archive entry ${quoted(name)} has a name ending in a dot or a space, which Windows would silently change`);
    if (WINDOWS_RESERVED_NAME.test(segment)) refuse(`the archive entry ${quoted(name)} uses ${quoted(segment)}, which Windows reserves for a device`);
    if (WINDOWS_FORBIDDEN_CHARACTERS.test(segment)) refuse(`the archive entry ${quoted(name)} contains a character Windows cannot store in a file name`);
    if (SHORT_NAME_ALIAS.test(segment)) refuse(`the archive entry ${quoted(name)} looks like a Windows short name, which can stand for a different file`);
  }
  if (!allowedTopLevel.includes(segments[0])) {
    refuse(`the archive entry ${quoted(name)} is not part of a Kosmos build (it may only contain ${allowedTopLevel.map(quoted).join(', ')})`);
  }
  return segments;
}

function decodeName(bytes, flags) {
  if (flags & FLAG_UTF8_NAMES) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { refuse('the archive has an entry whose name is not valid UTF-8'); }
  }
  /* Without the UTF-8 flag a name is in the old DOS code page. A Kosmos build's names are
     ASCII, and guessing a code page is how two names become one on disk. */
  for (const b of bytes) { if (b > 0x7f) refuse('the archive has an entry whose name is not plain ASCII and is not marked as UTF-8'); }
  return bytes.toString('latin1');
}

function findEndOfCentralDirectory(buf) {
  const lowest = Math.max(0, buf.length - END_OF_CENTRAL_DIRECTORY_BYTES - MAX_ARCHIVE_COMMENT_BYTES);
  for (let i = buf.length - END_OF_CENTRAL_DIRECTORY_BYTES; i >= lowest; i--) {
    if (buf.readUInt32LE(i) === SIGNATURE_END_OF_CENTRAL_DIRECTORY) return i;
  }
  return -1;
}

/**
 * Read and check the archive's table of contents without writing anything.
 *
 * `limits` is required: `{ allowedTopLevel, maxEntries, maxEntryBytes, maxTotalBytes }`. The caps
 * are the caller's to name, because the caller knows what it is unpacking.
 *
 * Returns one record per entry: `{ name, segments, isDirectory, method, crc32, compressedSize,
 * uncompressedSize, dataStart }`. Throws a ZipRefusal on anything it does not accept.
 */
function readZipDirectory(buf, limits) {
  const l = requireLimits(limits);
  if (!Buffer.isBuffer(buf)) throw new TypeError('win32zip: readZipDirectory takes a Buffer');
  if (buf.length < END_OF_CENTRAL_DIRECTORY_BYTES) refuse('the archive is too short to be a zip, so the download was cut short or is not a zip');

  const eocd = findEndOfCentralDirectory(buf);
  if (eocd < 0) refuse('the archive has no end-of-archive record, so the download was cut short or is not a zip');
  const commentLength = buf.readUInt16LE(eocd + 20);
  if (eocd + END_OF_CENTRAL_DIRECTORY_BYTES + commentLength !== buf.length) {
    refuse('the archive does not end where its end-of-archive record says it does, so it was cut short or has something appended');
  }
  if (eocd >= ZIP64_LOCATOR_BYTES && buf.readUInt32LE(eocd - ZIP64_LOCATOR_BYTES) === SIGNATURE_ZIP64_LOCATOR) {
    refuse('the archive uses zip64 records, which a Kosmos build never needs');
  }
  const diskNumber = buf.readUInt16LE(eocd + 4);
  const directoryDisk = buf.readUInt16LE(eocd + 6);
  const entriesOnDisk = buf.readUInt16LE(eocd + 8);
  const entryCount = buf.readUInt16LE(eocd + 10);
  const directorySize = buf.readUInt32LE(eocd + 12);
  const directoryOffset = buf.readUInt32LE(eocd + 16);
  if (entryCount === ZIP64_MARKER_16 || entriesOnDisk === ZIP64_MARKER_16 || directorySize === ZIP64_MARKER_32 || directoryOffset === ZIP64_MARKER_32) {
    refuse('the archive uses zip64 records, which a Kosmos build never needs');
  }
  if (diskNumber !== 0 || directoryDisk !== 0 || entriesOnDisk !== entryCount) refuse('the archive is split across several files');
  if (entryCount > l.maxEntries) refuse(`the archive has ${entryCount} entries, more than the ${l.maxEntries} a Kosmos build may have`);
  if (directoryOffset + directorySize !== eocd) refuse('the archive\'s table of contents is not where its end-of-archive record says, so it is damaged or cut short');

  const entries = [];
  const seen = new Map();          // lower-cased name without the trailing slash -> isDirectory
  const folders = new Set();       // lower-cased every folder some entry sits in
  let totalBytes = 0;
  let at = directoryOffset;
  for (let n = 0; n < entryCount; n++) {
    if (at + CENTRAL_HEADER_BYTES > eocd || buf.readUInt32LE(at) !== SIGNATURE_CENTRAL_HEADER) {
      refuse('the archive\'s table of contents is damaged');
    }
    const madeByHost = buf.readUInt16LE(at + 4) >> 8;
    const flags = buf.readUInt16LE(at + 8);
    const method = buf.readUInt16LE(at + 10);
    const crc32 = buf.readUInt32LE(at + 16);
    const compressedSize = buf.readUInt32LE(at + 20);
    const uncompressedSize = buf.readUInt32LE(at + 24);
    const nameLength = buf.readUInt16LE(at + 28);
    const extraLength = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    const startDisk = buf.readUInt16LE(at + 34);
    const externalAttributes = buf.readUInt32LE(at + 38);
    const localHeaderOffset = buf.readUInt32LE(at + 42);
    const nameEnd = at + CENTRAL_HEADER_BYTES + nameLength;
    const next = nameEnd + extraLength + commentLen;
    if (next > eocd) refuse('the archive\'s table of contents is damaged');
    const nameBytes = buf.subarray(at + CENTRAL_HEADER_BYTES, nameEnd);
    const name = decodeName(nameBytes, flags);

    if (compressedSize === ZIP64_MARKER_32 || uncompressedSize === ZIP64_MARKER_32 || localHeaderOffset === ZIP64_MARKER_32 || startDisk === ZIP64_MARKER_16) {
      refuse(`the archive entry ${quoted(name)} uses zip64 records, which a Kosmos build never needs`);
    }
    if (flags & REFUSED_FLAGS) refuse(`the archive entry ${quoted(name)} is encrypted`);
    if (method !== METHOD_STORED && method !== METHOD_DEFLATE) refuse(`the archive entry ${quoted(name)} is compressed with a method this updater does not read (${method})`);
    if (madeByHost === HOST_UNIX && ((externalAttributes >>> 16) & UNIX_FILE_TYPE_MASK) === UNIX_SYMLINK) {
      refuse(`the archive entry ${quoted(name)} is a link, and a Kosmos build has none`);
    }
    const segments = checkEntryName(name, l.allowedTopLevel);
    const isDirectory = name.endsWith('/');
    if (isDirectory && uncompressedSize !== 0) refuse(`the archive entry ${quoted(name)} is a folder with contents of its own`);
    if (uncompressedSize > l.maxEntryBytes) refuse(`the archive entry ${quoted(name)} unpacks to ${uncompressedSize} bytes, more than the ${l.maxEntryBytes} any one file in a Kosmos build may be`);
    totalBytes += uncompressedSize;
    if (totalBytes > l.maxTotalBytes) refuse(`the archive unpacks to more than the ${l.maxTotalBytes} bytes a Kosmos build may be`);
    if (method === METHOD_STORED && compressedSize !== uncompressedSize) refuse(`the archive entry ${quoted(name)} is stored with two different sizes`);

    /* NTFS is case-insensitive, so `App/x` and `app/x` are the same file there. (Names are
       printable ASCII by now, so ASCII lower-casing is NTFS's folding.) */
    const key = segments.join('/').toLowerCase();
    if (seen.has(key)) refuse(`the archive has ${quoted(name)} twice`);
    seen.set(key, isDirectory);
    for (let i = 1; i < segments.length; i++) folders.add(segments.slice(0, i).join('/').toLowerCase());

    /* The local header must say the same thing, and its data must end before the table of
       contents starts. */
    if (localHeaderOffset + LOCAL_HEADER_BYTES > directoryOffset || buf.readUInt32LE(localHeaderOffset) !== SIGNATURE_LOCAL_HEADER) {
      refuse(`the archive entry ${quoted(name)} points at data that is not there, so the archive is damaged or cut short`);
    }
    const localFlags = buf.readUInt16LE(localHeaderOffset + 6);
    const localMethod = buf.readUInt16LE(localHeaderOffset + 8);
    const localCrc32 = buf.readUInt32LE(localHeaderOffset + 14);
    const localCompressedSize = buf.readUInt32LE(localHeaderOffset + 18);
    const localUncompressedSize = buf.readUInt32LE(localHeaderOffset + 22);
    const localNameLength = buf.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = buf.readUInt16LE(localHeaderOffset + 28);
    const localName = buf.subarray(localHeaderOffset + LOCAL_HEADER_BYTES, localHeaderOffset + LOCAL_HEADER_BYTES + localNameLength);
    const sameHeader = localFlags === flags && localMethod === method && localName.equals(nameBytes)
      && ((flags & FLAG_DATA_DESCRIPTOR)
        || (localCrc32 === crc32 && localCompressedSize === compressedSize && localUncompressedSize === uncompressedSize));
    if (!sameHeader) refuse(`the archive entry ${quoted(name)} is described two different ways inside the archive`);
    const dataStart = localHeaderOffset + LOCAL_HEADER_BYTES + localNameLength + localExtraLength;
    if (dataStart + compressedSize > directoryOffset) refuse(`the archive entry ${quoted(name)} runs past the end of the archive's data, so the archive is damaged or cut short`);

    entries.push({ name, segments, isDirectory, method, crc32, compressedSize, uncompressedSize, dataStart, localHeaderOffset });
    at = next;
  }
  if (at !== eocd) refuse('the archive\'s table of contents is damaged');

  for (const [key, isDirectory] of seen) {
    if (!isDirectory && folders.has(key)) refuse(`the archive has ${quoted(key)} as both a file and a folder`);
  }
  /* Two entries sharing bytes is how a small archive unpacks into a huge one. */
  const byOffset = [...entries].sort((a, b) => a.localHeaderOffset - b.localHeaderOffset);
  for (let i = 1; i < byOffset.length; i++) {
    if (byOffset[i].localHeaderOffset < byOffset[i - 1].dataStart + byOffset[i - 1].compressedSize) {
      refuse(`the archive entries ${quoted(byOffset[i - 1].name)} and ${quoted(byOffset[i].name)} overlap`);
    }
  }
  return entries;
}

function entryContents(buf, entry) {
  const raw = buf.subarray(entry.dataStart, entry.dataStart + entry.compressedSize);
  let contents;
  if (entry.method === METHOD_STORED) {
    contents = raw;
  } else {
    try {
      /* Capped at the declared size, so an entry cannot inflate past what the checks above allowed. */
      contents = zlib.inflateRawSync(raw, { maxOutputLength: Math.max(1, entry.uncompressedSize) });
    } catch (e) {
      refuse(`the archive entry ${quoted(entry.name)} could not be unpacked (${(e && e.message) || e})`);
    }
  }
  if (contents.length !== entry.uncompressedSize) refuse(`the archive entry ${quoted(entry.name)} unpacked to a different size than it declares`);
  if ((zlib.crc32(contents) >>> 0) !== entry.crc32) refuse(`the archive entry ${quoted(entry.name)} is damaged (its checksum does not match)`);
  return contents;
}

/**
 * Unpack `buf` (a whole zip, in memory) into `destDir`, which must not exist yet; its parent must.
 *
 * The table of contents is checked in full before the first file is written. Each file is then
 * inflated, checked against its declared size and CRC-32, and written with `wx`, so nothing that
 * is already there is overwritten or followed. On a refusal part of the tree may be written; the
 * caller owns `destDir` and removes it.
 *
 * Returns `{ entries, bytes }`.
 */
function extractZip(buf, destDir, limits) {
  const entries = readZipDirectory(buf, limits);
  const dest = path.resolve(destDir);
  fs.mkdirSync(dest);
  let bytes = 0;
  for (const entry of entries) {
    const target = path.join(dest, ...entry.segments);
    const rel = path.relative(dest, target);
    if (rel === '' || rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) {
      refuse(`the archive entry ${quoted(entry.name)} would land outside the folder it is being unpacked into`);
    }
    if (entry.isDirectory) {
      fs.mkdirSync(target, { recursive: true });
      continue;
    }
    const contents = entryContents(buf, entry);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    /* `wx` is the second line of defence, behind the name checks: two entries with one name
       (case-insensitively) and short-name aliases are refused before this loop starts, so in a
       fresh destination no target exists yet. It still stops an alias those checks do not model
       from overwriting a file written a moment earlier. */
    fs.writeFileSync(target, contents, { flag: 'wx' });
    bytes += contents.length;
  }
  return { entries: entries.length, bytes };
}

module.exports = { readZipDirectory, extractZip, ZipRefusal };
