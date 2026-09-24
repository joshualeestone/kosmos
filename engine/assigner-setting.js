'use strict';
/* #2619: the persisted setting for the Assigner automation (Settings >
 * Automation). When on, the Assigner turns the person's goals into assigned work
 * - mapping top goals to prioritized tasks, and giving agents with no work some.
 *
 * SCOPE (this module is the SETTING, not the behaviour): it persists on/off the
 * same way engine/heartbeat-setting.js does (atomic tmp + rename, safe defaults,
 * a write failure returns a reason and never throws). The actual goal-to-task
 * mapping + idle-agent assignment is a separate, larger build (agent
 * orchestration, coupled to the v2 flywheel) that will READ this setting.
 *
 * OFF BY DEFAULT, deliberately (like recommender-setting.js, unlike heartbeat/
 * auto-save): an automation whose behaviour is not yet wired must not read as ON,
 * or a person enabling it would expect work to be assigned and see nothing. Off
 * means "not enabled", which is honest until the behaviour lands. (Recorded on
 * the card: flip the default to on WITH the behaviour, not before.)
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
 * @returns {{on:boolean,ok:boolean}}
 */
function read() {
  let raw;
  try {
    raw = fs.readFileSync(FILE, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return { on: false, ok: true };  // never configured -> off
    return { on: false, ok: false };
  }
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return { on: false, ok: false }; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { on: false, ok: false };
  }
  // OFF by default: only an explicit true enables it.
  return { on: parsed.on === true, ok: true };
}

function write(patch) {
  const cur = read();
  const next = { on: typeof patch.on === 'boolean' ? patch.on : cur.on };
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ on: next.on }) + '\n');
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

module.exports = { read, write, setOn, FILE };
