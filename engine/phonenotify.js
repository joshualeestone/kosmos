'use strict';
/**
 * Phone notifications (#718). When the person has turned them on, the board
 * tells the Kosmos+ coordinator that an agent needs them or answered them, and
 * the coordinator pushes it to their phones through the Kosmos phone app (Josh,
 * 2026-09-24: apps only). Josh, 2026-09-24: "100% the main reason we want
 * mobile apps is for push notifications."
 *
 * ON BY DEFAULT ONCE THIS COMPUTER IS CONNECTED TO KOSMOS+ (#6488; Josh,
 * 2026-10-18 09:43: "Let's have notifications switched on by default"). A
 * computer whose person never touched the switch is turned on by
 * ensureDefaultOn; one whose person turned it off stays off (masterChoice says
 * how the two are told apart). Nothing is sent while off, and an unreadable
 * setting reads as off. This is not the "something happened" seam deleted in
 * #2623 (#2631): that sent to our own endpoint with the install id. This sends
 * only to the coordinator the Mac is already connected to, which the person
 * chose by connecting it, and with its own random id (`notifyId`), never
 * ping.installId() (kosmos#5995: this file does not send that one; engine/ping.js
 * lists the files that do).
 *
 * What leaves the Mac per event is exactly `payload()` below: the kind, the
 * agent's shown name, its session name, the project name when there is one, an
 * event id, the time, and notifyId. Never a message's words. The coordinator
 * adds the Mac's own address, which is where a tap on the phone opens.
 *
 * The notify-only token is minted at the coordinator's
 * POST /v1/mac/notify-credential, which requires the Mac's request signature;
 * the board makes no signatures ("NO CRYPTO HERE", engine/remote.js), so it asks
 * the tunnel binary to (remote.macRequest, the mac-request verb). A TLS client
 * certificate alone is not that signature (#3626). The token is kept owner-only
 * in the tunnel's state dir and can send events and nothing else.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const https = require('node:https');
const http = require('node:http');
const { URL } = require('node:url');
const remote = require('./remote');

// 🛑 THE SHIP GATE (Liu Kang, 2026-09-24). While this is false the Settings section is hidden, turning on is refused,
// and nothing is sent even if the switch file says on. A constant, not an env var or a setting, so only a release can
// change it. Tests use setAvailableForTests.
// #4194: OPEN. A phone app that receives now exists (the Android test build, vc3 #4165: a real push under the Kosmos
// icon #4172, the tap routes to the agent #4178), so Josh's phone can be tested end to end. The app is not in the
// stores yet, so the Settings section says it is in testing. #6488: on by default once
// connected (ensureDefaultOn), unless the person turned it off; nothing reaches a phone
// until one is registered. The bundle refuses to ship this open with a connector that lacks
// `mac-request` (tools/lib/connector-verbs.sh).
const PHONE_APP_CAN_RECEIVE = true;
let available = PHONE_APP_CAN_RECEIVE;
function setAvailableForTests(on) { available = on === true; }

// What a phone hears about. #6254: `posted` (a room post that names the person,
// or any other room post when the person opts in) and `ready` (work waiting for
// their check, from `kosmos task built`) join the two originals. The coordinator
// accepts all of these; what the board sends is gated per kind below.
const KINDS = new Set(['needs_you', 'replied', 'posted', 'ready']);
// #6254: one switch per kind, under the master `on`. Each reads as ITS OWN
// default when the setting is missing or unreadable, never all-on (and the
// master gates them on top: on by default once connected, #6488). `postedRoom` (any other room post) is
// the only default-off one; a busy room is opt-in and coalesced (below).
const KIND_DEFAULTS = { needsYou: true, replied: true, postedMention: true, ready: true, postedRoom: false };
// The coordinator mints "knt1_" + random ids; anything else is not a token and
// is refused before it is stored or put in a header.
const TOKEN_SHAPE = /^knt1_[A-Za-z0-9_-]{8,200}$/;
const NOTIFY_ROUTE = '/v1/mac/notify';
const CREDENTIAL_ROUTE = '/v1/mac/notify-credential';
// A notification is fire and forget; after 4 s the socket is dropped, the same
// bound as engine/mac-standing.js.
const TIMEOUT_MS = 4000;
// The coordinator's caps in UTF-8 BYTES (coordinator/src/notify.rs `caps`, Rust
// String::len); it refuses anything over, so capping by characters would drop a
// non-ASCII name silently.
const CAPS = { id: 120, agent: 80, session: 80, project: 120 };
// At most one needs_you buzz per agent per this long: permission prompts file a
// needs_you each, and a busy session would otherwise buzz on every one.
const NEEDS_YOU_COOLDOWN_MS = 5 * 60 * 1000;
// #6254: per-agent cooldown for `ready` (a task built) and a names-you `posted`,
// the same shape as needs_you. `replied` keeps NO cooldown (the DM route is
// unchanged). `postedRoom` is per-ROOM: at most one buzz per room per 10 minutes,
// so a busy opted-in room cannot flood the phone.
const READY_COOLDOWN_MS = 5 * 60 * 1000;
const POSTED_MENTION_COOLDOWN_MS = 5 * 60 * 1000;
const POSTED_ROOM_COOLDOWN_MS = 10 * 60 * 1000;
const COOLDOWN_PRUNE_MS = POSTED_ROOM_COOLDOWN_MS;   // the longest; an entry older than this has expired for every class

const file = () => path.join(remote.stateDir(), 'phone-notify.json');
/* #7448 (after #7446: a demo board signed in to a real account pushed its made-up agents to that person's phone): a
   computer can be marked never to send phone notices, for a demo or test install. Either the file below (made once by
   whoever sets the install up, kept across restarts, updates and Forget computer: it sits beside remote.json, outside
   the tunnel state dir that Forget empties, as the person's own off does) or KOSMOS_NO_PHONE_NOTICES=1 (a check run). While
   marked: nothing is sent, the switch never turns itself on, a press is refused with the reason, and Settings says
   why. The coordinator may still keep its own list (#7446); this is the board's half, so it holds wherever it runs. */
const noPushFile = () => path.join(path.dirname(remote.FILE), 'no-phone-notices');
function noPush() {
  if (process.env.KOSMOS_NO_PHONE_NOTICES === '1') return true;
  // Review 1: only "not there" is unmarked; any other failure to look (no permission, a broken path) counts as marked.
  try { fs.lstatSync(noPushFile()); return true; } catch (e) { return !(e && e.code === 'ENOENT'); }
}
const NO_PUSH_WHY = 'this computer is set never to send phone notices (a demo or test install)';
// #6488: the person's off, kept beside remote.json and OUTSIDE the tunnel state dir, because removing this computer
// from Kosmos+ deletes that dir (remote.forget), and a reconnect must not turn back on what the person turned off.
// It holds only { off: true }: no token. Written by turnOff (and by ensureDefaultOn, copying an off from before
// #6488), removed by a turn-on. It belongs to this computer (this
// data folder), not to a Kosmos+ account: a different person connecting it later keeps the earlier off. If removing
// it after a turn-on fails, it is left behind: still 'on' now (on wins), and after a reconnect it reads as off, the
// safe direction.
const choiceFile = () => path.join(path.dirname(remote.FILE), 'phone-notify-choice.json');
function choiceSaysOff() {
  try { const c = JSON.parse(fs.readFileSync(choiceFile(), 'utf8')); return !!(c && c.off === true); } catch { return false; }
}
/** The kept copy is there but cannot be read: like phone-notify.json, it then reads as off for masterChoice (it may
    have been the person's off), but is never treated as positive evidence of one. */
function choiceUnreadable() {
  let text;
  try { text = fs.readFileSync(choiceFile(), 'utf8'); } catch (e) { return !(e && e.code === 'ENOENT'); }
  try { const c = JSON.parse(text); return !(c && typeof c === 'object' && !Array.isArray(c)); } catch { return true; }
}
/** phone-notify.json, read cleanly, records an off: the marker, or a token or notifyId with the switch not on. */
function stateSaysOff() {
  try {
    const p = JSON.parse(fs.readFileSync(file(), 'utf8'));
    if (!p || typeof p !== 'object' || Array.isArray(p) || p.on === true) return false;
    return p.off === 'person' || (typeof p.token === 'string' && p.token !== '') || (typeof p.notifyId === 'string' && p.notifyId !== '');
  } catch { return false; }
}
function writeChoice(off) {
  try {
    fs.mkdirSync(path.dirname(choiceFile()), { recursive: true, mode: 0o700 });
    if (off) require('./securewrite').writeSecret(choiceFile(), JSON.stringify({ off: true }) + '\n', 0o600, { atomicOnly: true });
    else fs.rmSync(choiceFile(), { force: true });
  } catch { /* best effort: the off marker in phone-notify.json still holds while the computer stays connected */ }
}

/** A coordinator URL for `route`, keeping a self-hosted path prefix
    (https://h/kosmos -> https://h/kosmos/<route>). */
function coordinatorUrl(route) {
  const base = new URL(remote.coordinator());
  return new URL(base.pathname.replace(/\/+$/, '') + route, base).toString();
}

/** #6254: each per-kind switch, resolved to ITS OWN default when the stored
    `kinds` object is missing or the value is not a boolean. An unreadable file
    yields all defaults; the master `on` gates them on top, so a corrupt file is
    never all-on. */
function resolveKinds(raw) {
  const k = (raw && typeof raw === 'object' && raw.kinds && typeof raw.kinds === 'object' && !Array.isArray(raw.kinds)) ? raw.kinds : {};
  const out = {};
  for (const name of Object.keys(KIND_DEFAULTS)) {
    out[name] = KIND_DEFAULTS[name] ? k[name] !== false : k[name] === true;
  }
  return out;
}

/** { on, notifyId, token, kinds }. Missing file: off. Unreadable, unparseable or
    not a plain object: off, with all per-kind switches at their defaults. Only an
    explicit `on: true` is on. */
function readState() {
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { return { on: false, notifyId: null, token: null, kinds: resolveKinds(null) }; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { on: false, notifyId: null, token: null, kinds: resolveKinds(null) };
  return {
    on: parsed.on === true,
    notifyId: typeof parsed.notifyId === 'string' ? parsed.notifyId : null,
    token: typeof parsed.token === 'string' && TOKEN_SHAPE.test(parsed.token) ? parsed.token : null,
    kinds: resolveKinds(parsed),
  };
}

/** #6488: what the person chose for the master switch: 'on', 'off', or 'unset' (never touched).
    - 'on': the file says on:true.
    - 'off': the file says off:'person' (turnOff writes it since #6488), or it holds a token without on:true. Only a
      turn-on ever saves a token and turnOff keeps it, so a token with the switch off means the person turned it on
      and then off, on any version (a notifyId alone counts the same). Also 'off' when choiceFile says so: that one survives removing this computer
      from Kosmos+ and connecting it again.
    - 'unset': no file at all, or a plain file with neither (only a sub-switch was set: setKind works before any
      turn-on, and choosing which kinds buzz is not choosing to have none).
    A file that is present but unreadable, unparseable or not a plain object reads as 'off': it may have been an
    explicit off, and an off we cannot read is never turned on for the person. */
function masterChoice() {
  let text;
  try { text = fs.readFileSync(file(), 'utf8'); } catch (e) { return e && e.code === 'ENOENT' && !choiceSaysOff() && !choiceUnreadable() ? 'unset' : 'off'; }
  let parsed;
  try { parsed = JSON.parse(text); } catch { return 'off'; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return 'off';
  if (parsed.on === true) return 'on';
  if (parsed.off === 'person' || choiceSaysOff() || choiceUnreadable()) return 'off';
  if (typeof parsed.token === 'string' && parsed.token !== '') return 'off';
  // A notifyId is also only saved by a turn-on (and kept by turnOff), so it is the same evidence as a token.
  if (typeof parsed.notifyId === 'string' && parsed.notifyId !== '') return 'off';
  return 'unset';
}

/** The per-kind switches exactly as stored (booleans only, not resolved to
    defaults), so a write preserves the ones the person set and leaves the rest
    implicit at their defaults. */
function storedKinds() {
  try {
    const parsed = JSON.parse(fs.readFileSync(file(), 'utf8'));
    if (parsed && typeof parsed === 'object' && parsed.kinds && typeof parsed.kinds === 'object' && !Array.isArray(parsed.kinds)) {
      const out = {};
      for (const name of Object.keys(KIND_DEFAULTS)) if (typeof parsed.kinds[name] === 'boolean') out[name] = parsed.kinds[name];
      return out;
    }
  } catch { /* none */ }
  return {};
}

function writeState(next) {
  try {
    const f = file();
    fs.mkdirSync(path.dirname(f), { recursive: true, mode: 0o700 });
    // #5434 slice 15: through securewrite.writeSecret (flushed before the rename, the folder after on POSIX; a unique `wx` temp; exact 0600), so a crash cannot leave it at full length but zero-filled (#5431). atomicOnly: a failed save leaves the old file.
    require('./securewrite').writeSecret(f, JSON.stringify(next) + '\n', 0o600, { atomicOnly: true });
    // The old writer's fixed `<file>.tmp`, if a crash ever left one: it can hold a copy of the token, and no save
    // overwrites that name any more, so remove it after a good save (review 1). Best effort.
    try { fs.rmSync(f + '.tmp', { force: true }); } catch { /* not there, or not ours to remove */ }
    return { ok: true };
  } catch {
    return { ok: false, because: 'we could not save that setting' };
  }
}

/** What the Settings screen shows. Never the token. While the ship gate is
    closed it is off and unavailable, whatever the file says. */
function status() {
  if (!available) return { available: false, on: false, connected: plusLive(), kinds: readState().kinds, offByChoice: false, defaultBecause: null };
  const s = readState();
  // #6488: offByChoice: it stays off until a press (the person turned it off, or a settings file we cannot read), so
  // Settings does not promise it turns on by itself.
  const offByChoice = !s.on && masterChoice() === 'off';
  // defaultBecause: why it has not turned on by itself yet (Settings says it instead of promising), or null.
  // #6488: connected means Kosmos+ is live here (signed in AND switched on), the only state anything is sent in.
  // #7448: a computer marked never to send says so (noPush), and is shown off whatever an older file holds.
  if (noPush()) return { available: true, on: false, connected: plusLive(), kinds: s.kinds, offByChoice: false, defaultBecause: null, noPush: true, because: NO_PUSH_WHY };
  return { available: true, on: s.on, connected: plusLive(), kinds: s.kinds, offByChoice,
    defaultBecause: !s.on && !offByChoice ? defaultBecause : null };
}

/** Turn phone notifications on: mint a fresh notify token (minting replaces
    any earlier one at the coordinator, so a token it no longer knows is never
    reused), then save on. One turn-on at a time: two at once would each mint and
    could save the token the coordinator had already replaced. Refused, with
    nothing saved, when this computer is not connected to Kosmos+ or the mint
    fails. */
let turningOn = null;
function turnOn(opts) {
  if (!available) return Promise.resolve({ ok: false, because: 'phone notifications are not available yet' });
  if (noPush()) return Promise.resolve({ ok: false, notSent: true, because: NO_PUSH_WHY });   // #7448
  if (!turningOn) turningOn = doTurnOn(opts || {}).finally(() => { turningOn = null; });
  return turningOn;
}
/* `quiet` (the default turn-on, #6488): no log line here; startDefaultOn logs once per reason instead. A failure
   AFTER a mint succeeded whose retry would mint again at once carries `minted: true` (a bad answer, or a save that
   failed): the coordinator has already replaced this computer's token, so retrying soon would churn it. */
async function doTurnOn({ quiet } = {}) {
  // #6488: connected AND Kosmos+ switched on here (plusLive): a mint is a signed call to Kosmos+, and nothing goes there
  // while its switch is off, from a press or from the default.
  if (!plusLive()) {
    let signedIn = false;
    try { signedIn = remote.enrolled() === true; } catch { signedIn = false; }
    return { ok: false, notSent: true, because: signedIn
      ? 'switch Kosmos+ on for this computer first, then turn phone notifications on'
      : 'connect this computer to Kosmos+ first, then turn phone notifications on' };
  }
  const s = readState();
  const notifyId = s.notifyId || crypto.randomUUID();
  const minted = await remote.macRequest('POST', CREDENTIAL_ROUTE, { install_id: notifyId });
  if (!minted.ok) {
    if (/unrecognized subcommand|mac-request/.test(String(minted.because || ''))) {
      return { ok: false, because: 'Kosmos on this computer needs an update before phone notifications can be turned on' };
    }
    // The raw reason goes to the board's log; the person gets a sentence.
    if (!quiet) process.stderr.write('phonenotify: turning on failed: ' + String(minted.because || '') + '\n');
    // #6488: `detail` (the raw reason, for the default path's log, never shown to the person) and `notSent` (refused
    // on this computer before anything was sent, so the default path does not back off for it).
    return { ok: false, because: 'Kosmos+ could not be reached just now. Try again in a minute.',
      detail: String(minted.because || ''), notSent: minted.notSent === true };
  }
  // #6488: the state dir went while the mint was out (remote.forget itself waits for a mint in flight before it
  // deletes it, so this is the folder removed some other way): saving would bring back a token for an identity that
  // is gone. Not saved; a reconnect starts again from masterChoice.
  if (!remote.enrolled()) return { ok: false, because: 'This computer was removed from Kosmos+ while turning on.' };
  const token = minted.data && typeof minted.data.token === 'string' ? minted.data.token : '';
  if (!TOKEN_SHAPE.test(token)) return { ok: false, minted: true, because: 'Kosmos+ answered in a shape we could not use.' };
  // #7448 review 1: the mark appeared while this turn-on was out: nothing is saved on, and the press is told why.
  if (noPush()) return { ok: false, notSent: true, because: NO_PUSH_WHY };
  const saved = writeState({ on: true, notifyId, token, kinds: storedKinds() });
  if (!saved.ok) return { ok: false, minted: true, because: 'This setting could not be saved on this computer.' };
  writeChoice(false);   // #6488: turning on undoes the person's earlier off
  return saved;
}

/** Turn them off. Nothing is sent while off. The token is kept on disk (it can
    only send events), and turning on again mints a new one anyway. Waits for a
    turn-on in flight, so that turn-on cannot save `on` over this. */
async function turnOff() {
  if (turningOn) { try { await turningOn; } catch { /* its outcome does not matter here */ } }
  const s = readState();
  // #6488: `off: 'person'` records the choice, so the default turn-on never undoes it (masterChoice).
  const saved = writeState({ on: false, off: 'person', notifyId: s.notifyId, token: s.token, kinds: storedKinds() });
  if (saved.ok) writeChoice(true);   // only after a good save: an off the person was told failed is not kept
  return saved;
}

/** #6254: set one per-kind sub-switch (the Settings toggles under the master).
    An unknown kind name is refused. Preserves the master `on`, the token and
    notifyId, and the other kinds' stored values. */
async function setKind(name, on) {
  if (!Object.prototype.hasOwnProperty.call(KIND_DEFAULTS, name)) return { ok: false, because: 'unknown notification kind' };
  // Wait for a turn-on in flight, as turnOff does: its write saves `kinds: storedKinds()`
  // read after its await, so an un-awaited setKind here could be lost under it, or could
  // save `on: s.on` (stale) over the turn-on's `on: true`.
  if (turningOn) { try { await turningOn; } catch { /* its outcome does not matter here */ } }
  // #6488: a settings file we cannot read may hold the person's off; writing the sub-switch would replace it with a
  // never-touched file the default then turns on. Refuse instead, and leave the file as it is.
  if (masterChoice() === 'off' && !choiceSaysOff() && !stateSaysOff()) {   // unreadable (either file): leave it be
    return { ok: false, because: 'this setting could not be read, so it was not changed' };
  }
  const s = readState();
  const k = storedKinds();
  k[name] = on === true;
  // #6488: keep a person's off. A sub-switch write must not turn an explicit off back into 'unset'.
  // Positive evidence only: an unreadable file reads as off but was never the person's choice.
  const off = !s.on && (choiceSaysOff() || stateSaysOff()) ? 'person' : undefined;
  return writeState({ on: s.on, off, notifyId: s.notifyId, token: s.token, kinds: k });
}

/** #6488: connected to Kosmos+ AND its switch on. Signing in leaves files on disk after the person switches Kosmos+
    off; that is not a computer anything about agents may be sent from. A read that fails reads as off. */
function plusLive() {
  try { return remote.enrolled() === true && remote.read().on === true; } catch { return false; }
}

let defaultBecause = null;   // #6488: why the default could not turn it on, last time (the person's sentence), or null

/** #6488: turn phone notifications on for a computer whose person never touched the switch, once it is connected to
    Kosmos+ (minting needs the connection). Does nothing while the ship gate is closed, while not connected, or when
    the person chose either way. Through turnOn, so it mints exactly as the Settings button does and shares its
    one-at-a-time guard. Resolves to turnOn's answer, or null when it did nothing. Never throws. */
async function ensureDefaultOn() {
  try {
    if (!available) return null;
    const choice = masterChoice();
    // An off that lives only in phone-notify.json (one from before #6488: a token or notifyId held with the switch
    // off) goes with that file when this computer is removed. Copy it to choiceFile while it is still here: no
    // network, no connection needed, and tried again on every run if a write failed. Only positive evidence is
    // copied: a file we cannot read still keeps the default from turning it on (masterChoice), but one bad read
    // (a crash-damaged file, a passing read error) must not become a permanent off for someone who never chose.
    if (choice === 'off' && !choiceSaysOff() && stateSaysOff()) writeChoice(true);
    if (!remote.enrolled()) { defaultBecause = null; return null; }
    if (choice !== 'unset') { defaultBecause = null; return null; }
    if (noPush()) { defaultBecause = null; return null; }   // #7448: a demo or test install never turns itself on
    // Signed in but Kosmos+ switched off on this computer: the person took it off Kosmos+, so nothing is minted
    // and nothing about agents goes there until they switch it back on (Settings reads it as not connected).
    if (!plusLive()) { defaultBecause = null; return null; }
    const r = await turnOn({ quiet: true });
    // A refusal made here before anything was sent (busy signing in) is not a reason worth showing; it retries soon.
    defaultBecause = r && r.ok === false && r.notSent !== true ? String(r.because || '') || null : null;
    return r;
  } catch { return null; }
}

const DEFAULT_ON_EVERY_MS = 5 * 60 * 1000;
const DEFAULT_ON_MAX_MS = 60 * 60 * 1000;   // after a mint we could not use (each retry replaces the token)
const DEFAULT_ON_FAIL_MAX_MS = 15 * 60 * 1000;   // any other failure: nothing was replaced, so retry within 15 minutes
let defaultOn = null;   // the running schedule (startDefaultOn), so sign-in can poke it

/** #6488: run ensureDefaultOn now, then again after DEFAULT_ON_EVERY_MS, so a computer connected later is turned on
    without a restart. A failed turn-on waits twice as long each time, up to DEFAULT_ON_FAIL_MAX_MS, and back to the
    short wait once there is nothing to do, or when this computer's connection changes; a refusal made on this
    computer before anything was sent (`notSent`: busy signing in or being removed) does not lengthen the wait. One
    that failed after its mint succeeded (`minted`) waits the longest, because each retry replaces the token at the
    coordinator. A failure is logged once per reason, with the raw reason (`detail`). Only one timer is ever
    pending, and runs never overlap (a poke while one is out runs after it).
    Started by server.js at real startup (not under the test runner). Returns { stop, poke, whenIdle, waitMs,
    stopped } (poke and the rest for tests). */
function startDefaultOn({ schedule = setTimeout, ensure = ensureDefaultOn } = {}) {   // both injectable for tests
  let lastBecause = null;
  let wait = DEFAULT_ON_EVERY_MS;
  let stopped = false;
  let timer = null;
  let inFlight = Promise.resolve();
  let wasConnected = null;
  const next = () => {
    if (stopped) return;
    if (timer) { try { clearTimeout(timer); } catch { /* a test's timer */ } }
    timer = schedule(tick, wait);
    if (timer && typeof timer.unref === 'function') timer.unref();
  };
  function handle(r) {
    const connected = plusLive();   // signed in and switched on; switching Kosmos+ back on counts as connecting
    // Startup counts as a change too: a failure on the first run (the network not up yet) retries soon.
    const changed = wasConnected === null || connected !== wasConnected;
    if (changed) wait = DEFAULT_ON_EVERY_MS;   // a first failure right after connecting retries soon
    wasConnected = connected;
    if (r && r.ok === true) {
      process.stdout.write('phonenotify: phone notifications turned on by default (#6488)\n');
      wait = DEFAULT_ON_EVERY_MS; lastBecause = null;
    } else if (r && r.ok === false) {
      const why = String(r.detail || r.because);
      if (why !== lastBecause) {
        lastBecause = why;
        process.stderr.write('phonenotify: could not turn phone notifications on by default: ' + why + '\n');
      }
      if (r.minted === true) wait = DEFAULT_ON_MAX_MS;
      else if (r.notSent !== true && !changed) wait = Math.min(wait * 2, DEFAULT_ON_FAIL_MAX_MS);
    } else {
      wait = DEFAULT_ON_EVERY_MS;
    }
  }
  function tick() {
    // One handler for every outcome, and a failure inside it never ends the schedule. Runs one at a time.
    inFlight = inFlight.then(() => ensure()).then((r) => { try { handle(r); } catch { /* next() still runs */ } }, () => {})
      .then(() => { try { next(); } catch { /* a schedule that cannot be set ends here */ } });
    return inFlight;
  }
  tick();
  const ctl = {
    stop: () => {
      stopped = true;
      if (timer) { try { clearTimeout(timer); } catch { /* a test's timer */ } }
      if (defaultOn === ctl) defaultOn = null;   // a later sign-in poke falls back to ensureDefaultOn
    },
    // Sign-in: start over from the short wait and try now.
    poke: () => { if (stopped) return inFlight; wait = DEFAULT_ON_EVERY_MS; lastBecause = null; return tick(); },
    whenIdle: () => inFlight,   // the tick in flight (tests)
    waitMs: () => wait,
    stopped: () => stopped,
  };
  defaultOn = ctl;
  return ctl;
}

/** #6488: sign-in just connected this computer: run the default now, through the schedule when it is running, so a
    long wait left from before is reset. Never throws. */
function pokeDefaultOn() {
  try {
    if (defaultOn) return defaultOn.poke();
    // Under the test runner nothing starts the real schedule (server.js), and a route test's sign-in must not mint
    // through its fake tunnel; a test that wants the default runs it itself.
    if (process.env.NODE_TEST_CONTEXT) return Promise.resolve(null);
    return ensureDefaultOn();
  } catch { return Promise.resolve(null); }
}

/** `v` cut to at most `n` UTF-8 bytes, never inside a character. */
function capBytes(v, n) {
  let out = '';
  let used = 0;
  for (const ch of String(v)) {
    const size = Buffer.byteLength(ch);
    if (used + size > n) break;
    out += ch;
    used += size;
  }
  return out;
}
const cap = (v, n) => (v === null || v === undefined || v === '' ? null : capBytes(v, n));

function payload(notifyId, { kind, id, agent, session, project, projectId }) {
  return {
    installId: notifyId,
    id: cap(id, CAPS.id),
    kind,
    agent: capBytes(agent || 'An agent', CAPS.agent),
    session: cap(session, CAPS.session),
    project: cap(project, CAPS.project),
    // #6254: the project id (not the display name) so a `posted` tap can open the
    // room on her board (coordinator sw.js ?tab=projects&project=<id>). Always
    // present like project/session, null off a posted event or on an older board.
    projectId: cap(projectId, CAPS.project),
    at: new Date().toISOString(),
  };
}

// Test seams: (url, headers, body) => void, and a clock. Without an injected
// sender, node --test never dials.
let sender = null;
function setSender(fn) { sender = typeof fn === 'function' ? fn : null; }
let clock = () => Date.now();
function setClock(fn) { clock = typeof fn === 'function' ? fn : () => Date.now(); }
const lastSent = new Map();   // "<cooldownClass>:<key>" -> when it last buzzed

/** #6254: which master-kind sub-switch gates an event, and its cooldown (a
    class + key + window, or no cooldown). `posted` splits by `namesPerson`, a
    board-side flag the room-post send site sets (it is NOT part of the payload
    the coordinator sees); a names-you post is per-agent, any other room post is
    per-ROOM so a busy opted-in room buzzes at most once per window. `replied`
    keeps no cooldown (the DM route is unchanged). */
function routeFor(event) {
  const agentKey = String(event.session || event.agent || '');
  switch (event.kind) {
    case 'needs_you': return { sw: 'needsYou', cls: 'needs_you', key: agentKey, ms: NEEDS_YOU_COOLDOWN_MS };
    case 'replied': return { sw: 'replied', cls: null };
    case 'ready': return { sw: 'ready', cls: 'ready', key: agentKey, ms: READY_COOLDOWN_MS };
    case 'posted': return event.namesPerson
      ? { sw: 'postedMention', cls: 'posted_mention', key: agentKey, ms: POSTED_MENTION_COOLDOWN_MS }
      // Key per-room on the project id (unique) and fall back to the name only when
      // there is no id, so two rooms that share a display name keep separate windows
      // and a null-project post does not collapse every nameless room into one.
      : { sw: 'postedRoom', cls: 'posted_room', key: String(event.projectId || event.project || ''), ms: POSTED_ROOM_COOLDOWN_MS };
    default: return null;
  }
}

function defaultSend(url, headers, body) {
  const u = new URL(url);
  const req = (u.protocol === 'http:' ? http : https).request(
    { method: 'POST', hostname: u.hostname, port: u.port || undefined, path: u.pathname,
      headers: { ...headers, 'content-length': Buffer.byteLength(body) }, timeout: TIMEOUT_MS, agent: false },
    (res) => {
      // A refused send stops notifications with no other symptom, so say so in
      // the board's log (never the token or the payload).
      if (res.statusCode < 200 || res.statusCode >= 300) {
        process.stderr.write('phonenotify: Kosmos+ answered ' + res.statusCode + ' to a notification\n');
      }
      res.resume();
    },
  );
  req.on('error', (err) => {
    process.stderr.write('phonenotify: could not reach Kosmos+: ' + ((err && err.code) || 'error') + '\n');
  });
  req.on('timeout', () => { try { req.destroy(); } catch { /* gone */ } });
  req.end(body);
}

/* #7210: a project's notification level, asked of the board's project store (server.js sets it; engine/projects.js
   notifyLevel). Never set (a test, a board that has not wired it): every project reads as 'all'. */
let projectLevel = null;
function setProjectLevel(fn) { projectLevel = typeof fn === 'function' ? fn : null; }
/** Whether a project's level lets this route through. 'muted' sends nothing from the project; 'mentions' keeps what is
    addressed to the person (an agent that needs them, a post naming them, work waiting for their check) and drops any
    other room post. An event with no project (a crash loop, an answer) belongs to an agent, never to a project. */
function levelAllows(event, route) {
  const pid = event.levelProjectId || event.projectId;
  if (!pid || !projectLevel) return true;
  let level = 'all';
  try { level = projectLevel(String(pid)); } catch { level = 'all'; }
  if (level === 'muted') return false;
  if (level === 'mentions') return route.sw !== 'postedRoom';
  return true;
}

/** Tell the coordinator something happened. Never throws, never awaited. Sends
    only when on, connected, holding a token, and the kind is one we send. */
function happened(event) {
  try {
    if (!available) return;
    if (!event || !KINDS.has(event.kind)) return;
    if (noPush()) return;   // #7448: a demo or test install never reaches a phone
    const route = routeFor(event);
    if (!route) return;
    if (!levelAllows(event, route)) return;   // #7210, before the cooldown so a muted event spends no window
    if (!sender && process.env.NODE_TEST_CONTEXT) return;
    const s = readState();
    if (!s.on || !s.token || !s.notifyId) return;
    if (!s.kinds[route.sw]) return;   // #6254: this kind's sub-switch is off
    if (!plusLive()) return;   // #6488: signed in is not enough; Kosmos+ switched off here sends nothing
    if (route.cls) {
      const ckey = route.cls + ':' + route.key;
      const now = clock();
      const last = lastSent.get(ckey);
      if (last !== undefined && now - last < route.ms) return;
      if (lastSent.size > 500) {
        for (const [k, t] of lastSent) if (now - t >= COOLDOWN_PRUNE_MS) lastSent.delete(k);
      }
      lastSent.set(ckey, now);
    }
    const url = coordinatorUrl(NOTIFY_ROUTE);
    const body = JSON.stringify(payload(s.notifyId, event));
    (sender || defaultSend)(url, { 'content-type': 'application/json', 'x-kosmos-notify-token': s.token }, body);
    // kosmos#6487: a plain lock-screen notice is explained by this line and the phonenotice line after it. The id's
    // kind and the session only, never the words. Written after the send, so a send that throws logs nothing. The
    // phone asks with the id AS SENT (cut to CAPS.id), so judge that one.
    const notice = require('./phonenotice');
    const sentId = cap(event.id, CAPS.id);
    const can = notice.parseId(sentId) === null ? '; the phone cannot ask for its words, so it shows plain'
      : sentId !== event.id ? '; its id was cut to fit, so the phone\'s ask finds no words and it shows plain'
        : '; the phone can ask for its words';
    const who = notice.logName(event.session);
    process.stderr.write('phonenotify: sent ' + event.kind + ' (' + notice.idKind(event.id) + ') ref ' + notice.idRef(sentId) + (who ? ' for ' + who : '') + can + '\n');
  } catch { /* a notification is never a reason to fail the report it rides on */ }
}

module.exports = { noPush, NO_PUSH_WHY, setProjectLevel, PHONE_APP_CAN_RECEIVE, setAvailableForTests, KINDS, KIND_DEFAULTS, NEEDS_YOU_COOLDOWN_MS, READY_COOLDOWN_MS, POSTED_MENTION_COOLDOWN_MS, POSTED_ROOM_COOLDOWN_MS, status, turnOn, turnOff, setKind, masterChoice, ensureDefaultOn, startDefaultOn, pokeDefaultOn, DEFAULT_ON_EVERY_MS, DEFAULT_ON_MAX_MS, DEFAULT_ON_FAIL_MAX_MS, happened, payload, setSender, setClock, readState, resetCooldownForTests: () => lastSent.clear() };
