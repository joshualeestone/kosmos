'use strict';
/* kosmos#8841: an operator's switch that outlives a restart.
 *
 * Two things this board does only when its operator switched them on in the board's environment: reading each
 * account's usage (AGENT_WORKFORCE_USAGE_POLL=1, engine/usagepoll.js) and moving agents off an account that is
 * running out (AGENT_WORKFORCE_AUTOMOVE=1, engine/automove.js). The environment of a board that launchd starts is
 * not the operator's to keep: on 2026-11-11 a board that had run with both on for five days came back with neither,
 * said so only in its log, and left agents on a full account nine days later.
 *
 * So a start that sees a switch on writes that down, and a later start that sees the variable UNSET reads it back.
 * The default does not change: a board nobody switched on has no record and stays off.
 *
 *   NAME=1      on, and recorded
 *   NAME=0      off, and the record of it is removed (the way to switch it off for good)
 *   NAME unset  as recorded: on if a start recorded it, off otherwise
 *   NAME_OFF=1  the brake, as before: off while it is set, whatever is recorded; the record is left alone
 *
 * Never under a test or a dry run (`live` false): nothing is read, written or changed.
 */
const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');

const FILE = path.join(store.ROOT, 'kept-switches.json');
/* key in the record -> the variable, and how the start line names it. */
const SWITCHES = [
  { key: 'usagePoll', name: 'AGENT_WORKFORCE_USAGE_POLL', said: 'the usage poll' },
  { key: 'automove', name: 'AGENT_WORKFORCE_AUTOMOVE', said: 'the mover' },
];

/** @returns {{ok:boolean, on:Object<string,{at:number}>}} missing file: ok, nothing kept; unreadable or corrupt: not ok, nothing kept. */
function read(file = FILE) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); }
  catch (err) { return { ok: !!(err && err.code === 'ENOENT'), on: {} }; }
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return { ok: false, on: {} }; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, on: {} };
  const on = {};
  for (const s of SWITCHES) {
    const v = parsed[s.key];
    if (v && typeof v === 'object' && v.on === true) on[s.key] = { at: Number.isFinite(v.at) ? v.at : 0 };
  }
  return { ok: true, on };
}

/**
 * Called once as the board starts, before anything reads the two variables. Sets `env[NAME] = '1'` for each switch a
 * start recorded and this start left unset, and brings the record up to date with what this start was told.
 * @returns {{kept:string[], recorded:string[], cleared:string[], readOk:boolean, wrote:boolean|null, lines:string[]}}
 *   kept: switches turned on from the record; recorded / cleared: changes to the record; wrote: null when the record
 *   needed no change; lines: what to print in the board log (none when there is nothing to say).
 */
function applyAtStart(env, { live, file = FILE, nowMs = Date.now() } = {}) {
  const out = { kept: [], recorded: [], cleared: [], readOk: true, wrote: null, lines: [] };
  if (live !== true || !env) return out;
  const rec = read(file);
  out.readOk = rec.ok;
  const next = { ...rec.on };
  for (const s of SWITCHES) {
    const v = env[s.name];
    if (v === '1') { if (!next[s.key]) { next[s.key] = { at: nowMs }; out.recorded.push(s.key); } }
    else if (v === '0') { if (next[s.key]) { delete next[s.key]; out.cleared.push(s.key); } }
    else if ((v === undefined || v === '') && next[s.key]) { env[s.name] = '1'; out.kept.push(s.key); }
  }
  /* A record that could not be read is rewritten only when this start has something to record: otherwise a file
     that is unreadable for a moment would be replaced by an empty one, and the choice lost for good. */
  if (out.recorded.length || (out.cleared.length && rec.ok)) {
    const body = {};
    for (const s of SWITCHES) if (next[s.key]) body[s.key] = { on: true, at: next[s.key].at };
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      store.saveFlushed(file, JSON.stringify(body) + '\n');
      out.wrote = true;
    } catch { out.wrote = false; }
  }
  const said = (keys) => SWITCHES.filter((s) => keys.includes(s.key)).map((s) => s.said).join(' and ');
  const names = (keys) => SWITCHES.filter((s) => keys.includes(s.key)).map((s) => s.name + '=0').join(' and ');
  if (out.kept.length) {
    const since = Math.min(...out.kept.map((k) => next[k].at));
    out.lines.push(`kept-switches: ${said(out.kept)} ${out.kept.length > 1 ? 'are' : 'is'} on, kept from the start of ${since > 0 ? new Date(since).toISOString() : 'an earlier day'}; start once with ${names(out.kept)} to switch ${out.kept.length > 1 ? 'them' : 'it'} off`);
  }
  if (out.recorded.length) out.lines.push(`kept-switches: ${said(out.recorded)} ${out.recorded.length > 1 ? 'are' : 'is'} on at this start${out.wrote ? ', and will stay on at later starts' : ', but that could not be written down, so a later start must say it again'}`);
  if (out.cleared.length) out.lines.push(`kept-switches: ${said(out.cleared)} ${out.cleared.length > 1 ? 'are' : 'is'} switched off${out.wrote ? ', and will stay off at later starts' : ', but that could not be written down, so a later start may switch it on again'}`);
  if (!rec.ok) out.lines.push('kept-switches: the record of what was switched on could not be read, so nothing was kept from an earlier start');
  return out;
}

module.exports = { FILE, SWITCHES, read, applyAtStart };
