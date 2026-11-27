'use strict';
/**
 * kosmos#9218: `kosmos preview <file> [--page N] [--out <png>]`, one page of a PDF drawn as a PNG on this computer, so
 * an agent can look at a design itself before saying it is ready. Both CLIs run this one module (install/kosmos runs
 * it as a script; tools/windows/kosmos-cli.js calls main()), so the words, the options and the refusals cannot drift.
 *
 * 🔑 NEVER THE NETWORK, AND NO BOARD. Every renderer is a local subprocess with a timeout; nothing is uploaded, and
 * the board need not be running. The PDF is read once, through one handle, into a private copy in a fresh folder of
 * the system's temporary folder, and only that copy is handed to a renderer, so a renderer never sees the agent's
 * path (a name with quotes or $ in it reaches nothing as text) and a file changed mid-read is never half drawn.
 *
 * Per platform:
 *  - macOS: engine/pdfpages.js, the board's own later-page renderer (PDFKit through osascript, under sandbox-exec: no
 *    network, writes only to its own folder). It draws page 1 too, so one renderer covers every page.
 *  - Linux: pdftoppm (poppler-utils) or, failing that, mutool (mupdf-tools), if one is on PATH. If neither is, it says
 *    which package to install and draws nothing; it never guesses another tool.
 *  - Windows: Windows.Data.Pdf, built into Windows 10 and later, through Windows PowerShell 5.1 (powershell.exe, which
 *    can load WinRT types; PowerShell 7 cannot without a shim). The script goes in as -EncodedCommand and the paths
 *    and page as environment variables, never spliced into the script's text.
 *
 * Not done, on purpose (decided on the card): no check that the file sits in one of the agent's project folders or
 * its Files folder. `kosmos reply --file` has that rule because it SENDS a file to a person; this sends nothing and
 * runs with the agent's own rights, which can already read any file it names, and the check needs the board's roster.
 *
 * Exit status: 0 drawn (stdout is the PNG's full path, one line); 2 the command or the file was refused (usage, not a
 * PDF, too big, no such page); 1 this computer could not draw it (no renderer, a timeout, a renderer failure).
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const MAX_BYTES = 25 * 1024 * 1024;   // engine/filepreview.js MAX_PREVIEW_BYTES, the board's own preview limit
const MAX_PAGE = 99999;               // pdfpages.pageOf's five digits
const TIMEOUT_MS = 30000;             // a whole-PDF renderer (pdftoppm, PowerShell's start) is slower than PDFKit's one page
const LONG_SIDE = 1024;               // the size the board's preview draws (pdfpages, qlmanage -s 1024)
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const USAGE = 'Usage: kosmos preview <file.pdf> [--page N] [--out <file.png>]   (draws one page of a PDF as a PNG on this computer and prints the PNG\'s path; page 1 unless --page says another; without --out the PNG goes in a new folder of the system\'s temporary folder, never next to the PDF; nothing is sent anywhere)';

/* kosmos#9218 on Windows: the page drawn through WinRT. $env: values only; Write-Output says ok, or ERR range <n>. */
const WIN_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  'Add-Type -AssemblyName System.Runtime.WindowsRuntime',
  "$ext = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 }",
  "$opT = $ext | Where-Object { $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1",
  "$actT = $ext | Where-Object { $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction' } | Select-Object -First 1",
  'function Wait-Op($op, [Type]$t) { $task = $opT.MakeGenericMethod($t).Invoke($null, @($op)); [void]$task.Wait(-1); $task.Result }',
  'function Wait-Act($op) { $task = $actT.Invoke($null, @($op)); [void]$task.Wait(-1) }',
  '[void][Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]',
  '[void][Windows.Storage.StorageFolder, Windows.Storage, ContentType = WindowsRuntime]',
  '[void][Windows.Data.Pdf.PdfDocument, Windows.Data.Pdf, ContentType = WindowsRuntime]',
  '[void][Windows.Data.Pdf.PdfPageRenderOptions, Windows.Data.Pdf, ContentType = WindowsRuntime]',
  '$src = Wait-Op ([Windows.Storage.StorageFile]::GetFileFromPathAsync($env:KOSMOS_PREVIEW_IN)) ([Windows.Storage.StorageFile])',
  '$doc = Wait-Op ([Windows.Data.Pdf.PdfDocument]::LoadFromFileAsync($src)) ([Windows.Data.Pdf.PdfDocument])',
  '$n = [int]$doc.PageCount',
  '$i = [int]$env:KOSMOS_PREVIEW_INDEX',
  "if ($i -lt 0 -or $i -ge $n) { Write-Output ('ERR range ' + $n); exit 0 }",
  '$page = $doc.GetPage([uint32]$i)',
  '$w = [double]$page.Size.Width; $h = [double]$page.Size.Height',
  '$opts = New-Object Windows.Data.Pdf.PdfPageRenderOptions',
  'if ($w -gt 0 -and $h -gt 0) { $s = ' + LONG_SIDE + ' / [Math]::Max($w, $h); $opts.DestinationWidth = [uint32][Math]::Max(1, [Math]::Round($w * $s)); $opts.DestinationHeight = [uint32][Math]::Max(1, [Math]::Round($h * $s)) }',
  '$dir = Wait-Op ([Windows.Storage.StorageFolder]::GetFolderFromPathAsync($env:KOSMOS_PREVIEW_DIR)) ([Windows.Storage.StorageFolder])',
  "$outFile = Wait-Op ($dir.CreateFileAsync('page.png', [Windows.Storage.CreationCollisionOption]::ReplaceExisting)) ([Windows.Storage.StorageFile])",
  '$stream = Wait-Op ($outFile.OpenAsync([Windows.Storage.FileAccessMode]::ReadWrite)) ([Windows.Storage.Streams.IRandomAccessStream])',
  'try { Wait-Act ($page.RenderToStreamAsync($stream, $opts)) } finally { $stream.Dispose(); $page.Dispose() }',
  "Write-Output ('ok ' + $n)",
].join('\n');

/* The subprocess seam: run(cmd, args, { env, timeout }) -> Promise<{ code, stdout, killed }>. Tests replace it. */
function runReal(cmd, args, opts) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: opts.timeout, env: opts.env, maxBuffer: 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: String(stdout || ''), stderr: String(stderr || ''), killed: !!(err && err.killed), missing: !!(err && err.code === 'ENOENT') });
    });
  });
}

/* The first executable named `name` on PATH (as `command -v` finds it), or null. */
function onPath(name, env = process.env) {
  for (const dir of String(env.PATH || '').split(path.delimiter)) {
    if (!dir || !path.isAbsolute(dir)) continue;   // a relative PATH entry would run whatever sits in the current folder
    const p = path.join(dir, name);
    try { const st = fs.statSync(p); if (st.isFile() && (st.mode & 0o111)) return p; } catch { /* not here */ }
  }
  return null;
}

/* Windows PowerShell 5.1 by its fixed place under the system root, never a powershell.exe found on PATH. */
function windowsPowerShell(env = process.env) {
  const root = env.SystemRoot || env.SYSTEMROOT || 'C:\\Windows';
  return path.win32.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

/** Reads the options. { ok: true, file, page, out } or { ok: false, words } (exit 2). */
function parseArgs(args) {
  let file = null, page = null, out = null, past = false;
  const list = Array.isArray(args) ? args.map(String) : [];
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (!past && a === '--') { past = true; continue; }
    if (!past && (a === '--help' || a === '-h')) return { ok: false, help: true, words: USAGE };
    let m;
    if (!past && (m = /^--(page|out)(?:=(.*))?$/s.exec(a))) {
      let v = m[2];
      if (v === undefined) { if (i + 1 >= list.length) return { ok: false, words: '--' + m[1] + ' needs a value, so nothing was drawn.\n' + USAGE }; v = list[++i]; }
      if (m[1] === 'page') {
        if (page !== null) return { ok: false, words: '--page was given twice, so nothing was drawn.' };
        if (!/^[1-9]\d{0,4}$/.test(v)) return { ok: false, words: '--page takes a page number from 1 to ' + MAX_PAGE + ', so nothing was drawn.' };
        page = Number(v);
      } else {
        if (out !== null) return { ok: false, words: '--out was given twice, so nothing was drawn.' };
        if (!v) return { ok: false, words: '--out needs the path of the PNG to write, so nothing was drawn.' };
        out = v;
      }
      continue;
    }
    if (!past && /^-./.test(a)) return { ok: false, words: 'kosmos preview does not know the option ' + JSON.stringify(a) + ', so nothing was drawn.\n' + USAGE };
    if (file !== null) return { ok: false, words: 'kosmos preview draws one file at a time, so nothing was drawn.\n' + USAGE };
    file = a;
  }
  if (!file) return { ok: false, words: USAGE };
  if (/[\x00-\x1f\x7f]/.test(file) || (out && /[\x00-\x1f\x7f]/.test(out))) return { ok: false, words: 'That path has a line break or another control character in it, so nothing was drawn. Rename the file, then try again.' };
  if (out !== null && !/\.png$/i.test(out)) return { ok: false, words: '--out must name a file ending in .png, so nothing was drawn.' };
  return { ok: true, file, page: page === null ? 1 : page, out };
}

/* The PDF's bytes, read through one handle: a regular file, at most MAX_BYTES, starting %PDF- within its first 1024
   bytes (the PDF standard's allowance). { ok, bytes } or { ok: false, words }. */
function readPdf(file) {
  let fd = null;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK || 0));
    const st = fs.fstatSync(fd);
    if (!st.isFile()) return { ok: false, words: file + ' is not a file, so nothing was drawn.' };
    if (st.size > MAX_BYTES) return { ok: false, words: file + ' is over ' + (MAX_BYTES / 1024 / 1024) + ' MB, the most Kosmos draws a preview of, so nothing was drawn.' };
    const bytes = Buffer.alloc(st.size);
    let off = 0;
    while (off < st.size) { const n = fs.readSync(fd, bytes, off, st.size - off, off); if (n <= 0) break; off += n; }
    if (off !== st.size) return { ok: false, words: file + ' changed while it was being read, so nothing was drawn. Try again.' };
    if (!bytes.subarray(0, 1024).includes('%PDF-')) return { ok: false, words: file + ' is not a PDF, so nothing was drawn. kosmos preview draws PDFs only.' };
    return { ok: true, bytes };
  } catch (e) {
    if (e && e.code === 'ENOENT') return { ok: false, words: 'There is no file at ' + file + ', so nothing was drawn.' };
    if (e && (e.code === 'EISDIR')) return { ok: false, words: file + ' is not a file, so nothing was drawn.' };
    return { ok: false, words: file + ' could not be read (' + (e && e.code ? e.code : 'error') + '), so nothing was drawn.' };
  } finally { if (fd !== null) { try { fs.closeSync(fd); } catch { /* closed */ } } }
}

/* True when `p` holds a whole PNG with a size: the signature, then an IHDR whose width and height are not 0, and an
   IEND at the end. A renderer that exits 0 with an empty or cut-off file is not believed. */
function isPng(p) {
  try {
    const b = fs.readFileSync(p);
    if (b.length < 45 || !b.subarray(0, 8).equals(PNG_MAGIC) || b.toString('latin1', 12, 16) !== 'IHDR') return false;
    if (b.readUInt32BE(16) === 0 || b.readUInt32BE(20) === 0) return false;
    return b.toString('latin1', b.length - 8, b.length - 4) === 'IEND';
  } catch { return false; }
}

/* Each renderer: (copy, index, work, deps) -> { ok: true, png } | { ok: false, range?: n|true, words? }. `work` is a
   fresh folder holding only the copy; the PNG is drawn inside it. */
async function drawMac(copy, index, work, deps) {
  const pdfpages = deps.pdfpages || require('./pdfpages');
  if (!pdfpages.available()) return { ok: false, words: 'This Mac cannot draw PDF pages here.' };
  const n = await pdfpages.count(copy);
  if (n !== null && index >= n) return { ok: false, range: n };
  const png = path.join(work, 'page.png');
  return (await pdfpages.render(copy, index, png)) ? { ok: true, png } : { ok: false };
}

const LINUX_HELP = 'This computer has no PDF renderer Kosmos can use, so nothing was drawn. Install poppler-utils (it has pdftoppm) or mupdf-tools (it has mutool), then run kosmos preview again.';
async function drawLinux(copy, index, work, deps) {
  const run = deps.run || runReal;
  const env = deps.env || process.env;
  const pdftoppm = onPath('pdftoppm', env);
  const mutool = pdftoppm ? null : onPath('mutool', env);
  if (!pdftoppm && !mutool) return { ok: false, words: LINUX_HELP };
  const png = path.join(work, 'page.png');
  const p = String(index + 1);
  /* Review 2: mutool may clamp a page past the end to the last page and exit 0, so its own count (`mutool info`
     prints Pages: N) is read BEFORE drawing. A count it cannot give is not a refusal; the draw then decides. */
  if (mutool) {
    const info = await run(mutool, ['info', copy], { timeout: TIMEOUT_MS, env });
    const pages = info.code === 0 ? /^Pages:\s*(\d+)\s*$/m.exec(info.stdout) : null;
    if (pages && index >= Number(pages[1])) return { ok: false, range: Number(pages[1]) };
  }
  const got = pdftoppm
    ? await run(pdftoppm, ['-f', p, '-l', p, '-png', '-singlefile', '-scale-to', String(LONG_SIDE), copy, path.join(work, 'page')], { timeout: TIMEOUT_MS, env })
    : await run(mutool, ['draw', '-q', '-o', png, '-h', String(LONG_SIDE), '-w', String(LONG_SIDE), '-F', 'png', copy, p], { timeout: TIMEOUT_MS, env });
  if (got.killed) return { ok: false, words: 'Drawing that page took over ' + (TIMEOUT_MS / 1000) + ' seconds, so it was stopped.' };
  if (got.code === 0 && fs.existsSync(png)) return { ok: true, png };
  /* pdftoppm fails both on a page past the end and on a file it cannot open; only "Wrong page range" is the first. */
  return { ok: false, range: pdftoppm && /wrong page range/i.test(got.stdout + (got.stderr || '')) ? true : undefined };
}

async function drawWindows(copy, index, work, deps) {
  const run = deps.run || runReal;
  const env = { ...(deps.env || process.env), KOSMOS_PREVIEW_IN: copy, KOSMOS_PREVIEW_INDEX: String(index), KOSMOS_PREVIEW_DIR: work };
  const exe = deps.powershell || windowsPowerShell(env);
  const got = await run(exe, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(WIN_SCRIPT, 'utf16le').toString('base64')], { timeout: TIMEOUT_MS, env });
  if (got.missing) return { ok: false, words: 'This computer has no Windows PowerShell at ' + exe + ', which Kosmos uses to draw PDF pages, so nothing was drawn.' };
  if (got.killed) return { ok: false, words: 'Drawing that page took over ' + (TIMEOUT_MS / 1000) + ' seconds, so it was stopped.' };
  const said = String(got.stdout || '').trim().split(/\r?\n/).pop() || '';
  const r = /^ERR range (\d+)$/.exec(said);
  if (r) return { ok: false, range: Number(r[1]) };
  const png = path.join(work, 'page.png');
  return got.code === 0 && /^ok \d+$/.test(said) && fs.existsSync(png) ? { ok: true, png } : { ok: false };
}

const DRAW = { darwin: drawMac, linux: drawLinux, win32: drawWindows };

/* Puts the drawn page at `out` whole: copied into a new folder beside `out` (review 1: a fresh mkdtemp name, never a
   guessable one another account could plant a link at), then renamed over it, so a reader never sees half. */
function placeAt(from, out) {
  const stage = fs.mkdtempSync(path.join(path.dirname(out), '.kosmos-preview-'));
  try { const part = path.join(stage, 'page.png'); fs.copyFileSync(from, part); fs.renameSync(part, out); }
  finally { try { fs.rmSync(stage, { recursive: true, force: true }); } catch { /* best effort */ } }
}

/* The same file: the same device and inode, or, where a drive reports inode 0 (some Windows volumes), the same size and
   change time as well, which a PNG about to be written over a PDF will not share by chance. */
function sameFile(a, b) {
  if (a.dev !== b.dev) return false;
  if (a.ino && b.ino) return a.ino === b.ino;
  return a.size === b.size && a.mtimeMs === b.mtimeMs && a.birthtimeMs === b.birthtimeMs;
}

/* Where the PNG goes: --out made absolute (its folder must exist; an existing file there must be a regular file, and
   never the PDF itself), or a new private folder of the system's temporary folder. { ok, out } or { ok: false, words }. */
function outFor(given, file, page, deps) {
  if (given) {
    const out = path.resolve(given);
    let dir;
    try { dir = fs.statSync(path.dirname(out)); } catch { dir = null; }
    if (!dir || !dir.isDirectory()) return { ok: false, words: 'The folder for --out (' + path.dirname(out) + ') does not exist, so nothing was drawn.' };
    let st = null;
    try { st = fs.lstatSync(out); } catch { st = null; }
    if (st && !st.isFile()) return { ok: false, words: out + ' is there and is ' + (st.isSymbolicLink() ? 'a link' : 'not a plain file') + ', so nothing was drawn. Name another --out.' };
    /* Review 2: by device and inode, not by path: on a disk that ignores case (APFS, NTFS by default) ODD.PNG is odd.png. */
    try { if (st && sameFile(fs.statSync(out), fs.statSync(file))) return { ok: false, words: '--out names the PDF itself, so nothing was drawn.' }; } catch { /* the PDF was readable a moment ago */ }
    return { ok: true, out };
  }
  const tmp = deps.tmpdir || os.tmpdir();
  const folder = fs.mkdtempSync(path.join(tmp, 'kosmos-preview-'));   // 0700, a new name each time: no other account's file to land on
  const base = path.basename(file).replace(/\.pdf$/i, '').replace(/[^\w.-]+/g, '-').replace(/^[-.]+/, '').slice(0, 80).replace(/[-.]+$/, '') || 'page';
  return { ok: true, out: path.join(folder, base + '-p' + page + '.png') };
}

/**
 * Draws page `page` (1-based) of the PDF at `file`. Resolves { ok: true, out } or { ok: false, code: 1|2, words }.
 * deps (tests): platform, run, env, pdfpages, powershell, tmpdir.
 */
async function preview(file, { page = 1, out = null } = {}, deps = {}) {
  const platform = deps.platform || process.platform;
  const draw = DRAW[platform];
  if (!draw) return { ok: false, code: 1, words: 'kosmos preview cannot draw PDFs on this kind of computer (' + platform + ') yet.' };
  if (!Number.isInteger(page) || page < 1 || page > MAX_PAGE) return { ok: false, code: 2, words: '--page takes a page number from 1 to ' + MAX_PAGE + ', so nothing was drawn.' };
  const abs = path.resolve(String(file));
  const read = readPdf(abs);
  if (!read.ok) return { ok: false, code: 2, words: read.words };
  let where;
  try { where = outFor(out, abs, page, deps); } catch (e) {   // review 2: a temporary folder that cannot be made
    return { ok: false, code: 1, words: 'Kosmos could not make a folder for the picture in ' + (deps.tmpdir || os.tmpdir()) + ' (' + (e && e.code ? e.code : 'error') + '), so nothing was drawn. Name one with --out.' };
  }
  if (!where.ok) return { ok: false, code: 2, words: where.words };
  let work = null;
  try {
    work = fs.realpathSync(fs.mkdtempSync(path.join(deps.tmpdir || os.tmpdir(), 'kosmos-preview-work-')));
    const copy = path.join(work, 'source.pdf');
    fs.writeFileSync(copy, read.bytes, { mode: 0o600 });
    const got = await draw(copy, page - 1, work, deps);
    if (!got.ok) {
      if (got.range !== undefined) return { ok: false, code: 2, words: 'That PDF has ' + (typeof got.range === 'number' ? got.range + ' page' + (got.range === 1 ? '' : 's') : 'fewer pages') + ', so there is no page ' + page + ' to draw.' };
      return { ok: false, code: 1, words: got.words || 'This computer could not draw page ' + page + ' of that PDF. The file may be damaged, or locked with a password.' };
    }
    if (!isPng(got.png)) return { ok: false, code: 1, words: 'This computer could not draw page ' + page + ' of that PDF: the picture came out empty.' };
    placeAt(got.png, where.out);
    return { ok: true, out: where.out };
  } catch (e) {
    return { ok: false, code: 1, words: 'This computer could not draw page ' + page + ' of that PDF (' + (e && e.code ? e.code : 'error') + ').' };
  } finally {
    if (work) { try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* best effort */ } }
    if (!out && where && where.ok && !fs.existsSync(where.out)) { try { fs.rmdirSync(path.dirname(where.out)); } catch { /* not empty */ } }
  }
}

/** The command: args as typed after `kosmos preview`. Resolves { code, out: [lines], err: [lines] }. */
async function main(args, deps = {}) {
  const p = parseArgs(args);
  if (!p.ok) return p.help ? { code: 0, out: [p.words], err: [] } : { code: 2, out: [], err: [p.words] };
  const got = await preview(p.file, { page: p.page, out: p.out }, deps);
  return got.ok ? { code: 0, out: [got.out], err: [] } : { code: got.code, out: [], err: [got.words] };
}

if (require.main === module) {
  main(process.argv.slice(2)).then((r) => {
    for (const l of r.out) process.stdout.write(l + '\n');
    for (const l of r.err) process.stderr.write(l + '\n');
    process.exitCode = r.code;
  });
}

module.exports = { main, preview, parseArgs, isPng, onPath, windowsPowerShell, USAGE, WIN_SCRIPT, MAX_BYTES, TIMEOUT_MS };
