'use strict';
/* #2619: the persisted setting for the Assigner automation (Settings >
 * Automation). When on, an idle agent is given the next unassigned task in one of
 * its projects, or asked to draft tasks toward a project's BRIEF.md goal when the
 * project has none (#3595 phases 2 and 3).
 *
 * SCOPE (this module is the SETTING, not the behaviour): it persists on/off the
 * same way engine/heartbeat-setting.js does (atomic tmp + rename, safe defaults,
 * a write failure returns a reason and never throws). The behaviour that reads it
 * is engine/assigner.js.
 *
 * ON BY DEFAULT since #3595 phase 2 wired the idle-assign behaviour (engine/assigner.js):
 * the flip landed WITH the behaviour, as recorded on the card. Its limits are structural (it only
 * gives an existing unassigned task to an existing member), so it follows heartbeat-setting's
 * shape: missing reads on, corrupt or unreadable reads off.
 */
const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');

// #1856: the one data-root derivation, not the raw AGENT_WORKFORCE_DATA switch.
const BASE = store.ROOT;
const FILE = path.join(BASE, 'assigner.json');

/**
 * The setting as stored, with defaults filled in. `ok` reports whether the file
 * read cleanly (a parse failure still yields a safe default, ok:false).
 * #5382: `failover` (off by default, and off on any file that does not say true) lets the Assigner give
 * a rate-limited agent's open parts to an idle agent on another provider (engine/assigner.js).
 * @returns {{on:boolean,failover:boolean,ok:boolean}}
 */
function read() {
  let raw;
  try {
    raw = fs.readFileSync(FILE, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return { on: true, failover: false, ok: true };  // never configured -> on (#3595)
    return { on: false, failover: false, ok: false };
  }
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return { on: false, failover: false, ok: false }; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { on: false, failover: false, ok: false };
  }
  // ON by default (#3595, as heartbeat-setting): a stored file missing the flag reads on, exactly as
  // an absent one does; only an explicit false is off. A corrupt or unreadable file reads off.
  return { on: typeof parsed.on === 'boolean' ? parsed.on : true, failover: parsed.failover === true, ok: true };
}

function write(patch) {
  const cur = read();
  const next = { on: typeof patch.on === 'boolean' ? patch.on : cur.on,
    failover: typeof patch.failover === 'boolean' ? patch.failover : cur.failover === true };
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ on: next.on, failover: next.failover }) + '\n');
    fs.renameSync(tmp, FILE);
    return { ok: true };
  } catch {
    return { ok: false, because: 'we could not save that setting' };
  }
}

function setOn(on) {
  if (typeof on !== 'boolean') return { ok: false, because: 'that has to be on or off' };
  return write({ on });
}

/* #5382: on or off for moving a rate-limited agent's work to an agent on another provider. */
function setFailover(on) {
  if (typeof on !== 'boolean') return { ok: false, because: 'that has to be on or off' };
  return write({ failover: on });
}

module.exports = { read, write, setOn, setFailover, FILE };
