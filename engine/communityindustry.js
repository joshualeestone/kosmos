'use strict';

/**
 * The owner's industry, shared on their agents' public Community profiles (#4375, Community
 * slice 2): "Works for an accounting practice". Optional, and only ever a key from a FIXED list,
 * never free text: a typed business name is exactly what the name scrub cannot catch (#4336).
 *
 * Its own file, not a field in community.json: communityswitch.write() rebuilds that object from
 * the fields it knows, so an extra field there would be dropped by the next switch click, and one
 * file's corruption must not flip the other's consent.
 *
 * The send layer (engine/communitysend.js) PATCHes each registered agent's profile when what it
 * last sent differs from this. An unreadable file is UNKNOWN (`ok:false`), and nothing is sent on
 * an unknown: never a null that would wipe what the profile says.
 */

const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');

const FILE = path.join(store.ROOT, 'community-industry.json');

/* The service's list, key for key and word for word (kosmos-community app/taxonomy.py INDUSTRIES,
   #4370). Each label completes "Works for ..." on a profile. The service refuses a key it does not
   know with 400 "unknown industry", which the send layer records rather than retries. The contract
   test engine/communityindustry.contract.test.js compares this copy with a real service's public
   GET /industries, but ONLY when KOSMOS_COMMUNITY_CONTRACT_URL is set (it is skipped by default, like
   communitysend.contract.test.js), so a rename on the service is caught when someone runs it, not by
   the suite. Read-only: it registers nothing. */
const INDUSTRIES = Object.freeze([
  ['accounting', 'an accounting practice'],
  ['legal', 'a law firm'],
  ['consulting', 'a consultancy'],
  ['marketing-agency', 'a marketing agency'],
  ['software', 'a software company'],
  ['ecommerce-retail', 'an online or retail shop'],
  ['real-estate', 'a real estate business'],
  ['healthcare', 'a healthcare practice'],
  ['education', 'an education business'],
  ['construction-trades', 'a construction or trades business'],
  ['manufacturing', 'a manufacturer'],
  ['hospitality-food', 'a hospitality or food business'],
  ['logistics', 'a logistics business'],
  ['media-creative', 'a media or creative studio'],
  ['nonprofit', 'a nonprofit'],
  ['other', 'a business'],
].map(([key, label]) => Object.freeze({ key, label })));
const KEYS = new Set(INDUSTRIES.map((i) => i.key));

/**
 * { industry: <key>|null, ok: true } when the file is missing (never set) or readable;
 * { industry: null, ok: false } when it is present and cannot be read, or names a key that is
 * not on the list (a hand-edit, or a list that moved): unknown, so nothing is sent.
 */
function read() {
  let raw;
  try { raw = fs.readFileSync(FILE, 'utf8'); }
  catch (err) {
    if (err && err.code === 'ENOENT') return { industry: null, ok: true };
    return { industry: null, ok: false };
  }
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return { industry: null, ok: false }; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { industry: null, ok: false };
  const v = parsed.industry;
  if (v === null || v === undefined) return { industry: null, ok: true };
  if (typeof v === 'string' && KEYS.has(v)) return { industry: v, ok: true };
  return { industry: null, ok: false };
}

/** Set the industry to a key from the list, or null to clear it. Anything else is refused. */
function set(industry) {
  if (industry !== null && !(typeof industry === 'string' && KEYS.has(industry))) {
    return { ok: false, because: 'that is not one of the listed industries' };
  }
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ industry }) + '\n');
    fs.renameSync(tmp, FILE);
    return { ok: true };
  } catch {
    return { ok: false, store: true, because: 'we could not save that setting' };
  }
}

function labelFor(key) {
  const hit = INDUSTRIES.find((i) => i.key === key);
  return hit ? hit.label : null;
}

module.exports = { read, set, labelFor, INDUSTRIES, FILE };
