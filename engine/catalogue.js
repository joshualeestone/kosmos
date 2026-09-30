'use strict';
/**
 * #4555 (#4554 parts 1-2): the catalogue of ready-made ROLES beyond the original set in
 * engine/roles.js, and of prebuilt TEAMS (a lead plus 4 or 5 reports) a person can create in one
 * go (#4557).
 *
 * #4632: the catalogue no longer ships inside Kosmos. It is built and signed by the public repo
 * joshualeestone/kosmos-catalogue and published at installkosmos.com/catalogue/. Kosmos downloads
 * it only when it is asked for: the role picker (/api/roles?catalogue=1), `kosmos agent roles`, a
 * create for a role the board does not hold, and, once #4557 lands, the Team screen. It keeps it
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
const MIN_SERIAL = 1790732878;   // the first catalogue published (kosmos-catalogue b2b4b36, 2026-09-30)
const MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 8000;
// A picker opened twice in a minute downloads once. A failed try waits as long as a good one.
const MIN_GAP_MS = 10 * 60 * 1000;

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
let inflight = null;

/** Tests sign with their own key pair. In-process only: nothing outside this process can reach it. */
function useKeyForTest(pem) { key = pem || PUBLIC_KEY; data = undefined; lastTry = 0; lastError = null; }

const KEY_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const isText = (v) => typeof v === 'string' && v.length > 0;

/** Why a parsed catalogue is not one this version can use, or null. Signed data is trusted for
 *  its origin, not for being the shape this version reads (a newer format, a builder bug). */
function shapeProblem(c) {
  if (!c || typeof c !== 'object') return 'it is not an object';
  if (c.version !== FORMAT) return `format version ${JSON.stringify(c.version)} is not one this version reads`;
  if (!Number.isInteger(c.serial) || c.serial < MIN_SERIAL) return `its serial ${JSON.stringify(c.serial)} is older than this version of Kosmos (${MIN_SERIAL})`;
  if (!Array.isArray(c.groups) || !c.groups.every(isText)) return 'groups is not a list of names';
  if (!Array.isArray(c.roles) || !Array.isArray(c.teams)) return 'roles or teams is not a list';
  for (const r of c.roles) {
    if (!r || !KEY_RE.test(String(r.key)) || !isText(r.label) || !isText(r.blurb) || !isText(r.firstAction) || !isText(r.group)
      || !Array.isArray(r.instructions) || !r.instructions.every((l) => typeof l === 'string')) {
      return `role ${JSON.stringify(r && r.key)} is incomplete`;
    }
  }
  const roleKeys = c.roles.map((r) => r.key);
  if (new Set(roleKeys).size !== roleKeys.length) return 'two roles share a key';
  const teamKeys = c.teams.map((t) => t && t.key);
  if (new Set(teamKeys).size !== teamKeys.length) return 'two teams share a key';
  for (const t of c.teams) {
    if (!t || !KEY_RE.test(String(t.key)) || !isText(t.label) || !t.project || !isText(t.project.goal) || !Array.isArray(t.members)
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
    if (leads !== 1 || t.members.length - leads < 4 || t.members.length - leads > 5) return `team ${t.key} is not a lead and 4 or 5 reports`;
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

/** The body of url, refused as soon as it is known to exceed MAX_BYTES: by its Content-Length
 *  before reading, and by a running count while reading, so an oversized answer is never held. */
async function fetchBytes(doFetch, url, stop) {
  const signal = stop ? AbortSignal.any([AbortSignal.timeout(TIMEOUT_MS), stop]) : AbortSignal.timeout(TIMEOUT_MS);
  const res = await doFetch(url, { signal, cache: 'no-store' });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  const tooBig = () => new Error(`${url} is larger than ${MAX_BYTES} bytes`);
  if (Number(res.headers.get('content-length')) > MAX_BYTES) throw tooBig();
  if (!res.body) return Buffer.alloc(0);
  const chunks = [];
  let total = 0;
  for await (const chunk of res.body) {
    total += chunk.length;
    if (total > MAX_BYTES) {
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
      if (!r.ok) throw new Error(`the downloaded catalogue was refused: ${r.because}`);
      // It is stored as text, so it must survive the round trip to text byte for byte (a BOM or
      // invalid UTF-8 would not): refused now, rather than lost at the next restart.
      const text = bytes.toString('utf8');
      if (!Buffer.from(text, 'utf8').equals(bytes)) throw new Error('the downloaded catalogue was refused: it is not plain UTF-8 text');
      const held = load();
      if (held && r.catalogue.serial < held.serial) {
        throw new Error(`the downloaded catalogue is older than the one held (${r.catalogue.serial} < ${held.serial})`);
      }
      // A different file under the serial already held is a publisher error, but it is still what was
      // signed: take it whole (memory, ROLES and the stored copy) rather than half.
      const changed = !held || held.serial !== r.catalogue.serial || JSON.stringify(held) !== JSON.stringify(r.catalogue);
      // The same serial is written again only when the stored copy is gone or no longer verifies
      // (a disk cleanup, say), so what is held in memory survives a restart.
      if (changed || storedSerial() !== r.catalogue.serial) {
        const file = cacheFile();
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const tmp = `${file}.${process.pid}.tmp`;
        try {
          fs.writeFileSync(tmp, JSON.stringify({ sig: sig.toString('utf8').trim(), text }));
          fs.renameSync(tmp, file);
        } catch (err) {
          try { fs.rmSync(tmp, { force: true }); } catch { /* nothing to remove */ }
          throw err;
        }
      }
      data = r.catalogue;
      lastError = null;
      if (changed) require('./roles').remerge();
    } catch (err) {
      lastError = (err && err.message) || String(err);
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
  return { loaded: !!c, serial: c ? c.serial : null, roles: c ? c.roles.length : 0, teams: c ? c.teams.length : 0, error: lastError };
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
  if (memberProblem(teamKey, slot, names) !== null) return null;
  const t = team(teamKey);
  const m = t.members.find((x) => x.slot === slot);
  const nameOf = (x) => chosenName(x, names);
  const create = require('./create');
  // What a `kosmos msg` command must carry: the machine name (lowercase, spaces folded), so a
  // two-word name cannot split into a recipient and the start of the message.
  const handleOf = (x) => create.slugFor(nameOf(x));
  // No command path here: this section sits outside any managed block, so a path written into it
  // would go stale when the install layout changes. It names each teammate's machine name; the
  // messaging block below (kept current by projects.healColleagues) teaches the command itself.
  const roles = require('./roles');
  const base = roles.instructionsFor(m.role, nameOf(m));
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
  const text = base.replace(/\n+$/, '\n') + lines.join('\n') + '\n';
  /* create adds the messaging block (how to answer the person, kosmos reply / post / msg) only to
     role templates, never to explicit instructions like these, so it is spliced in here with the
     same markers: projects.healColleagues keeps it current afterwards, as for any agent. Without it
     a team member would not know that a reply in its own window reaches nobody. */
  const messages = require('./messages');
  return require('./projects').spliceBlock(text, messages.blockBody(), messages.START, messages.END);
}

module.exports = { PUBLIC_KEY, FORMAT, MIN_SERIAL, cacheFile, check, refresh, status, useKeyForTest, groupOrder, rawRoles, teams, team, leadOf, memberInstructions, memberProblem };
