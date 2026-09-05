'use strict';

/**
 * Bringing the COLLECTED daily product-feedback reports back down for triage
 * (kosmos#2296, the collect -> triage bridge of the #2037/#2246 loop).
 *
 * The loop: engine/feedback.js authors a report locally -> engine/feedbacksend.js
 * transmits it (opt-in gated, home-paths scrubbed) -> the chaoskosmos-site
 * /api/feedback route (#97) stores it as JSON to @vercel/blob under an
 * UNGUESSABLE name (addRandomSuffix), enumerable only via the blob API + the
 * store token -> and engine/feedback-triage.js reads `.md` reports from a --dir.
 * NOTHING joined the last two: the blobs sit in the store and triage cannot see
 * them. THIS is that join. `pull` lists the feedback blobs, fetches each JSON
 * record, and writes it as a `.md` file (feedback.js's exact frontmatter+body
 * shape) into a directory `kosmos feedback triage --dir` then reads unchanged.
 *
 * 🔑 TOKEN VIA secrets-map, NOT env or a hard-coded path. The blob token is a
 * credential; it is read through `secrets-map.sh value <target>` so the map is
 * the single source of truth and the token never lands in argv or a repo. The
 * build is therefore NOT blocked on the token being provisioned: until it is
 * filed (target FEEDBACK_TOKEN_TARGET, via /add-secret), pull returns a clear
 * "token not filed" answer and writes nothing -- it starts working the moment
 * the token exists, with no code change.
 *
 * 🛑 READ-ONLY AGAINST THE STORE. pull only lists + GETs blobs; it never puts or
 * deletes. A malformed blob is skipped with a note, never written as a corrupt
 * report, and the write is write-then-rename so an interrupted pull cannot leave
 * a half-file a later triage treats as a real, truncated report.
 *
 * ⚠️ WEAKEST PREMISE: the Vercel Blob REST list shape (`GET <api>/?prefix=..`,
 * `Authorization: Bearer <token>`, `{ blobs: [{ url, pathname }], hasMore,
 * cursor }`) and public per-blob `url`. Built + hermetically tested against that
 * documented shape with an injectable transport; a live run once the token is
 * filed confirms or corrects the exact API, and the transport seam localises any
 * fix to one function.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const store = require('./store');

const BLOB_API = 'https://blob.vercel-storage.com';
const PREFIX = 'feedback/';
// The secrets-map target the blob token is filed under. Documented here and on
// kosmos#2296 so /add-secret files it under this exact name.
const FEEDBACK_TOKEN_TARGET = 'vercel-blob-feedback';
// Default landing dir for pulled reports, under the data root (prod-inert when
// AGENT_WORKFORCE_DATA is unset, like the rest of the store).
const DEFAULT_DIR = path.join(store.ROOT, 'collected-feedback');

let transport = null; // tests inject { list: async(token)=>[{url,pathname}], get: async(url)=>text }
function setTransport(t) { transport = t; }

/**
 * The @vercel/blob read/write token, via the secrets map. Returns null (never
 * throws, never a partial) when the map, the tool, or the target is absent --
 * the caller turns that into a clear "not filed yet" answer. `value` is read
 * over a pipe (not a tty), which the accessor requires.
 */
function token() {
  const home = process.env.HOME || '';
  const bins = ['secrets-map.sh', path.join(home, '.local', 'bin', 'secrets-map.sh')];
  for (const bin of bins) {
    try {
      const out = execFileSync(bin, ['value', FEEDBACK_TOKEN_TARGET], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 8000,
      });
      const t = String(out || '').trim();
      if (t) return t;
    } catch { /* tool or target absent here; try the next candidate */ }
  }
  return null;
}

async function defaultList(tok) {
  const blobs = [];
  let cursor = null;
  // Page through, so a large corpus is not truncated at the API's default limit.
  do {
    let url = BLOB_API + '/?prefix=' + encodeURIComponent(PREFIX) + '&limit=1000';
    if (cursor) url += '&cursor=' + encodeURIComponent(cursor);
    const res = await fetch(url, { headers: { authorization: 'Bearer ' + tok } });
    if (!res || !res.ok) throw new Error('blob list HTTP ' + (res && res.status));
    const j = await res.json();
    if (Array.isArray(j && j.blobs)) blobs.push(...j.blobs);
    cursor = j && j.hasMore ? j.cursor : null;
  } while (cursor);
  return blobs;
}

async function defaultGet(url) {
  const res = await fetch(url);
  if (!res || !res.ok) throw new Error('blob GET HTTP ' + (res && res.status));
  return res.text();
}

/** Reconstruct feedback.js's exact on-disk shape from a stored record, so triage
 *  reads a pulled report byte-compatibly with a locally-authored one. */
function toMarkdown(rec) {
  const header = [
    '---',
    'date: ' + (rec && rec.date ? rec.date : ''),
    'install: ' + (rec && rec.install ? rec.install : 'unknown'),
    'generated_at: ' + (rec && rec.generated_at ? rec.generated_at : ''),
    '---',
    '',
  ].join('\n');
  return header + String(rec && rec.body == null ? '' : rec.body).replace(/\s*$/, '') + '\n';
}

/** A collision-free, human-legible filename. The date leads (so `ls` sorts by
 *  day) and the install disambiguates the many installs that share a day; the
 *  frontmatter still carries the real date, and triage's --dir now reads that as
 *  the date (a non-`YYYY-MM-DD.md` name), so `--since` still applies. */
function fileName(rec) {
  const date = rec && /^\d{4}-\d{2}-\d{2}$/.test(rec.date) ? rec.date : 'undated';
  const inst = String((rec && rec.install) || 'unknown').replace(/[^\w.-]/g, '').slice(0, 64) || 'unknown';
  return date + '__' + inst + '.md';
}

/**
 * Pull every collected feedback report into `dir` as `.md` files triage reads.
 * Idempotent: a re-run rewrites the same per-(install,date) files rather than
 * duplicating. Returns a summary; never throws into the caller.
 */
async function pull(dir, opts) {
  const o = opts || {};
  const target = dir || DEFAULT_DIR;
  const tp = transport || { list: defaultList, get: defaultGet };
  const tok = o.token || token();
  if (!tok) {
    return {
      ok: false, written: 0, skipped: 0, dir: target,
      because: 'the collected-feedback token is not filed yet (secrets-map target "'
        + FEEDBACK_TOKEN_TARGET + '"). File it with /add-secret and re-run; nothing else changes.',
    };
  }
  let blobs;
  try { blobs = await tp.list(tok); }
  catch { return { ok: false, written: 0, skipped: 0, dir: target, because: 'could not list the collected feedback (the store or network did not answer)' }; }
  try { fs.mkdirSync(target, { recursive: true }); }
  catch { return { ok: false, written: 0, skipped: 0, dir: target, because: 'could not create the destination directory' }; }
  let written = 0;
  let skipped = 0;
  for (const b of (Array.isArray(blobs) ? blobs : [])) {
    if (!b || typeof b.url !== 'string') { skipped += 1; continue; }
    let rec;
    try { rec = JSON.parse(await tp.get(b.url)); }
    catch { skipped += 1; continue; }
    if (!rec || typeof rec !== 'object' || typeof rec.body !== 'string') { skipped += 1; continue; }
    try {
      const dest = path.join(target, fileName(rec));
      const tmp = dest + '.tmp';
      fs.writeFileSync(tmp, toMarkdown(rec));
      fs.renameSync(tmp, dest);
      written += 1;
    } catch { skipped += 1; }
  }
  return { ok: true, written, skipped, total: (Array.isArray(blobs) ? blobs.length : 0), dir: target };
}

module.exports = {
  pull, setTransport, token, toMarkdown, fileName,
  FEEDBACK_TOKEN_TARGET, PREFIX, DEFAULT_DIR, BLOB_API,
};
