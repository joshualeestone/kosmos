#!/usr/bin/env node
'use strict';
/**
 * win-staging-verify.js -- verify a STAGED Windows build on the Windows box and write the
 * verification record `promote-channel.sh --family win` requires (via tools/win-staging-verified.sh).
 *
 * Josh's rule: everything goes to staging before it goes to prod, after his approval. A Windows
 * promote needs BOTH this record (the technical half) AND his explicit go (--approval-ref). This
 * script only ever writes the record; it never publishes, deploys, promotes or installs anything.
 *
 *   V1 (automated, read-only network): fetch the staging pointer (latest-win-staging.json) from
 *      the release base (engine/update.js's releaseBase: KOSMOS_RELEASE_BASE, else the real site),
 *      validate it with update.js's own Windows rule (readManifest), then stream the versioned zip
 *      into a temp file while hashing it (capped in bytes and time; the temp file is deleted) and
 *      fetch its .sha256. The computed sha must equal the pointer's and the sidecar's. The zip's
 *      manifest.json must name the pointer's version and a clean source commit (the record's
 *      source_sha).
 *   V2 (OPERATOR-ATTESTED in this slice): the Explorer unpack plus Z0-Z6, multiline and msg
 *      checks. Automating a second install beside the live Kosmos risks the box's logon tasks
 *      and engine-path, so a person runs them from the printed checklist and records each answer
 *      with --attest <id>=pass|fail. A check nobody attested is `not-run`, never `pass`. The
 *      answers name the build they were given on (--for-sha <sha256>, required with --attest),
 *      and a staging pointer that names another build by the time they are recorded is refused.
 *   V4: write the record (tools/lib/win-staging-record.js is its one spec) atomically at the
 *      reader's exact path, 0600. Never over an existing record for the same sha without
 *      --force-rewrite.
 *
 * DRY RUN unless --yes. Exit: 0 the record passes (written, or would be); 1 it fails (written, or
 * would be); 2 nothing could be decided (the base is unreachable or answers 408/429/5xx, a
 * transfer timed out, the pointer is unusable, or some check has not run and none failed), and no
 * record is written; 3 usage, or a refusal to overwrite an existing record.
 *
 *   node tools/win-staging-verify.js                      # V1 now, and the V2 checklist
 *   node tools/win-staging-verify.js --yes --for-sha <the sha256 the checklist named> \
 *        --attest install=<pass|fail> --attest z-checks=<pass|fail> \
 *        --attest multiline=<pass|fail> --attest msg=<pass|fail>   # V1 again, then write the record
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { parseArgs } = require('node:util');
const update = require('../engine/update');
const recordSpec = require('./lib/win-staging-record');

/** The staging pointer is ~300 bytes; 64 KiB is room for any honest pointer and nothing else. */
const POINTER_MAX_BYTES = 64 * 1024;
/** A .sha256 sidecar is one line ("<64 hex>  <name>"). */
const SIDECAR_MAX_BYTES = 4 * 1024;
/** The Windows zip is ~40 MB (Node runtime + app); 512 MiB is far above any real build and far
    below filling the box's disk with a hostile or runaway download. */
const ZIP_MAX_BYTES = 512 * 1024 * 1024;
/** manifest.json is ~300 bytes; the cap bounds an inflate bomb. */
const MANIFEST_MAX_BYTES = 64 * 1024;
/** The pointer and sidecar are tiny, so a slow answer means a problem, not a big file. */
const SMALL_FETCH_TIMEOUT_MS = 30 * 1000;
/** The whole zip download, start to last byte: minutes on a slow line, never forever. */
const ZIP_FETCH_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_CAPS = Object.freeze({
  pointerBytes: POINTER_MAX_BYTES, sidecarBytes: SIDECAR_MAX_BYTES, zipBytes: ZIP_MAX_BYTES,
  manifestBytes: MANIFEST_MAX_BYTES, smallTimeoutMs: SMALL_FETCH_TIMEOUT_MS, zipTimeoutMs: ZIP_FETCH_TIMEOUT_MS,
});
/** The arch build-kosmos-windows.sh builds by default (KOSMOS_WIN_ARCH overrides it there too). */
const DEFAULT_WINDOWS_ARCH = 'x64';
/** The arch becomes part of the temp zip's file name, so it is a plain token (x64, arm64). */
const WINDOWS_ARCH = /^[a-z0-9_]+$/;
/** HTTP answers that say the host is struggling, not that the build is wrong: a check cannot be
    failed on them, so they end the run as "cannot tell" like a timeout does. */
function isTransientHttpStatus(status) { return status === 408 || status === 429 || status >= 500; }
const { SOURCE_COMMIT } = recordSpec;
/** The signals that stop a console run: Ctrl+C (SIGINT), a kill (SIGTERM) and Ctrl+Break on
    Windows (SIGBREAK). Only the ones this OS has. */
const INTERRUPT_SIGNALS = Object.freeze(['SIGINT', 'SIGTERM', 'SIGBREAK'].filter((signal) => signal in os.constants.signals));
/** An interrupted run decided nothing and wrote no record, so it exits like "cannot tell". */
const INTERRUPTED_EXIT_CODE = 2;
/** What Windows answers when a rename cannot replace a file another program holds open. */
const RECORD_HELD_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);
/** What a hard link answers on a filesystem without them (FAT, exFAT) or a refused one. */
const LINK_UNSUPPORTED_CODES = new Set(['EPERM', 'ENOTSUP', 'ENOSYS', 'EXDEV']);
/** What the record's source_sha says when the bytes did not yield a trustworthy commit. */
const UNKNOWN_SOURCE = 'unknown';
const MANIFEST_ENTRY = 'manifest.json';
/** Where the promote runs: the site checkout on the Mac release box (docs/staging-channel.md). */
const PROMOTE_SITE_PLACEHOLDER = '"$HOME/work/chaoskosmos-site"';

const ZIP_END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const ZIP_CENTRAL_DIRECTORY_ENTRY = 0x02014b50;
const ZIP_LOCAL_FILE_HEADER = 0x04034b50;
const ZIP_MAX_COMMENT_BYTES = 0xffff;

function describeError(error) {
  if (!error) return 'unknown error';
  const cause = error.cause && (error.cause.code || error.cause.message);
  return cause ? `${error.message} (${cause})` : String(error.message || error);
}

/** A failure to SAVE a download is this box's problem, not the host's or the build's. */
function describeLocalSaveError(url, error, savedBytes) {
  if (error && error.code === 'ENOSPC') return `the disk is full: saving ${url} stopped after ${savedBytes} bytes (ENOSPC). Free some space and run again`;
  return `saving ${url} on this box failed after ${savedBytes} bytes: ${describeError(error)}`;
}

function writeAllSync(fd, bytes) {
  let offset = 0;
  while (offset < bytes.length) offset += fs.writeSync(fd, bytes, offset, bytes.length - offset);
}

/**
 * GET one URL with a byte cap and a time cap. `sink(chunk)` receives the body when given (the
 * zip, which is never held in memory); otherwise the body is returned. `transient` marks a result
 * that says nothing about the build (the host was not reached, or the transfer timed out), which
 * the caller turns into "cannot tell" rather than a failed check.
 */
async function fetchWithCaps(url, { fetchImpl, maxBytes, timeoutMs, log, sink }) {
  log(`fetch ${url}`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`timed out after ${timeoutMs} ms`)), timeoutMs);
  const abortReason = () => (controller.signal.aborted ? describeError(controller.signal.reason) : null);
  try {
    let response;
    try {
      response = await fetchImpl(url, { signal: controller.signal, headers: { 'cache-control': 'no-cache' }, redirect: 'follow' });
    } catch (error) {
      return { ok: false, transient: true, error: `could not reach ${url}: ${abortReason() || describeError(error)}` };
    }
    if (!response.ok) {
      if (response.body) await response.body.cancel().catch(() => {});
      return { ok: false, transient: isTransientHttpStatus(response.status), error: `${url} answered HTTP ${response.status}` };
    }
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      if (response.body) await response.body.cancel().catch(() => {});
      return { ok: false, transient: false, error: `${url} is ${declaredLength} bytes, over the ${maxBytes}-byte cap` };
    }
    const chunks = [];
    let total = 0;
    try {
      if (response.body) {
        for await (const chunk of response.body) {
          total += chunk.length;
          if (total > maxBytes) return { ok: false, transient: false, error: `${url} sent more than the ${maxBytes}-byte cap` };
          if (!sink) { chunks.push(Buffer.from(chunk)); continue; }
          try { sink(chunk); } catch (error) {
            return { ok: false, transient: true, error: describeLocalSaveError(url, error, total - chunk.length) };
          }
        }
      }
    } catch (error) {
      return { ok: false, transient: true, error: `reading ${url} failed after ${total} bytes: ${abortReason() || describeError(error)}` };
    }
    log(`fetched ${url}: HTTP ${response.status}, ${total} bytes`);
    return { ok: true, bytes: sink ? null : Buffer.concat(chunks), total };
  } finally {
    clearTimeout(timer);
  }
}

function readExactly(fd, length, position, what) {
  const buffer = Buffer.alloc(length);
  const read = fs.readSync(fd, buffer, 0, length, position);
  if (read !== length) throw new Error(`the zip ends inside ${what}`);
  return buffer;
}

/**
 * The bytes of one entry of a zip file, or null when the zip has no such entry. Reads only the
 * central directory and that entry (stored or deflated), capped at maxBytes, CRC-checked.
 * Throws on anything it cannot read honestly (not a zip, zip64, encryption, a bad CRC).
 */
function readZipEntry(zipFile, entryName, maxBytes) {
  const fd = fs.openSync(zipFile, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const tailLength = Math.min(size, 22 + ZIP_MAX_COMMENT_BYTES);
    const tail = readExactly(fd, tailLength, size - tailLength, 'its end record');
    let end = -1;
    for (let at = tailLength - 22; at >= 0; at -= 1) {
      if (tail.readUInt32LE(at) === ZIP_END_OF_CENTRAL_DIRECTORY) { end = at; break; }
    }
    if (end < 0) throw new Error('it is not a zip (no end-of-central-directory record)');
    const entryCount = tail.readUInt16LE(end + 10);
    const directorySize = tail.readUInt32LE(end + 12);
    const directoryOffset = tail.readUInt32LE(end + 16);
    if (entryCount === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
      throw new Error('it is a zip64 archive, which the Windows build never writes');
    }
    if (directoryOffset + directorySize > size) throw new Error('its central directory runs past the end of the file');
    const directory = readExactly(fd, directorySize, directoryOffset, 'its central directory');
    const seenNames = new Set();
    let found = null;
    let at = 0;
    for (let index = 0; index < entryCount; index += 1) {
      if (at + 46 > directory.length || directory.readUInt32LE(at) !== ZIP_CENTRAL_DIRECTORY_ENTRY) {
        throw new Error('its central directory is malformed');
      }
      const flags = directory.readUInt16LE(at + 8);
      const method = directory.readUInt16LE(at + 10);
      const crc = directory.readUInt32LE(at + 16);
      const compressedSize = directory.readUInt32LE(at + 20);
      const uncompressedSize = directory.readUInt32LE(at + 24);
      const nameLength = directory.readUInt16LE(at + 28);
      const extraLength = directory.readUInt16LE(at + 30);
      const commentLength = directory.readUInt16LE(at + 32);
      const localHeaderOffset = directory.readUInt32LE(at + 42);
      const name = directory.toString('utf8', at + 46, at + 46 + nameLength);
      at += 46 + nameLength + extraLength + commentLength;
      // Explorer and unzip keep the LAST of two same-named entries, and NTFS folds case, so a zip
      // that lists any path twice has no single honest reading: refuse it rather than pick one.
      const foldedName = name.toLowerCase();
      if (seenNames.has(foldedName)) throw new Error(`it lists ${name} more than once`);
      seenNames.add(foldedName);
      if (name === entryName) found = { flags, method, crc, compressedSize, uncompressedSize, localHeaderOffset };
    }
    if (!found) return null;
    const { flags, method, crc, compressedSize, uncompressedSize, localHeaderOffset } = found;
    if (flags & 1) throw new Error(`${entryName} is encrypted`);
    if (uncompressedSize > maxBytes || compressedSize > maxBytes) throw new Error(`${entryName} is over the ${maxBytes}-byte cap`);
    const local = readExactly(fd, 30, localHeaderOffset, `${entryName}'s header`);
    if (local.readUInt32LE(0) !== ZIP_LOCAL_FILE_HEADER) throw new Error(`${entryName}'s local header is malformed`);
    const dataStart = localHeaderOffset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
    const data = readExactly(fd, compressedSize, dataStart, entryName);
    let content;
    if (method === 0) content = data;
    else if (method === 8) content = zlib.inflateRawSync(data, { maxOutputLength: maxBytes });
    else throw new Error(`${entryName} uses compression method ${method}`);
    if (content.length !== uncompressedSize) throw new Error(`${entryName} inflated to ${content.length} bytes, not ${uncompressedSize}`);
    if ((zlib.crc32(content) >>> 0) !== crc) throw new Error(`${entryName} fails its CRC`);
    return content;
  } finally {
    fs.closeSync(fd);
  }
}

/** The manifest check: the zip says it is this version, for this arch, from a clean commit. */
function checkBuildManifest(zipFile, pointer, arch, maxBytes) {
  let content;
  try { content = readZipEntry(zipFile, MANIFEST_ENTRY, maxBytes); }
  catch (error) { return { result: 'fail', detail: `the zip could not be read: ${error.message}`, sourceSha: UNKNOWN_SOURCE }; }
  if (!content) return { result: 'fail', detail: `the zip has no ${MANIFEST_ENTRY}`, sourceSha: UNKNOWN_SOURCE };
  let manifest;
  try { manifest = JSON.parse(content.toString('utf8')); }
  catch (error) { return { result: 'fail', detail: `${MANIFEST_ENTRY} is not JSON (${error.message})`, sourceSha: UNKNOWN_SOURCE }; }
  const sourceSha = typeof manifest.source_sha === 'string' && SOURCE_COMMIT.test(manifest.source_sha) ? manifest.source_sha : UNKNOWN_SOURCE;
  const problems = [];
  if (manifest.version !== pointer.version) problems.push(`it names version ${JSON.stringify(manifest.version)}, not the pointer's ${pointer.version}`);
  if (manifest.platform !== 'win32') problems.push(`its platform is ${JSON.stringify(manifest.platform)}`);
  if (manifest.arch !== arch) problems.push(`its arch is ${JSON.stringify(manifest.arch)}, not ${arch}`);
  if (sourceSha === UNKNOWN_SOURCE) problems.push(`its source_sha ${JSON.stringify(manifest.source_sha)} is not a commit`);
  if (manifest.source_dirty !== false) problems.push(`its source_dirty is ${JSON.stringify(manifest.source_dirty)} (the build was not from a clean tree)`);
  if (problems.length) return { result: 'fail', detail: `${MANIFEST_ENTRY}: ${problems.join('; ')}`, sourceSha };
  return { result: 'pass', detail: `${MANIFEST_ENTRY}: version ${manifest.version}, ${manifest.platform}-${manifest.arch}, source ${sourceSha}, clean`, sourceSha };
}

/**
 * V1. Returns {verdict: 'cannot-tell', reason} when nothing about the build could be decided (no
 * record can be keyed without a trusted sha), else {verdict: 'checked', pointer, pointerUrl,
 * sourceSha, checkResults: {sha, manifest}}.
 */
async function verifyStagedBuild({
  base, fetchImpl = globalThis.fetch, arch = DEFAULT_WINDOWS_ARCH, tmpRoot = os.tmpdir(), caps = DEFAULT_CAPS, log = () => {},
  exitProcess = (code) => process.exit(code), interruptSignals = INTERRUPT_SIGNALS,
}) {
  const pointerUrl = `${base}/${update.pointerFor('win32', 'staging')}`;
  const pointerFetch = await fetchWithCaps(pointerUrl, { fetchImpl, maxBytes: caps.pointerBytes, timeoutMs: caps.smallTimeoutMs, log });
  if (!pointerFetch.ok) return { verdict: 'cannot-tell', reason: pointerFetch.error };
  let body;
  try { body = JSON.parse(pointerFetch.bytes.toString('utf8')); }
  catch (error) { return { verdict: 'cannot-tell', reason: `${pointerUrl} is not JSON (${error.message})` }; }
  const pointer = update.readManifest('win32', body, arch);
  if (!pointer) {
    return { verdict: 'cannot-tell', reason: `${pointerUrl} is not a usable Windows pointer (it needs an x.y.z version, a 64-hex sha256 and versioned = kosmos-<version>-win-${arch}.zip): ${JSON.stringify(body).slice(0, 300)}` };
  }

  const zipUrl = `${base}/${pointer.versioned}`;
  const sidecarFetch = await fetchWithCaps(`${zipUrl}.sha256`, { fetchImpl, maxBytes: caps.sidecarBytes, timeoutMs: caps.smallTimeoutMs, log });
  if (!sidecarFetch.ok && sidecarFetch.transient) return { verdict: 'cannot-tell', reason: sidecarFetch.error };
  let sidecarSha = null;
  let sidecarProblem = sidecarFetch.ok ? null : sidecarFetch.error;
  if (sidecarFetch.ok) {
    const firstField = sidecarFetch.bytes.toString('utf8').trim().split(/\s+/)[0] || '';
    if (/^[0-9a-fA-F]{64}$/.test(firstField)) sidecarSha = firstField.toLowerCase();
    else sidecarProblem = `${zipUrl}.sha256 names no sha256 (${JSON.stringify(firstField.slice(0, 80))})`;
  }

  const workDir = fs.mkdtempSync(path.join(tmpRoot, 'kosmos-win-verify-'));
  let zipFd = null;
  const removeWorkDir = () => {
    if (zipFd !== null) {
      try { fs.closeSync(zipFd); } catch (error) { log(`closing the partial download failed: ${describeError(error)}`); }
      zipFd = null;
    }
    fs.rmSync(workDir, { recursive: true, force: true });
  };
  // A stop mid-download (Ctrl+C, Ctrl+Break, a kill) must not leave up to ZIP_MAX_BYTES behind.
  const onInterrupt = (signal) => {
    try { removeWorkDir(); } catch (error) { log(`could not delete ${workDir}: ${describeError(error)}`); }
    log(`interrupted (${signal}): the partial download was deleted and no record was written`);
    exitProcess(INTERRUPTED_EXIT_CODE);
  };
  for (const signal of interruptSignals) process.on(signal, onInterrupt);
  try {
    const zipFile = path.join(workDir, pointer.versioned);
    const hash = crypto.createHash('sha256');
    zipFd = fs.openSync(zipFile, 'wx', 0o600);
    const zipFetch = await fetchWithCaps(zipUrl, {
      fetchImpl, maxBytes: caps.zipBytes, timeoutMs: caps.zipTimeoutMs, log,
      sink: (chunk) => { writeAllSync(zipFd, chunk); hash.update(chunk); },
    });
    if (!zipFetch.ok && zipFetch.transient) return { verdict: 'cannot-tell', reason: zipFetch.error };
    // The manifest is read back from this file, so it must hold exactly the bytes that were hashed.
    const savedBytes = zipFetch.ok ? fs.fstatSync(zipFd).size : null;
    fs.closeSync(zipFd);
    zipFd = null;
    if (zipFetch.ok && savedBytes !== zipFetch.total) {
      return { verdict: 'cannot-tell', reason: `the saved zip holds ${savedBytes} bytes, but ${zipFetch.total} bytes were hashed` };
    }

    const checked = { verdict: 'checked', pointer, pointerUrl, sourceSha: UNKNOWN_SOURCE, checkResults: {} };
    if (!zipFetch.ok) {
      checked.checkResults.sha = { result: 'fail', detail: zipFetch.error };
      checked.checkResults.manifest = { result: 'not-run', detail: 'the staged zip could not be downloaded' };
      return checked;
    }
    const computed = hash.digest('hex');
    const shaProblems = [];
    if (computed !== pointer.sha256) shaProblems.push(`the zip hashes to ${computed}, not the pointer's ${pointer.sha256}`);
    if (sidecarProblem) shaProblems.push(sidecarProblem);
    else if (sidecarSha !== pointer.sha256) shaProblems.push(`the sidecar names ${sidecarSha}, not the pointer's ${pointer.sha256}`);
    if (shaProblems.length) {
      checked.checkResults.sha = { result: 'fail', detail: shaProblems.join('; ') };
      checked.checkResults.manifest = { result: 'not-run', detail: 'the bytes are not the ones the pointer names' };
      return checked;
    }
    checked.checkResults.sha = { result: 'pass', detail: `${pointer.versioned} (${zipFetch.total} bytes) hashes to ${computed}, which the pointer and ${pointer.versioned}.sha256 both name` };
    const manifestCheck = checkBuildManifest(zipFile, pointer, arch, caps.manifestBytes);
    checked.checkResults.manifest = { result: manifestCheck.result, detail: manifestCheck.detail };
    checked.sourceSha = manifestCheck.sourceSha;
    return checked;
  } finally {
    for (const signal of interruptSignals) process.removeListener(signal, onInterrupt);
    removeWorkDir();
  }
}

const OPERATOR_CHECK_IDS = recordSpec.REQUIRED_CHECKS.filter((check) => check.by === 'operator').map((check) => check.id);

/** `--attest <id>=pass|fail` values -> {attestations: {id: result}, errors}. Only operator checks
    can be attested; each at most once. */
function parseAttestations(values) {
  const attestations = {};
  const errors = [];
  for (const value of values || []) {
    const match = /^([a-z0-9-]+)=(pass|fail)$/.exec(String(value));
    if (!match) { errors.push(`--attest ${JSON.stringify(value)} is not <check>=pass or <check>=fail`); continue; }
    const [, id, result] = match;
    const required = recordSpec.REQUIRED_CHECKS.find((check) => check.id === id);
    if (!required) { errors.push(`--attest names an unknown check ${JSON.stringify(id)} (the operator checks are ${OPERATOR_CHECK_IDS.join(', ')})`); continue; }
    if (required.by !== 'operator') { errors.push(`--attest ${id}: ${id} is an automated check this script runs itself; it cannot be attested`); continue; }
    if (id in attestations) { errors.push(`--attest ${id} is given twice`); continue; }
    attestations[id] = result;
  }
  return { attestations, errors };
}

/** The V2 checklist a person runs on the Windows box, on the same bytes V1 verified. */
function operatorChecklist({ base, pointer }) {
  const enginePathFile = '"$env:LOCALAPPDATA\\Kosmos\\runtime\\engine-path"';
  return [
    `V2 - the operator checks, on the bytes V1 just verified: ${pointer.version}, sha256 ${pointer.sha256}.`,
    "  STOP: get Josh's go before step 2. This box has ONE Kosmos. Running this build moves engine-path,",
    '  which the logon tasks run, onto the scratch folder, and e2e-zip.js drives the board on the live',
    '  port (it creates, restarts and removes an agent).',
    `  1. Download ${base}/${pointer.versioned} in a browser, so Windows marks it as downloaded.`,
    `     In PowerShell, (Get-FileHash <the downloaded zip> -Algorithm SHA256).Hash.ToLower() must print`,
    `     ${pointer.sha256}`,
    '     In the same PowerShell window, note where engine-path points now:',
    `       $enginePathBefore = (Get-Content ${enginePathFile} -Raw).Trim(); $enginePathBefore`,
    '  2. install: in Explorer, right-click the zip > Extract All... into a NEW scratch folder',
    '     (Explorer keeps the Mark of the Web on every file). Double-click Kosmos.exe there. The',
    `     board must open and serve ${pointer.version}.`,
    '  3. z-checks: node kosmos-scripts\\e2e-zip.js <the scratch folder> <a new test agent name>',
    '     Z0-Z6 must all PASS, with the answers on the board: Z0 board serves the zip, Z1 browser',
    '     sign-in, Z2 create, Z3 talk, Z4 restart, Z5 remove, Z6 restore + talk.',
    '  4. multiline: node kosmos-scripts\\multiline-check.js <that agent>',
    "     The agent's two-line answer must land on the board, both lines intact.",
    '  5. msg: node kosmos-scripts\\msg-check.js <that agent> <another agent> <SOMEWORD>',
    '     The agent-to-agent message must be delivered.',
    '  6. Put the box back. When $enginePathBefore is <repo>\\engine (a checkout):',
    '       node kosmos-scripts\\repoint-main.js <repo> "$env:LOCALAPPDATA\\Kosmos\\runtime\\node.exe"',
    '     otherwise run Kosmos.exe from the install it named. Then, in that same window,',
    `       (Get-Content ${enginePathFile} -Raw).Trim() -eq $enginePathBefore`,
    '     must print True.',
    'Then record each answer: replace every <pass|fail>. Nothing counts as passed unless you attest',
    'it, and --for-sha binds the answers to this build (a pointer that has moved since is refused):',
    `  node tools/win-staging-verify.js --yes --for-sha ${pointer.sha256} ${OPERATOR_CHECK_IDS.map((id) => `--attest ${id}=<pass|fail>`).join(' ')}`,
  ].join('\n');
}

function sha256Hex(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }

/**
 * Write the record at `file` atomically: a 0600 temp file in the same directory, fsynced, then
 * hard-linked into place (which refuses when a record already exists, and needs a filesystem
 * with hard links: NTFS on Windows) or, with forceRewrite, renamed over the old one. The temp
 * file is removed on every path, a failed write or fsync included.
 * Returns {written: true, recordSha256, replaced}, or {written: false, previous} when a record
 * exists, or {written: false, held: true, error} when the old record could not be replaced
 * (another program has it open); in both refusals the old record is unchanged.
 */
function writeRecordAtomically(file, record, { forceRewrite = false, log = () => {} } = {}) {
  const directory = path.dirname(file);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  let previous = null;
  try { previous = fs.readFileSync(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const describePrevious = () => {
    let summary = '';
    try { const old = JSON.parse(previous.toString('utf8')); summary = `result ${old.result}, at ${old.at}, `; } catch { summary = 'unparseable, '; }
    return `${summary}sha256 ${sha256Hex(previous)}`;
  };
  if (previous && !forceRewrite) return { written: false, previous: describePrevious() };
  const bytes = Buffer.from(`${JSON.stringify(record, null, 2)}\n`);
  const temp = path.join(directory, `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  let fd = null;
  try {
    fd = fs.openSync(temp, 'wx', 0o600);
    writeAllSync(fd, bytes);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    if (previous) {
      try { fs.renameSync(temp, file); }
      catch (error) {
        if (RECORD_HELD_CODES.has(error.code)) return { written: false, held: true, error: `${error.code}: ${error.message}` };
        throw error;
      }
      log(`--force-rewrite: replaced ${file} (it held ${describePrevious()})`);
    } else {
      try { fs.linkSync(temp, file); }
      catch (error) {
        if (error.code === 'EEXIST') return { written: false, previous: 'a record that appeared while this run wrote' };
        throw error;
      }
    }
  } finally {
    if (fd !== null) {
      // Only reached when the write or fsync already threw; that error is the one reported.
      try { fs.closeSync(fd); } catch (closeError) { log(`closing ${temp} after a failed write also failed: ${describeError(closeError)}`); }
    }
    fs.rmSync(temp, { force: true });
  }
  return { written: true, recordSha256: sha256Hex(bytes), replaced: Boolean(previous) };
}

function promoteCommand(record) {
  return `bash tools/promote-channel.sh ${PROMOTE_SITE_PLACEHOLDER} --family win --approved-version ${record.version} --approved-sha ${record.sha256} --approval-ref <Josh's Slack message ts or permalink>`;
}

function printSummary(out, verification, record) {
  out(`win-staging-verify: staging pointer ${verification.pointerUrl}: ${record.version} ${record.sha256}`);
  out(`win-staging-verify: source_sha ${record.source_sha}`);
  for (const check of record.checks) {
    out(`  ${check.id.padEnd(10)} ${check.result.padEnd(8)} ${check.by.padEnd(10)} ${check.detail || check.label}`);
  }
}

const USAGE = [
  'usage: node tools/win-staging-verify.js [--yes] [--for-sha <sha256> --attest <check>=pass|fail ...] [--force-rewrite]',
  '  --attest needs --for-sha: the sha256 of the build the checks were run on (the checklist names it).',
  `  operator checks: ${OPERATOR_CHECK_IDS.join(', ')}`,
  '  KOSMOS_RELEASE_BASE overrides the release base; KOSMOS_WIN_VERIFY_DIR the record directory.',
].join('\n');

async function main(argv, { env = process.env, fetchImpl = globalThis.fetch, stdout = (line) => process.stdout.write(`${line}\n`), stderr = (line) => process.stderr.write(`${line}\n`), now = () => new Date(), tmpRoot = os.tmpdir(), caps = DEFAULT_CAPS, base = update.releaseBase() } = {}) {
  let options;
  try {
    ({ values: options } = parseArgs({ args: argv, strict: true, allowPositionals: false, options: {
      yes: { type: 'boolean', default: false },
      attest: { type: 'string', multiple: true, default: [] },
      'force-rewrite': { type: 'boolean', default: false },
      'for-sha': { type: 'string' },
      help: { type: 'boolean', default: false },
    } }));
  } catch (error) {
    stderr(`win-staging-verify: ${error.message}\n${USAGE}`);
    return 3;
  }
  if (options.help) { stdout(USAGE); return 0; }
  const { attestations, errors } = parseAttestations(options.attest);
  if (errors.length) { stderr(`win-staging-verify: ${errors.join('\n  ')}\n${USAGE}`); return 3; }
  const forSha = options['for-sha'] === undefined ? null : String(options['for-sha']).toLowerCase();
  if (forSha !== null && !recordSpec.RECORD_SHA256.test(forSha)) {
    stderr(`win-staging-verify: --for-sha ${JSON.stringify(options['for-sha'])} is not a sha256 (64 hex)\n${USAGE}`);
    return 3;
  }
  // An answer counts only for the build it was given on: without the sha, answers from a run on
  // one build would land in the record of whatever the pointer names by the time they are typed.
  if (Object.keys(attestations).length && forSha === null) {
    stderr(`win-staging-verify: --attest needs --for-sha <the sha256 the checks were run on>; the checklist prints it.\n${USAGE}`);
    return 3;
  }

  const arch = env.KOSMOS_WIN_ARCH || DEFAULT_WINDOWS_ARCH;
  if (!WINDOWS_ARCH.test(arch)) { stderr(`win-staging-verify: KOSMOS_WIN_ARCH ${JSON.stringify(arch)} is not an arch like x64\n${USAGE}`); return 3; }
  const log = (line) => stderr(`win-staging-verify: ${line}`);
  const verification = await verifyStagedBuild({ base, fetchImpl, arch, tmpRoot, caps, log });
  if (verification.verdict === 'cannot-tell') {
    stderr(`win-staging-verify: CANNOT TELL - ${verification.reason}. No record was written.`);
    return 2;
  }
  if (forSha !== null && verification.pointer.sha256 !== forSha) {
    stderr(`win-staging-verify: REFUSING - the staging pointer now names ${verification.pointer.version} (${verification.pointer.sha256}), not the build these answers are for (${forSha}). It moved after the checklist was run; run the checklist on the new build. No record was written.`);
    return 3;
  }

  const checkResults = { ...verification.checkResults };
  for (const [id, result] of Object.entries(attestations)) checkResults[id] = { result, detail: `attested by the operator (--attest ${id}=${result})` };
  const record = recordSpec.buildRecord({
    version: verification.pointer.version, sha256: verification.pointer.sha256, sourceSha: verification.sourceSha,
    checkResults, at: now().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  });
  const failed = record.checks.filter((check) => check.result === 'fail').map((check) => check.id);
  const notRun = record.checks.filter((check) => check.result === 'not-run').map((check) => check.id);
  const undecided = record.result === 'fail' && failed.length === 0;
  printSummary(stdout, verification, record);
  if (notRun.some((id) => OPERATOR_CHECK_IDS.includes(id))) stdout(`\n${operatorChecklist({ base, pointer: verification.pointer })}\n`);

  const file = recordSpec.recordPath(env, record.sha256);
  const verdictCode = record.result === 'pass' ? 0 : (undecided ? 2 : 1);
  if (!options.yes) {
    stdout(`win-staging-verify: DRY RUN - nothing written. With --yes this run would write ${file}:`);
    stdout(JSON.stringify(record, null, 2));
    return verdictCode;
  }
  if (undecided) {
    stderr(`win-staging-verify: NOT WRITING - no check failed, but ${notRun.join(', ')} did not run. A record now would turn a HOLD into a refusal; run the checklist above and attest each answer.`);
    return 2;
  }
  let written;
  try {
    written = writeRecordAtomically(file, record, { forceRewrite: options['force-rewrite'], log });
  } catch (error) {
    const linkHint = LINK_UNSUPPORTED_CODES.has(error.code) && error.syscall === 'link'
      ? ' A new record is hard-linked into place, so its directory must be on a filesystem with hard links (NTFS, not FAT or exFAT).'
      : '';
    stderr(`win-staging-verify: could not write ${file}: ${describeError(error)}.${linkHint} No record was written.`);
    return 2;
  }
  if (written.held) {
    stderr(`win-staging-verify: REFUSING - could not replace ${file} (${written.error}). Close whatever has the record open (an editor or a viewer), then run again. The old record is unchanged.`);
    return 3;
  }
  if (!written.written) {
    stderr(`win-staging-verify: REFUSING - a record for ${record.sha256} already exists at ${file} (${written.previous}). Pass --force-rewrite to replace it.`);
    return 3;
  }
  stdout(`win-staging-verify: wrote ${file} record_sha256=${written.recordSha256} result=${record.result}${written.replaced ? ' (replaced the previous record)' : ''}`);
  if (record.result === 'pass') {
    stdout('win-staging-verify: PASS. Post the result and record_sha256 above, copy this record to the promoting box');
    stdout('  ($HOME/.local/state/kosmos/release-verify/ there, or $KOSMOS_WIN_VERIFY_DIR), and hand Josh this line.');
    stdout('  It is run ONLY after his go for this exact build, with --approval-ref naming his message:');
    stdout(`  ${promoteCommand(record)}`);
  } else {
    stdout(`win-staging-verify: FAIL (${failed.join(', ')}). This build cannot be promoted; the gate refuses it.`);
  }
  return verdictCode;
}

module.exports = {
  DEFAULT_CAPS, fetchWithCaps, readZipEntry, checkBuildManifest, verifyStagedBuild,
  parseAttestations, operatorChecklist, writeRecordAtomically, promoteCommand, main,
};

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (error) => {
    process.stderr.write(`win-staging-verify: crashed: ${error && error.stack ? error.stack : error}\n`);
    process.exitCode = 2;
  });
}
