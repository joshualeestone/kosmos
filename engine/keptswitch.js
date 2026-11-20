'use strict';
/* kosmos#8841: an operator's switch that outlives a restart.
 *
 * Two things this board does only when its operator switched them on in the board's environment: reading each
 * account's usage (AGENT_WORKFORCE_USAGE_POLL=1, engine/usagepoll.js) and moving agents off an account that is
 * running out (AGENT_WORKFORCE_AUTOMOVE=1, engine/automove.js). The environment of a board that launchd starts is
 * not the operator's to keep: on 2026-11-11 a board that had run with both on for five days came back with neither,
 * said so only in its log, and left agents on a full account nine days later.
 *
 * So a start that sees a switch on writes that down, and a later start that sees the variable unset reads it back.
 * The default does not change: a board nobody switched on has no record and stays off.
 *
 *   NAME=1               on, and recorded
 *   NAME=0               off, and the record of it is removed (the way to switch it off for good)
 *   NAME unset or empty  as recorded: on if a start recorded it, off otherwise
 *   any other value      off at this start; the record is left alone
 *   NAME_OFF=1           the brake, as before: off while it is set, whatever is recorded; the record is left alone
 *
 * The kept choice lives in this module, for the environment the board started with. It is NOT written into that
 * environment, so nothing the board starts (an agent's shell, a test run from it) inherits a switch.
 * Never under a test or a dry run: nothing is read, written or kept.
 */
const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');

const file = () => path.join(store.ROOT, 'kept-switches.json');
/* key in the record -> the variable, and how the start line names it. */
const SWITCHES = [
  { key: 'usagePoll', name: 'AGENT_WORKFORCE_USAGE_POLL', said: 'the usage poll' },
  { key: 'automove', name: 'AGENT_WORKFORCE_AUTOMOVE', said: 'the mover' },
];
const unset = (v) => v === undefined || v === '';

/* What applyAtStart kept, and the environment object it kept it for (the board's own). */
let kept = {};
let keptFor = null;

/** @returns {{ok:boolean, on:Object<string,{at:number}>}} missing file: ok, nothing kept; unreadable or corrupt: not ok, nothing kept. */
function read(from = file()) {
  let raw;
  try { raw = fs.readFileSync(from, 'utf8'); }
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

/** Whether `key`'s switch is on for `env`: its variable is 1, or it is unset and this board kept it at start. */
function on(key, env = process.env) {
  const s = SWITCHES.find((x) => x.key === key);
  if (!s || !env) return false;
  return env[s.name] === '1' || (unset(env[s.name]) && env === keptFor && !!kept[key]);
}

/** The switches this board has on from an earlier start (not from this start's own environment): { key: at }. */
function keptNow() {
  const out = {};
  for (const s of SWITCHES) if (keptFor && unset(keptFor[s.name]) && kept[s.key]) out[s.key] = kept[s.key].at;
  return out;
}

/**
 * Called once as the board starts. Brings the record up to date with what this start was told, and keeps (for `on`)
 * each switch a start recorded and this start left unset. `env` is never changed.
 * @returns {{kept:string[], recorded:string[], cleared:string[], readOk:boolean, wrote:boolean|null, lines:string[]}}
 *   kept: switches on from the record; recorded / cleared: changes to the record; wrote: null when nothing was
 *   written; lines: what to print in the board log (none when there is nothing to say).
 */
function applyAtStart(env, { live, file: to = file(), nowMs = Date.now() } = {}) {
  const out = { kept: [], recorded: [], cleared: [], readOk: true, wrote: null, lines: [] };
  kept = {}; keptFor = null;
  if (live !== true || !env) return out;
  const rec = read(to);
  out.readOk = rec.ok;
  const next = { ...rec.on };
  for (const s of SWITCHES) {
    const v = env[s.name];
    if (v === '1') { if (!next[s.key]) { next[s.key] = { at: nowMs }; out.recorded.push(s.key); } }
    else if (v === '0') { if (next[s.key]) { delete next[s.key]; out.cleared.push(s.key); } }
    else if (unset(v) && next[s.key]) out.kept.push(s.key);
  }
  /* A record that could not be read is never written over: it may hold a choice this start knows nothing about, and
     a file that is unreadable for a moment must not be replaced by a partial one. This start still does what its own
     environment says; only the keeping is lost, and the line below says so. */
  if (rec.ok && (out.recorded.length || out.cleared.length)) {
    const body = {};
    for (const s of SWITCHES) if (next[s.key]) body[s.key] = { on: true, at: next[s.key].at };
    try {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      store.saveFlushed(to, JSON.stringify(body) + '\n');
      out.wrote = true;
    } catch { out.wrote = false; }
  }
  for (const k of out.kept) kept[k] = next[k];
  keptFor = env;

  const of = (keys) => SWITCHES.filter((s) => keys.includes(s.key));
  const said = (keys) => of(keys).map((s) => s.said).join(' and ');
  const be = (keys) => (keys.length > 1 ? 'are' : 'is');
  /* The brake holds a switch off whatever is recorded, so a line never says "on" over it. */
  const braked = (keys) => of(keys).filter((s) => env[s.name + '_OFF'] === '1');
  const brakeSaid = (keys) => { const b = braked(keys); return b.length ? `; held off for now by ${b.map((s) => s.name + '_OFF=1').join(' and ')}` : ''; };
  if (out.kept.length) {
    const since = Math.min(...out.kept.map((k) => next[k].at));
    out.lines.push(`kept-switches: ${said(out.kept)} ${be(out.kept)} switched on, kept from the start of ${since > 0 ? new Date(since).toISOString() : 'an earlier day'}${brakeSaid(out.kept)}; start once with ${of(out.kept).map((s) => s.name + '=0').join(' and ')} to switch ${out.kept.length > 1 ? 'them' : 'it'} off`);
  }
  if (out.recorded.length) {
    out.lines.push(`kept-switches: ${said(out.recorded)} ${be(out.recorded)} switched on at this start${brakeSaid(out.recorded)}, ${out.wrote === true ? 'and will stay switched on at later starts' : 'but that could not be written down, so a later start must say it again'}`);
  }
  if (out.cleared.length) {
    out.lines.push(`kept-switches: ${said(out.cleared)} ${be(out.cleared)} switched off, ${out.wrote === true ? 'and will stay off at later starts' : 'but that could not be written down, so a later start may switch it on again'}`);
  }
  if (!rec.ok) {
    const told = of(SWITCHES.map((s) => s.key)).filter((s) => env[s.name] === '1' || env[s.name] === '0');
    out.lines.push('kept-switches: the record of what was switched on could not be read, so nothing was kept from an earlier start'
      + (told.length ? ` and what this start was told (${told.map((s) => s.name + '=' + env[s.name]).join(', ')}) was not written down` : ''));
  }
  return out;
}

/**
 * The board's one call (server.js): applyAtStart for the board's own environment, live only when the board may act
 * for real and this is neither a test nor a dry run. Not usagePoll.liveAllowed(): that also needs the poll switched
 * on, which is what this decides.
 */
function atBoardStart(env, { liveExecutionAllowed, ...opts } = {}) {
  const live = liveExecutionAllowed === true && !env.NODE_TEST_CONTEXT && env.AGENT_WORKFORCE_DRY_RUN !== '1';
  return applyAtStart(env, { ...opts, live });
}

module.exports = { file, SWITCHES, read, on, keptNow, applyAtStart, atBoardStart };
