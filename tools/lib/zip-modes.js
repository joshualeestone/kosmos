'use strict';
/**
 * #6677: the Windows zip's entries carry sane Unix modes, never world-writable ones.
 *
 * WHY. tools/build-kosmos-windows.sh zips the staging folder with `zip -qr`. On the Windows
 * release box there is no Info-ZIP, and the build runs through a shim that calls Windows' own
 * bsdtar (tar.exe -a). Windows files have no Unix mode, so bsdtar records 0666 for every file
 * and 0777 for every folder and .exe: measured on the 0.7.60 zip, every entry was
 * group- and world-writable. Explorer ignores the modes, but anyone who extracts the zip with a Unix
 * tool (WSL, Git Bash's unzip, a Mac) gets files every user on that machine can rewrite.
 * A Mac build with Info-ZIP takes whatever modes the checkout had. Neither is a decision.
 *
 * WHAT. After the zip is written, this rewrites each central-directory entry's "version made
 * by" host to Unix (3) and its external attributes to a fixed mode, in place (the record sizes
 * do not change, so nothing else in the file moves):
 *   folders                                   040755
 *   programs: .exe .dll .cmd .bat, or a file
 *   that starts with "#!" (a shell script)    0100755
 *   everything else, .ps1 and .js included    0100644
 * .ps1 is NOT executable on purpose: like a .js it is only ever run through its interpreter
 * (powershell -File, node), never exec'd, and Windows never reads the bit. The DOS attribute
 * bits in the low 16 bits are kept (and the folder bit set for folders), so Explorer's view of
 * the zip does not change. Whichever tool made the zip, the result is the same.
 *
 * USE.
 *   node tools/lib/zip-modes.js set   <zip> <stage-dir>   rewrite the modes; the stage dir is
 *                                                         read only for a file's first two bytes
 *   node tools/lib/zip-modes.js check <zip> [<stage-dir>] refuse (exit 1) an empty zip, or any entry
 *                                                         that is not Unix-hosted with the mode `set`
 *                                                         gives it (exact with the stage dir; without
 *                                                         it 0644 or 0755 for a file, 0755 for a
 *                                                         program by extension and for a folder)
 *
 * Every entry is written as a regular file or a folder: a symlink entry would become a file holding its
 * target. The build cannot make one (Info-ZIP -r follows links; the stage is copied files), and `check`
 * with the stage folder refuses an entry whose mode is not the regular one `set` gives.
 *
 * A DOS-hosted entry is relabelled Unix. Info-ZIP then stops reading a non-ASCII name without the
 * UTF-8 flag as CP437; every name this build stages is ASCII, so nothing reads differently today.
 */

const fs = require('node:fs');
const path = require('node:path');

const CEN_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
const Z64_LOC_SIG = 0x07064b50;
const Z64_EOCD_SIG = 0x06064b50;

const MODE_DIR = 0o040755;
const MODE_EXEC = 0o100755;
const MODE_FILE = 0o100644;
const PROGRAM_EXT = new Set(['.exe', '.dll', '.cmd', '.bat']);

/** Where the central directory is, and how many entries it holds. */
function centralDirectory(buf) {
  // The end record is the last 22 bytes plus a comment of up to 65535 bytes.
  const floor = Math.max(0, buf.length - 22 - 0xffff);
  let eocd = -1;
  for (let i = buf.length - 22; i >= floor; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('no end-of-central-directory record: this is not a zip');
  let entries = buf.readUInt16LE(eocd + 10);
  let size = buf.readUInt32LE(eocd + 12);
  let offset = buf.readUInt32LE(eocd + 16);
  if (entries === 0xffff || size === 0xffffffff || offset === 0xffffffff) {
    const loc = eocd - 20;
    if (loc < 0 || buf.readUInt32LE(loc) !== Z64_LOC_SIG) throw new Error('the end record points at a ZIP64 record that is not there');
    const z64 = Number(buf.readBigUInt64LE(loc + 8));
    if (z64 + 56 > buf.length || buf.readUInt32LE(z64) !== Z64_EOCD_SIG) throw new Error('the ZIP64 end record is not where its locator says');
    entries = Number(buf.readBigUInt64LE(z64 + 32));
    size = Number(buf.readBigUInt64LE(z64 + 40));
    offset = Number(buf.readBigUInt64LE(z64 + 48));
  }
  if (offset + size > buf.length) throw new Error('the central directory runs past the end of the file');
  return { entries, offset, size };
}

/** Each central-directory entry: its name and where its header starts. */
function listEntries(buf) {
  const { entries, offset, size } = centralDirectory(buf);
  const out = [];
  let p = offset;
  for (let n = 0; n < entries; n++) {
    if (p + 46 > offset + size || buf.readUInt32LE(p) !== CEN_SIG) throw new Error(`central directory entry ${n + 1} of ${entries} is not where it should be`);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    out.push({ name, at: p, madeBy: buf.readUInt16LE(p + 4), attrs: buf.readUInt32LE(p + 38) });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function startsWithShebang(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const b = Buffer.alloc(2);
    return fs.readSync(fd, b, 0, 2, 0) === 2 && b[0] === 0x23 && b[1] === 0x21;
  } catch { return false; } finally { if (fd !== undefined) fs.closeSync(fd); }
}

/** The mode an entry should carry. `stageDir` is optional; without it no shebang is seen. */
function modeFor(name, stageDir) {
  if (name.endsWith('/')) return MODE_DIR;
  if (PROGRAM_EXT.has(path.extname(name).toLowerCase())) return MODE_EXEC;
  if (stageDir && startsWithShebang(path.join(stageDir, ...name.split('/')))) return MODE_EXEC;
  return MODE_FILE;
}

/** Rewrite every entry's host and mode in `buf`, in place. Returns counts by mode. */
function setModes(buf, stageDir) {
  const counts = { file: 0, exec: 0, dir: 0 };
  for (const e of listEntries(buf)) {
    const mode = modeFor(e.name, stageDir);
    const spec = Math.max(e.madeBy & 0xff, 20);
    buf.writeUInt16LE((3 << 8) | spec, e.at + 4);
    let dos = e.attrs & 0xffff;
    if (mode === MODE_DIR) dos |= 0x10;
    buf.writeUInt32LE(((mode << 16) | dos) >>> 0, e.at + 38);
    counts[mode === MODE_DIR ? 'dir' : mode === MODE_EXEC ? 'exec' : 'file']++;
  }
  return counts;
}

/**
 * Every entry's problem, if any: not Unix-hosted, or not the mode it should carry. With the stage folder
 * the mode must be EXACTLY modeFor's (a .js left 0755 is refused too). Without it a shebang cannot be seen,
 * so a file that is not a program by extension may be 0644 or 0755; a program by extension must be 0755.
 * An empty zip is a problem: a check that passes nothing proves nothing.
 */
function checkModes(buf, stageDir) {
  const problems = [];
  const counts = { file: 0, exec: 0, dir: 0 };
  const entries = listEntries(buf);
  if (entries.length === 0) problems.push('the zip has no entries');
  for (const e of entries) {
    const host = e.madeBy >> 8;
    const mode = e.attrs >>> 16;
    if (stageDir && !e.name.endsWith('/') && !fs.existsSync(path.join(stageDir, ...e.name.split('/')))) {
      problems.push(`${e.name}: not in the stage folder ${stageDir}, so its mode cannot be checked`);
      continue;
    }
    const want = stageDir ? [modeFor(e.name, stageDir)]
      : e.name.endsWith('/') ? [MODE_DIR]
        : PROGRAM_EXT.has(path.extname(e.name).toLowerCase()) ? [MODE_EXEC] : [MODE_FILE, MODE_EXEC];
    if (host !== 3) problems.push(`${e.name}: made on host ${host}, not Unix, so it carries no mode`);
    else if (!want.includes(mode)) problems.push(`${e.name}: mode ${mode.toString(8)}`);
    else counts[mode === MODE_DIR ? 'dir' : mode === MODE_EXEC ? 'exec' : 'file']++;
  }
  return { problems, counts };
}

function main(argv) {
  const [verb, zip, stage] = argv;
  // A wrong stage path would hide every #! script from set AND check alike (both read it the same way),
  // so a stage folder that is not there is refused, never read as "no scripts".
  if ((verb === 'set' || verb === 'check') && stage !== undefined && !(fs.existsSync(stage) && fs.statSync(stage).isDirectory())) {
    console.error(`zip-modes: the stage folder ${stage} is not a folder`);
    return 2;
  }
  if (verb === 'set' && zip && stage) {
    const buf = fs.readFileSync(zip);
    const c = setModes(buf, stage);
    // Written beside the zip and renamed over it, so a full disk or a crash never leaves a torn zip.
    const tmp = `${zip}.${process.pid}.modes.tmp`;
    try { fs.writeFileSync(tmp, buf); fs.renameSync(tmp, zip); } finally { fs.rmSync(tmp, { force: true }); }
    console.log(`==> zip modes set: ${c.file} files 0644, ${c.exec} programs 0755, ${c.dir} folders 0755`);
    return 0;
  }
  if (verb === 'check' && zip) {
    const { problems, counts } = checkModes(fs.readFileSync(zip), stage);
    if (problems.length) {
      console.error(`${zip}: ${problems.length} entr${problems.length === 1 ? 'y has' : 'ies have'} the wrong mode (#6677):`);
      for (const p of problems.slice(0, 20)) console.error('  ' + p);
      return 1;
    }
    console.log(`==> zip modes checked: ${counts.file} files 0644, ${counts.exec} programs 0755, ${counts.dir} folders 0755, nothing world-writable`);
    return 0;
  }
  console.error('usage: zip-modes.js set <zip> <stage-dir> | check <zip> [<stage-dir>]');
  return 2;
}

module.exports = { listEntries, modeFor, setModes, checkModes, MODE_DIR, MODE_EXEC, MODE_FILE };

if (require.main === module) {
  try { process.exitCode = main(process.argv.slice(2)); }
  catch (error) { console.error(`zip-modes: ${error.message}`); process.exitCode = 1; }
}
