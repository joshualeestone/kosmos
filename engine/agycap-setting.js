'use strict';
/* #4588 ask 3: how many of this computer's Antigravity (Gemini) agents may be working at once before the automatic
 * senders wait (Settings > Automation). Agy agents signed in to one Google account share one quota; a user's team ran
 * six of them and kept locking each other out, and capped them by hand. engine/agyquota.js heldForCap reads this; the
 * HTTP routes read and write it.
 *
 * OFF BY DEFAULT (no limit): a cap slows a team down, and the quota pause and hold (#4588 PR A and B) already stop
 * the pile-up after a lockout. It is for a person who would rather go slower than be locked out. This is the stated
 * reason Josh's "on is the product default" rule (2026-09-03) asks for.
 *
 * The choices are a CLOSED set, so the selector and the stored value cannot disagree about what is valid. 0 is "no
 * limit". An absent store reads no limit; an unreadable or corrupt one also reads no limit, because a bad file must
 * not hold every automatic message to the person's agents (the safe side here is the product's normal behaviour).
 * Persisted like heartbeat-setting.js: atomic tmp + rename, a write failure returns a reason and never throws.
 */
const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');

const FILE = path.join(store.ROOT, 'agycap.json');

const CHOICES = Object.freeze([0, 1, 2, 3, 4]);
const DEFAULT_MAX = 0;

function isValidMax(n) {
  return typeof n === 'number' && CHOICES.includes(n);
}

/**
 * @returns {{maxWorking:number, ok:boolean}} maxWorking 0 means no limit.
 */
function read() {
  let raw;
  try {
    raw = fs.readFileSync(FILE, 'utf8');
  } catch (err) {
    return { maxWorking: DEFAULT_MAX, ok: Boolean(err && err.code === 'ENOENT') };
  }
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return { maxWorking: DEFAULT_MAX, ok: false }; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { maxWorking: DEFAULT_MAX, ok: false };
  if (!isValidMax(parsed.maxWorking)) return { maxWorking: DEFAULT_MAX, ok: false };
  return { maxWorking: parsed.maxWorking, ok: true };
}

function set(patch) {
  const p = patch || {};
  if (!Object.prototype.hasOwnProperty.call(p, 'maxWorking') || !isValidMax(p.maxWorking)) {
    return { ok: false, because: 'the limit must be one of ' + CHOICES.join(', ') + ' (0 is no limit)' };
  }
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ maxWorking: p.maxWorking }) + '\n');
    fs.renameSync(tmp, FILE);
    return { ok: true };
  } catch {
    return { ok: false, because: 'we could not save that setting' };
  }
}

module.exports = { FILE, CHOICES, DEFAULT_MAX, isValidMax, read, set };
