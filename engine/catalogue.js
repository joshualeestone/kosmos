'use strict';
/**
 * #4555 (#4554 parts 1-2): the catalogue of ready-made ROLES beyond the original set in
 * engine/roles.js, and of prebuilt TEAMS (a lead plus 1 to 5 reports) a person can create in one
 * go (#4557).
 *
 * #4632: the catalogue no longer ships inside Kosmos. It is built and signed by the public repo
 * joshualeestone/kosmos-catalogue and published at installkosmos.com/catalogue/. Kosmos downloads
 * it only when it is asked for: the role picker (/api/roles?catalogue=1), `kosmos agent roles`, a
 * create for a role the board does not hold, and the Team step's reads (#4557: `GET /api/teams/seeded`
 * and `/api/teams/seeded/<key>` in server.js, through engine/teamseed.js `refresh`). It keeps it
 * in the data folder, and uses it only when its Ed25519 signature verifies against PUBLIC_KEY
 * below. Until the first download, and whenever the stored copy does not verify, there is no
 * catalogue: the picker shows the original roles and there are no teams.
 *
 * This module is the one reader of the stored copy: roles.js merges `rawRoles()` into ROLES (and
 * again through `remerge()` after a download), and team creation reads `teams()` and
 * `memberInstructions()`.
 *
 * It must not require ./roles at load: roles.js requires this module while it builds ROLES.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

/* The Ed25519 public key of joshualeestone/kosmos-catalogue (its signing-key.pub.pem). Changing
   the key there needs a Kosmos release carrying the new one here. */
const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAgvJCzB8DWrcrRCw/rOTLUIj+ii/Sy0TJI7uKogLNpN0=
-----END PUBLIC KEY-----
`;
const DEFAULT_BASE = 'https://installkosmos.com/catalogue/';
/* The published file's format (kosmos-catalogue build.js `version`). The address below names no
   version, so it is a contract: catalogue.json stays format 2 for as long as a release that reads
   it is in use, and a new format is published under a new file name beside it, never in its place
   (every shipped Kosmos would otherwise lose the catalogue for good). */
const FORMAT = 2;
/* The oldest catalogue this version accepts: the serial published when it was released. A copy
   holding no catalogue yet has nothing newer to compare a download with, so without this floor an
   old signed file served to it would be taken. Raise it at a release that should stop accepting
   older catalogues. */
const MIN_SERIAL = 1790732878;   // the first catalogue published (kosmos-catalogue b2b4b36, 2026-09-30 01:47 UTC)
const MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 8000;
// A picker opened twice in a minute downloads once. A failed try waits as long as a good one.
const MIN_GAP_MS = 10 * 60 * 1000;
/* #4720: a team member's portrait is published beside the catalogue (avatars/<id>.webp) and named
   in it with its sha256, so the signature that covers the catalogue covers the image too. The cap
   is the catalogue builder's own (kosmos-catalogue build.js MAX_PORTRAIT_BYTES): a larger file is
   never published, so one that arrives larger is not the portrait. */
const PORTRAIT_MAX_BYTES = 512 * 1024;
// The only path a portrait may have: the builder's avatars/<team>-<slot>.webp, and what the site
// passes through (chaoskosmos-site vercel.json). Nothing here can name another folder or address.
const PORTRAIT_RE = /^avatars\/[a-z0-9]+(-[a-z0-9]+)*\.webp$/;
// A portrait that failed to download is not asked for again for a minute: the Team screen asks
// once per member made, and a retry of a failed member must not become a stream of requests.
const PORTRAIT_GAP_MS = 60 * 1000;

/** Where the catalogue is downloaded from. KOSMOS_CATALOGUE_BASE is a test seam, like
 *  KOSMOS_RELEASE_BASE: whatever it names must still carry a signature PUBLIC_KEY accepts. */
function base() {
  const b = process.env.KOSMOS_CATALOGUE_BASE || DEFAULT_BASE;
  return b.endsWith('/') ? b : b + '/';
}

/** The stored copy: `{ sig, text }`, the signature and the exact text it covers, in one file so
 *  one rename replaces both. Lazily, so the data root is resolved when it is first needed. */
function cacheFile() { return path.join(require('./store').ROOT, 'catalogue', 'catalogue.json'); }

let key = PUBLIC_KEY;
let data;            // undefined: not read yet; null: none usable; else the parsed catalogue
let lastTry = 0;
let lastError = null;
let lastRefused = false;   // the last download arrived and was REFUSED (its signature, format or serial)
let inflight = null;
// Keyed by the hash AND the file name: two members may share one image under two names, and one
// name failing must not answer for the other.
const portraitFailed = new Map();     // "<sha256> <image>" -> { at, because }: the last failed download
const portraitInflight = new Map();   // "<sha256> <image>" -> the download under way
/* A portrait that verified but could not be saved (a full or read-only disk; on Windows, a file
   held open) is held here instead, so it is downloaded once and not on every ask. One entry per
   portrait, each at most PORTRAIT_MAX_BYTES. An entry the catalogue no longer names is dropped the
   next time a portrait is downloaded (prunePortraits), not before: until then it is only unused,
   since portrait() serves nothing the held catalogue does not name. */
const portraitUnsaved = new Map();    // sha256 -> bytes

/** Tests sign with their own key pair. In-process only: nothing outside this process can reach it. */
function useKeyForTest(pem) { key = pem || PUBLIC_KEY; data = undefined; lastTry = 0; lastError = null; lastRefused = false; portraitFailed.clear(); portraitUnsaved.clear(); portraitInflight.clear(); }

const KEY_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const isText = (v) => typeof v === 'string' && v.length > 0;

/** Why a parsed catalogue is not one this version can use, or null. Signed data is trusted for
 *  its origin, not for being the shape this version reads (a newer format, a builder bug). */
function shapeProblem(c) {
  if (!c || typeof c !== 'object') return 'it is not an object';
  if (c.version !== FORMAT) return `format version ${JSON.stringify(c.version)} is not one this version reads`;
  if (!Number.isInteger(c.serial) || c.serial < MIN_SERIAL) return `its serial ${JSON.stringify(c.serial)} is older than this version of Kosmos (${MIN_SERIAL})`;
  // The serial is the publish time in seconds. One far in the future (a millisecond timestamp, a typo)
  // would make every board refuse every later catalogue for good, so it is refused here instead.
  if (c.serial > Math.floor(Date.now() / 1000) + 86400) return `its serial ${c.serial} is later than tomorrow`;
  if (!Array.isArray(c.groups) || !c.groups.every(isText)) return 'groups is not a list of names';
  if (!Array.isArray(c.roles) || !Array.isArray(c.teams)) return 'roles or teams is not a list';
  for (const r of c.roles) {
    if (!r || typeof r.key !== 'string' || !KEY_RE.test(r.key) || !isText(r.label) || !isText(r.blurb) || !isText(r.firstAction) || !isText(r.group)
      || !Array.isArray(r.instructions) || !r.instructions.every((l) => typeof l === 'string')) {
      return `role ${JSON.stringify(r && r.key)} is incomplete`;
    }
  }
  /* Nothing in the text may read as something Kosmos acts on: an HTML comment (how Kosmos marks
     the blocks it manages inside an instruction file, messages.START and END among them) or a
     template marker other than {{NAME}} (the one create fills in). The catalogue repo's builder
     refuses both; this keeps the signature from being the only defence. */
  const blob = JSON.stringify([c.groups, c.roles, c.teams]);
  if (blob.includes('<!--') || /\{\{(?!NAME\}\})/.test(blob)) return 'it carries a comment or template marker';
  const roleKeys = c.roles.map((r) => r.key);
  if (new Set(roleKeys).size !== roleKeys.length) return 'two roles share a key';
  const teamKeys = c.teams.map((t) => t && t.key);
  if (new Set(teamKeys).size !== teamKeys.length) return 'two teams share a key';
  for (const t of c.teams) {
    if (!t || typeof t.key !== 'string' || !KEY_RE.test(t.key) || !isText(t.label) || !t.project || !isText(t.project.goal) || !Array.isArray(t.members)
      || !['business', 'personal'].includes(t.kind) || !Number.isInteger(t.rank)) {
      return `team ${JSON.stringify(t && t.key)} is incomplete`;
    }
    for (const m of t.members) {
      if (!m || !isText(m.slot) || !isText(m.role) || !isText(m.title) || !isText(m.name) || !Array.isArray(m.focus) || !m.focus.every(isText)
        || !(m.reportsTo === null || m.reportsTo === 'lead')) {
        return `a member of team ${t.key} is incomplete`;
      }
    }
    const leads = t.members.filter((m) => m.reportsTo === null).length;
    // Josh, 09-30 17:27: a team is 2 to 6 people, some small on purpose (#4555): a lead and 1 to 5 reports.
    if (leads !== 1 || t.members.length - leads < 1 || t.members.length - leads > 5) return `team ${t.key} is not a lead and 1 to 5 reports`;
  }
  return null;
}

/**
 * Check a downloaded or stored catalogue: the signature over its exact bytes, then its shape.
 * @returns {{ok: true, catalogue: object} | {ok: false, because: string}}
 */
function check(bytes, sig) {
  let good = false;
  try { good = crypto.verify(null, bytes, crypto.createPublicKey(key), Buffer.from(String(sig).trim(), 'base64')); } catch { good = false; }
  if (!good) return { ok: false, because: 'its signature does not verify' };
  let c;
  try { c = JSON.parse(bytes.toString('utf8')); } catch { return { ok: false, because: 'it is not JSON' }; }
  const problem = shapeProblem(c);
  return problem ? { ok: false, because: problem } : { ok: true, catalogue: c };
}

/** The stored catalogue, checked, or null. Read once; `refresh()` replaces it. When the stored copy
 *  is unreadable or no longer verifies, the next download is held only to MIN_SERIAL, not to the
 *  serial last held (which lived in that copy): acceptable, since it takes local damage first. */
function load() {
  if (data !== undefined) return data;
  data = null;
  /* A test run (node --test) that did not sandbox the data root never reads the stored copy: it
     would be the operator's own, and the test's roles would depend on this machine. A test that
     needs the catalogue sandboxes the root and stores the fixture (test-support/catalogue-fixture). */
  if (process.env.NODE_TEST_CONTEXT && !process.env.AGENT_WORKFORCE_DATA) return data;
  let stored;
  try { stored = JSON.parse(fs.readFileSync(cacheFile(), 'utf8')); } catch (err) {
    if (!(err && err.code === 'ENOENT')) lastError = 'the stored catalogue could not be read';
    return data;
  }
  const r = stored && typeof stored.text === 'string' ? check(Buffer.from(stored.text, 'utf8'), stored.sig) : { ok: false, because: 'it is not in the stored shape' };
  if (r.ok) data = r.catalogue;
  else {
    lastError = `the stored catalogue was not used: ${r.because}`;
    process.stderr.write(`kosmos: ${lastError}\n`);
  }
  return data;
}

/** The serial of the stored copy when it reads and verifies, else null. */
function storedSerial() {
  try {
    const stored = JSON.parse(fs.readFileSync(cacheFile(), 'utf8'));
    const r = check(Buffer.from(stored.text, 'utf8'), stored.sig);
    return r.ok ? r.catalogue.serial : null;
  } catch { return null; }
}

function readRoles() { const c = load(); return c ? c : { groups: [], roles: [] }; }
function readTeams() { const c = load(); return c ? c : { teams: [] }; }

/** The body of url, refused as soon as it is known to exceed `max` bytes: by its Content-Length
 *  before reading, and by a running count while reading, so an oversized answer is never held. */
async function fetchBytes(doFetch, url, stop, max = MAX_BYTES) {
  const signal = stop ? AbortSignal.any([AbortSignal.timeout(TIMEOUT_MS), stop]) : AbortSignal.timeout(TIMEOUT_MS);
  const res = await doFetch(url, { signal, cache: 'no-store' });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  const tooBig = () => new Error(`${url} is larger than ${max} bytes`);
  if (Number(res.headers.get('content-length')) > max) throw tooBig();
  if (!res.body) return Buffer.alloc(0);
  const chunks = [];
  let total = 0;
  for await (const chunk of res.body) {
    total += chunk.length;
    if (total > max) {
      try { await res.body.cancel(); } catch { /* already closed */ }
      throw tooBig();
    }
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/**
 * Download the catalogue when it is due (never more than once per MIN_GAP_MS unless `force`),
 * check it, and keep it when it verifies and is not older than the one already held. Never
 * throws: a failure leaves the stored catalogue as it was and is reported by `status()`.
 * @param {{force?: boolean, fetcher?: Function}} [opts]
 * @returns {Promise<object>} status()
 */
function refresh(opts = {}) {
  if (inflight) return inflight;
  // The same condition load() honours: a test run with no sandboxed data root neither reads nor
  // writes the operator's stored copy, and does not download, whatever fetcher it passes.
  if (process.env.NODE_TEST_CONTEXT && !process.env.AGENT_WORKFORCE_DATA) return Promise.resolve(status());
  // No test run downloads from installkosmos.com (#4253): one that passes no fetcher must name the
  // address itself (tools/run-tests.sh pins a dead port), so a test run on its own is covered too.
  if (process.env.NODE_TEST_CONTEXT && !opts.fetcher && !process.env.KOSMOS_CATALOGUE_BASE) return Promise.resolve(status());
  if (!opts.force && Date.now() - lastTry < MIN_GAP_MS) return Promise.resolve(status());
  lastTry = Date.now();
  inflight = (async () => {
    try {
      const doFetch = opts.fetcher || fetch;
      // One controller per pair, so when one of the two fails the other stops too.
      const download = async (query) => {
        const ctl = new AbortController();
        try {
          return await Promise.all([
            fetchBytes(doFetch, base() + 'catalogue.json' + query, ctl.signal),
            fetchBytes(doFetch, base() + 'catalogue.json.sig' + query, ctl.signal),
          ]);
        } catch (err) { ctl.abort(); throw err; }
      };
      let [bytes, sig] = await download('');
      let r = check(bytes, sig.toString('utf8'));
      /* Just after a publish, a cache on the way can hold the new file with the old signature, or
         the reverse: it reads as a bad signature. Ask once more past the caches before refusing. */
      if (!r.ok && /signature/.test(r.because)) {
        [bytes, sig] = await download(`?fresh=${Date.now()}`);
        r = check(bytes, sig.toString('utf8'));
      }
      if (!r.ok) throw Object.assign(new Error(`the downloaded catalogue was refused: ${r.because}`), { refused: true });
      // It is stored as text, so it must survive the round trip to text byte for byte (a BOM or
      // invalid UTF-8 would not): refused now, rather than lost at the next restart.
      const text = bytes.toString('utf8');
      if (!Buffer.from(text, 'utf8').equals(bytes)) throw Object.assign(new Error('the downloaded catalogue was refused: it is not plain UTF-8 text'), { refused: true });
      const held = load();
      if (held && r.catalogue.serial < held.serial) {
        throw new Error(`the downloaded catalogue is older than the one held (${r.catalogue.serial} < ${held.serial})`);
      }
      // A different file under the serial already held is a publisher error, but it is still what was
      // signed: take it whole (memory, ROLES and the stored copy) rather than half.
      const changed = !held || held.serial !== r.catalogue.serial || JSON.stringify(held) !== JSON.stringify(r.catalogue);
      // The same serial is written again only when the stored copy is gone or no longer verifies
      // (a disk cleanup, say), so what is held in memory survives a restart.
      /* A copy that verified is used even when saving it fails (on Windows another process can
         hold the stored file open): the save failure is reported, and the next download saves it. */
      let saveError = null;
      if (changed || storedSerial() !== r.catalogue.serial) {
        const file = cacheFile();
        const tmp = `${file}.${process.pid}.tmp`;
        try {
          fs.mkdirSync(path.dirname(file), { recursive: true });
          fs.writeFileSync(tmp, JSON.stringify({ sig: sig.toString('utf8').trim(), text }));
          fs.renameSync(tmp, file);
        } catch (err) {
          try { fs.rmSync(tmp, { force: true }); } catch { /* nothing to remove */ }
          saveError = `the downloaded catalogue is in use but could not be saved: ${(err && err.message) || err}`;
        }
      }
      data = r.catalogue;
      lastError = saveError;
      lastRefused = false;
      if (changed) require('./roles').remerge();
    } catch (err) {
      lastError = (err && err.message) || String(err);
      lastRefused = Boolean(err && err.refused);
    } finally {
      inflight = null;
    }
    return status();
  })();
  return inflight;
}

/** What the board holds, for the routes that serve the picker and the Team screen. */
function status() {
  const c = load();
  // `refused`: the last download arrived and was not used, so trying again helps only after a new publish.
  return { loaded: !!c, serial: c ? c.serial : null, roles: c ? c.roles.length : 0, teams: c ? c.teams.length : 0, error: lastError, refused: lastRefused };
}

/** The menu order of role groups, first to last. */
function groupOrder() { return readRoles().groups.slice(); }

/**
 * The catalogue roles in the same shape as a roles.js entry, `instructions` as
 * one string. A fresh copy each call: roles.js appends its rhythm to what it gets.
 */
function rawRoles() {
  // The fields a catalogue role may set, and no others: nothing it carries can mark itself hidden or
  // stand in for another of roles.js's own fields.
  return readRoles().roles.map((r) => ({
    key: r.key, group: r.group, label: r.label, blurb: r.blurb, firstAction: r.firstAction,
    ...(typeof r.caution === 'string' && r.caution ? { caution: r.caution } : {}),
    instructions: r.instructions.join('\n'),
  }));
}

/** Every prebuilt team, ordered business first, then personal, each by rank. Copies, like
 *  rawRoles(): a caller editing one (a form, say) must not change the catalogue for the process. */
function teams() {
  const kinds = ['business', 'personal'];
  return structuredClone(readTeams().teams)
    .sort((a, b) => (kinds.indexOf(a.kind) - kinds.indexOf(b.kind)) || (a.rank - b.rank));
}

function team(key) {
  const t = readTeams().teams.find((x) => x.key === String(key || ''));
  return t ? structuredClone(t) : null;
}

/** Where a downloaded portrait is kept: under its own sha256, so a stored file can only ever be
 *  the image that hash names, and a portrait that changes never reads as the old one. */
function portraitFile(sha) { return path.join(path.dirname(cacheFile()), 'portraits', `${sha}.webp`); }

/** The same test the catalogue's builder applies before it publishes one: a RIFF container whose
 *  form is WEBP, whose size field accounts for the whole file, and whose first chunk is an image.
 *  The 20 bytes are the builder's floor: a 16-byte file can carry all three marks and no image. */
function isWebp(bytes) {
  return bytes.length >= 20 && bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP'
    && bytes.readUInt32LE(4) + 8 === bytes.length && ['VP8 ', 'VP8L', 'VP8X'].includes(bytes.subarray(12, 16).toString('latin1'));
}

/** Whether bytes are the portrait the catalogue names: its hash, and an image of the one kind published. */
function isPortrait(bytes, sha) {
  return crypto.createHash('sha256').update(bytes).digest('hex') === sha && isWebp(bytes);
}

/** Remove stored portraits the held catalogue no longer names (a portrait replaced, a team removed). */
function prunePortraits(keep) {
  const named = new Set([keep]);
  for (const t of readTeams().teams) for (const m of t.members) if (m.avatar && typeof m.avatar.imageSha256 === 'string') named.add(m.avatar.imageSha256);
  for (const sha of portraitUnsaved.keys()) if (!named.has(sha)) portraitUnsaved.delete(sha);
  const dir = path.dirname(portraitFile(keep));
  let files = [];
  try { files = fs.readdirSync(dir); } catch { return; }
  for (const f of files) {
    // Only a finished portrait is a candidate: a download being written beside it is left alone.
    if (!/^[0-9a-f]{64}\.webp$/.test(f) || named.has(f.slice(0, 64))) continue;
    try { fs.rmSync(path.join(dir, f), { force: true }); } catch { /* it is only a stale copy */ }
  }
}

/**
 * #4720: the portrait of one member of one prebuilt team, from the catalogue the board holds. It
 * is downloaded from beside the catalogue the first time it is asked for, used only when it is
 * exactly the image the signed catalogue names (its sha256) and is a WebP image, and kept in the
 * data folder so a second team made from the same seed does not download it again. It does not
 * download the catalogue: a team is only ever made from one the board already holds.
 *
 * Never throws. A portrait is decoration: every failure is an answer the caller can show, and
 * none of them stops the agent being made.
 * @param {string} teamKey
 * @param {string} slot
 * @param {{fetcher?: Function, force?: boolean}} [opts]
 * @returns {Promise<{ok: true, bytes: Buffer, type: string} | {ok: false, because: string}>}
 */
async function portrait(teamKey, slot, opts = {}) {
  const no = (because) => ({ ok: false, because });
  const t = readTeams().teams.find((x) => x.key === String(teamKey || ''));
  if (!t) return no(`there is no prebuilt team called ${JSON.stringify(String(teamKey))}`);
  const m = t.members.find((x) => x.slot === slot);
  if (!m) return no(`the ${t.label} has no member ${JSON.stringify(String(slot))}`);
  const a = m.avatar;
  if (!a || a.image === null || a.image === undefined) return no(`the ${m.title} of the ${t.label} has no portrait yet`);
  const sha = a.imageSha256;
  if (typeof a.image !== 'string' || !PORTRAIT_RE.test(a.image) || typeof sha !== 'string' || !/^[0-9a-f]{64}$/.test(sha)) {
    return no(`the catalogue names a portrait for the ${m.title} of the ${t.label} that this version cannot use`);
  }
  const yes = (bytes) => ({ ok: true, bytes, type: 'image/webp' });
  const file = portraitFile(sha);
  try {
    const kept = fs.readFileSync(file);
    if (isPortrait(kept, sha)) return yes(kept);
    // Damaged on disk: it is downloaded again, and the good copy replaces it.
  } catch { /* not kept yet */ }
  if (portraitUnsaved.has(sha)) return yes(portraitUnsaved.get(sha));
  // As for refresh(): no test run downloads from installkosmos.com unless it names the address or
  // hands in its own fetcher (#4253).
  if (process.env.NODE_TEST_CONTEXT && !opts.fetcher && !process.env.KOSMOS_CATALOGUE_BASE) return no('a test run does not download portraits');
  const id = `${sha} ${a.image}`;
  const failed = portraitFailed.get(id);
  if (failed && !opts.force && Date.now() - failed.at < PORTRAIT_GAP_MS) return no(failed.because);
  if (portraitInflight.has(id)) return portraitInflight.get(id);
  const run = (async () => {
    try {
      const doFetch = opts.fetcher || fetch;
      let bytes = await fetchBytes(doFetch, base() + a.image, undefined, PORTRAIT_MAX_BYTES);
      /* Just after a publish a cache on the way can still hold the image the last catalogue named
         under this same file name. Ask once more past the caches before refusing, as refresh() does. */
      if (!isPortrait(bytes, sha)) bytes = await fetchBytes(doFetch, `${base()}${a.image}?fresh=${Date.now()}`, undefined, PORTRAIT_MAX_BYTES);
      if (!isPortrait(bytes, sha)) throw new Error(`the downloaded portrait ${a.image} was refused: it is not the image the catalogue names`);
      // A portrait that verified is used even when saving it fails: it is held in memory instead,
      // so this process does not download it again.
      const tmp = `${file}.${process.pid}.tmp`;
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(tmp, bytes);
        fs.renameSync(tmp, file);
      } catch {
        try { fs.rmSync(tmp, { force: true }); } catch { /* nothing to remove */ }
        portraitUnsaved.set(sha, bytes);
      }
      prunePortraits(sha);
      portraitFailed.delete(id);
      return yes(bytes);
    } catch (err) {
      const because = (err && err.message) || String(err);
      portraitFailed.set(id, { at: Date.now(), because });
      return no(because);
    } finally {
      portraitInflight.delete(id);
    }
  })();
  portraitInflight.set(id, run);
  return run;
}

/** The one member whose reportsTo is null. */
function leadOf(t) { return t.members.find((m) => m.reportsTo === null) || null; }

function wrapLines(text, first, rest) {
  const out = [];
  let line = first;
  let empty = true;
  // A `code span` is one token, together with anything touching it on either side (the "(" and
  // ")," around a command), so a command is never broken across two lines.
  for (const word of String(text).match(/\S*`[^`]*`\S*|\S+/g) || []) {
    const next = empty ? line + word : line + ' ' + word;
    if (!empty && next.length > 76) { out.push(line); line = rest + word; } else line = next;
    empty = false;
  }
  out.push(line);
  return out;
}

/** The name the person chose for a member's seat, or the seed's name when they chose none. */
function chosenName(x, names) {
  return (names && typeof names[x.slot] === 'string') ? names[x.slot].trim() : x.name;
}

/**
 * Why memberInstructions would return null for these arguments, in a sentence a person can
 * read, or null when it would not. It knows only the catalogue and create's name rules, not the
 * board: a name an existing agent already holds is the caller's to check.
 */
function memberProblem(teamKey, slot, names) {
  const t = team(teamKey);
  if (!t) return `there is no prebuilt team called ${JSON.stringify(String(teamKey))}`;
  const m = t.members.find((x) => x.slot === slot);
  if (!m) return `the ${t.label} has no member ${JSON.stringify(String(slot))}`;
  // Lazy, like roles: create requires roles, which requires this module.
  const create = require('./create');
  for (const k of Object.keys(names || {})) {
    if (!t.members.some((x) => x.slot === k)) return `the ${t.label} has no seat ${JSON.stringify(k)} to name`;
  }
  const bySlug = new Map();
  for (const x of t.members) {
    // A name that is present but is not text (a number, null from a JSON body) is refused, like a
    // blank one, rather than quietly replaced by the seed's name.
    if (names && Object.prototype.hasOwnProperty.call(names, x.slot) && typeof names[x.slot] !== 'string') {
      return `the name for the ${x.title} must be text`;
    }
    const problem = create.nameProblem(chosenName(x, names));
    if (problem !== null) return `the name for the ${x.title} cannot be used: ${problem}`;
    // Two seats create would call the same agent: create would refuse the second one.
    const slug = create.slugFor(chosenName(x, names));
    if (bySlug.has(slug)) return `the ${bySlug.get(slug).title} and the ${x.title} have the same name; give each a different one`;
    bySlug.set(slug, x);
  }
  if (!require('./roles').byKey(m.role)) return `the ${m.title} needs the role ${JSON.stringify(m.role)}, which this version does not have`;
  return null;
}

/**
 * #4557: only the member's `## On this team` section (no role text, no messaging block), for a
 * create that layers it INTO the role's own instructions (create's `teamInstructions`), where the
 * role text and the live messaging block come from create itself. null exactly when memberProblem
 * returns a reason. memberInstructions is this section on its role text, plus the messaging block.
 */
function memberTeamSection(teamKey, slot, names) {
  if (memberProblem(teamKey, slot, names) !== null) return null;
  const t = team(teamKey);
  const m = t.members.find((x) => x.slot === slot);
  const nameOf = (x) => chosenName(x, names);
  const create = require('./create');
  // What a `kosmos msg` command must carry: the machine name (lowercase, spaces folded), so a
  // two-word name cannot split into a recipient and the start of the message.
  const handleOf = (x) => create.slugFor(nameOf(x));
  // No command path here: a path written into this section would go stale when the install layout
  // changes. It names each teammate's machine name only.
  const lead = leadOf(t);
  const lines = ['', '## On this team', ''];
  if (m.reportsTo === null) {
    lines.push(...wrapLines(`You lead the ${t.label} for the person you work for.`, '', ''));
    lines.push('', 'Your team, and what each of them is here for:', '');
    for (const x of t.members.filter((y) => y !== m)) {
      lines.push(...wrapLines(`**${nameOf(x)}** (message them as \`${handleOf(x)}\`), ${x.title}: ${x.focus.join(' ')}`, '- ', '  '));
    }
    lines.push('');
    lines.push(...wrapLines(`Brief each of them with the msg command from the section on talking to your colleagues, using the name beside theirs; check what comes back before it reaches the person you work for, and keep the team working toward this goal: ${t.project.goal}`, '', ''));
  } else {
    lines.push(...wrapLines(`You are the ${m.title} on the ${t.label}. You report to **${nameOf(lead)}**, the ${lead.title}: take your work from ${nameOf(lead)}, and send finished work and questions back with the msg command from the section on talking to your colleagues, addressed to \`${handleOf(lead)}\`.`, '', ''));
    const peers = t.members.filter((y) => y !== m && y !== lead).map((y) => `${nameOf(y)} (${y.title})`);
    if (peers.length) lines.push('', ...wrapLines(`Your teammates: ${peers.join(', ')}.`, '', ''));
    lines.push('', ...wrapLines(`The team's goal: ${t.project.goal}`, '', ''));
  }
  if (m.focus.length) {
    lines.push('', 'Your focus here:', '');
    for (const f of m.focus) lines.push(...wrapLines(f, '- ', '  '));
  }
  return lines.join('\n').replace(/^\n/, '') + '\n';
}

/**
 * The full instruction file for one member of one team, ready to write: the
 * member's role text (with {{NAME}} filled in, because create writes explicit
 * instructions verbatim, create.js) plus an `## On this team` section naming the
 * lead and the teammates by the names the person actually chose.
 *
 * @param {string} teamKey
 * @param {string} slot                         the member's slot, e.g. 'lead'
 * @param {Object<string,string>} [names]       slot -> the agent name chosen; a
 *                                              slot left out keeps the seed's name
 * The caller writes the name it passes here, trimmed, as the agent's name, so the file and the
 * agent agree (chosenName trims).
 *
 * The text is EXPLICIT instructions for a built-in role key, which team.vetAgentMember (#4474) refuses
 * when an agent or the setup guide makes the request; a seeded team is made through the operator path.
 *
 * @returns {string|null} null exactly when memberProblem() returns a reason: an unknown
 *   team, slot or role, a name create refuses, or two seats with the same name.
 */
function memberInstructions(teamKey, slot, names) {
  const section = memberTeamSection(teamKey, slot, names);
  if (section === null) return null;
  const t = team(teamKey);
  const m = t.members.find((x) => x.slot === slot);
  const base = require('./roles').instructionsFor(m.role, chosenName(m, names));
  const text = base.replace(/\n+$/, '\n') + '\n' + section;
  /* create adds the messaging block (how to answer the person, kosmos reply / post / msg) only to
     role templates, never to explicit instructions like these, so it is spliced in here with the
     same markers: projects.healColleagues keeps it current afterwards, as for any agent. Without it
     a team member would not know that a reply in its own window reaches nobody. */
  const messages = require('./messages');
  return require('./projects').spliceBlock(text, messages.blockBody(), messages.START, messages.END);
}

module.exports = { PUBLIC_KEY, FORMAT, MIN_SERIAL, PORTRAIT_MAX_BYTES, cacheFile, portraitFile, check, refresh, status, useKeyForTest, groupOrder, rawRoles, teams, team, leadOf, memberInstructions, memberTeamSection, memberProblem, portrait };
