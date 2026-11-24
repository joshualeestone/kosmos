'use strict';

/*
 * kosmos#8952 slice (d): let a long permission request be approved from the board or the phone's conversation page.
 *
 * THE PROBLEM. Agents start at tmux's default 80x24 (bin/agent-supervisor.sh passes no size). A permission prompt for a
 * long command does not fit, so Claude Code draws the bottom of the box only, ending in its own hint "↑ 50 more lines",
 * the top rule and title off screen. chat.permissionAnswerable is false there on purpose (#6054 review 3: a cut box could
 * share its visible tail with another command's), so slice (c) offers only its No.
 *
 * WHAT THIS DOES. While such a cut prompt is up on a Claude agent's window that nobody is watching, the window is made
 * taller by exactly the hidden rows (plus FIT_MARGIN), up to MAX_ROWS. Claude Code redraws the WHOLE box at that height,
 * and the next read of the screen takes the ordinary whole-box path (permissionCard, the request fingerprint, the press
 * route's re-look), unchanged. When the prompt is gone the window goes back to the size it had.
 *
 * MEASURED (2026-11-24, Claude Code 2.1.331, tmux 3.6a; card comment 7131048790 and the round-1 notes):
 *  - At 80x24 a 60-line mkdir shows 15 lines and "↑ 50 more lines". At 24 + 50 + 2 = 76 rows every line draws, title to
 *    question, with nothing below the box, and status.classify reads needs_you. A flat 200 rows left 26 blank rows under
 *    the box (the screen is shorter than the pane), and classify, which reads the last 25 rows, said unknown. So the
 *    window grows by the hint, never by a guess, and with no hint on screen it is not grown at all.
 *  - `resize-window` sets the window's `window-size` option to manual, and so does `resize-window -A`. Restoring is the
 *    recorded size first, THEN unsetting the option (unset before the resize and the resize sets it again).
 *  - A client attached to the session (a person watching in a terminal) is panned to the TOP of a window taller than
 *    itself and loses sight of the question. So a window with any client (its own session's, or a grouped session's) is
 *    never grown, and a grown window that gains one is put back at once. That person can answer at the computer.
 *  - The size is recorded in a window option (GROWN_OPT) BEFORE the resize, as "<W>x<H>@<world>", so a board restart or a
 *    crash between the two still finds the window to put back, and a second board on the same tmux server (another
 *    world) never touches this board's windows, nor this board its.
 *
 * NOT DONE: a box taller than MAX_ROWS stays cut, and slice (c)'s No stays. A window with more than one pane is left
 * alone (resizing it would resize the other panes too; agents run one pane per session). The lock-screen notice is
 * unchanged: it offers buttons only for a one-line command (server.js phonePermissionNow), which a cut box never is.
 */

const status = require('./status');
const chat = require('./chat');

const GROWN_OPT = '@kosmos_permgrow';
const MAX_ROWS = 200;
const FIT_MARGIN = 4;
const DEFAULT_SIZE = { w: 80, h: 24 };   // tmux's default-size, what an agent starts at: the restore for a mark with no size
const RETRY_AFTER_MS = 60 * 1000;
const FIELDS = ['#{window_id}', '#{session_name}', '#{window_index}', '#{window_panes}', '#{session_attached}', '#{session_group_attached}',
  '#{window_active_clients}', '#{window_width}', '#{window_height}', `#{${GROWN_OPT}}`];
const LIST_ARGS = ['list-windows', '-a', '-F', FIELDS.join('\t')];

function sizeOf(v) {
  const m = /^(\d{1,4})x(\d{1,4})$/.exec(String(v == null ? '' : v).trim());
  if (!m) return null;
  const w = Number(m[1]); const h = Number(m[2]);
  return w > 0 && h > 0 ? { w, h } : null;
}

/* A mark is "<W>x<H>@<world>". { world, size } with size null when the size part does not read; null when there is no
   "@<world>" (not a mark this code writes). */
function markOf(v) {
  const m = /^(.*)@([A-Za-z0-9_-]+)$/.exec(String(v == null ? '' : v).trim());
  return m ? { world: m[2], size: sizeOf(m[1]) } : null;
}

/* One row per window, from LIST_ARGS's output. A row that does not parse is dropped (it names no window we can act on). */
function parseWindows(out) {
  const rows = [];
  for (const line of String(out == null ? '' : out).split('\n')) {
    if (!line) continue;
    const c = line.split('\t');
    if (c.length !== FIELDS.length) continue;
    const [id, session, win, panes, attached, groupAttached, viewing, w, h, mark] = c;
    if (!/^@\d+$/.test(id) || !session || !/^\d+$/.test(win)) continue;
    rows.push({
      id,
      session,
      window: win,
      panes: Number(panes),
      /* Review 3: a window linked into another session (link-window) can be watched from there, which neither session
         count sees; window_active_clients counts the clients viewing THIS window through any session. Measured (tmux
         3.6a): 0 with nobody viewing, grouped or linked; 1 for a client on a grouped session or on the linking one.
         (window_linked is not it: every window in a session group reads linked=1, so it called every grouped window
         watched, found in the real run after review 4.) */
      attached: Math.max(Number(attached) || 0, Number(groupAttached) || 0, Number(viewing) || 0),
      size: sizeOf(`${w}x${h}`),
      mark: mark ? markOf(mark) : null,
      markRaw: mark || '',
    });
  }
  return rows;
}

/* Review 4: a window in a session group is listed once per session in the group. Planned per window (its id), with the
   row a card names when there is one, and the most watching clients of any of its rows. */
function oneRowPerWindow(rows, cards) {
  const named = new Set();
  for (const c of Array.isArray(cards) ? cards : []) { const at = windowOf(c); if (at) named.add(`${at.session}\u0000${at.window}`); }
  const byId = new Map();
  for (const r of rows) {
    const had = byId.get(r.id);
    const mine = named.has(`${r.session}\u0000${r.window}`);
    if (!had) { byId.set(r.id, { ...r, named: mine }); continue; }
    const keep = !had.named && mine ? { ...r, named: true } : had;
    byId.set(r.id, { ...keep, attached: Math.max(had.attached, r.attached) });
  }
  return [...byId.values()].map(({ named, ...r }) => r);
}

/* The window a card's pane is in: card.target is "<session>:<window>.<pane>" (status.js PANE_COLUMNS). */
function windowOf(card) {
  const m = /^(.*):(\d+)\.\d+$/.exec(String((card && card.target) || ''));
  return m ? { session: m[1], window: m[2] } : null;
}

/* The rows Claude Code says it left out of a box: its own "↑ N more lines" hint, read only in the last few rows (where it
   draws it, under the options). null when there is none. */
function hiddenRows(text) {
  const tail = String(text == null ? '' : text).replace(/\s+$/, '').split('\n').slice(-6);
  for (const l of tail) {
    const m = /^\s*↑\s+(\d{1,4})\s+more lines?\s*$/.exec(l);
    if (m) return Number(m[1]);
  }
  return null;
}

/* PURE. What to do this tick: { acts: [{ act: 'grow' | 'restore', session, window, size, rows?, again? }], judged, unsure }.
   `judged`: waiting agents settled under their current report (not read again while it stands). `unsure`: waiting
   agents whose screen did not yet show a box with its hint (read again, a few times).
   `cards`: the roster. `windows`: parseWindows' rows. `waiting`: Map of session name -> report time, the agents whose
   own hook reports a permission wait now. `skip`: Set of names judged earlier under the same report. `screenOf(card)`:
   the screen the thread route would read, or null when it could not be read. `busy(card)`: a key answer or a delivery is
   under way on its pane. `world`: this board's world id. */
function plan({ cards, windows, waiting, skip, screenOf, busy, world, grownFor = new Map(), restoreOnly = false }) {
  const acts = [];
  const judged = [];
  const unsure = [];
  const watched = [];
  const seen = [];   // [window id, request id] of a whole box on a grown window, for the caller to remember
  const list = Array.isArray(cards) ? cards : [];
  const cardAt = new Map();
  for (const c of list) {
    const at = windowOf(c);
    if (at) cardAt.set(`${at.session}\u0000${at.window}`, c);
  }
  const read = (card) => { try { return screenOf(card); } catch { return null; } };
  const isBusy = (card) => { try { return Boolean(busy && busy(card)); } catch { return true; } };
  for (const w of windows || []) {
    if (!w.mark || w.mark.world !== world) continue;   // not ours: another board's, or nothing this code wrote
    const card = cardAt.get(`${w.session}\u0000${w.window}`);
    const size = w.mark.size || DEFAULT_SIZE;
    const restore = { act: 'restore', id: w.id, session: w.session, window: w.window, size };
    if (card && isBusy(card)) continue;   // a press is reading this screen: leave it for the next tick
    if (restoreOnly || !w.mark.size || w.attached > 0 || !card) { acts.push(restore); continue; }
    const text = read(card);
    if (text == null) continue;   // could not read it: keep the size, ask again next tick
    if (status.claudePermissionPrompt(text) && chat.permissionAnswerable(text)) {
      /* Review 3 and 4: the window is kept for the box it was grown for, known by that box's own fingerprint (the
         request id) the first time it reads whole. Another box (a new prompt, such as a short one right after the long
         one) puts it back, so a short box is not drawn at the top of a tall window over blank rows the status reader
         cannot read; the grow loop grows it again if the new box needs it. A report changing under the SAME box (a
         parallel hook's line) changes nothing. Not known yet (just grown, or a board restart): remembered now, kept. */
      const card0 = chat.permissionCard(text);
      const req = card0 ? chat.permissionRequestId(card0) : null;
      const had = grownFor.get(w.id);
      if (req && had && had !== req) { acts.push(restore); continue; }
      if (req && !had) seen.push([w.id, req]);
      continue;
    }
    if (!status.claudePermissionPrompt(text)) {
      acts.push(restore);
      /* Review 2: while the same report stands, never grow this window again: a screen that stops reading as a prompt
         at the grown height (another layout, a redraw) would otherwise grow and shrink every tick. */
      if (waiting && waiting.has(card.sessionName)) judged.push(card.sessionName);
      continue;
    }
    /* Review 2: a second long prompt in the same turn, or a box still cut at the fitted height: grow again by its own
       hint, keeping the recorded size to go back to. */
    const hidden = !chat.permissionAnswerable(text) ? hiddenRows(text) : null;
    const rows = hidden && w.size ? w.size.h + hidden + FIT_MARGIN : 0;
    if (hidden && rows <= MAX_ROWS) acts.push({ act: 'grow', id: w.id, session: w.session, window: w.window, size, rows, again: true });
  }
  for (const card of list) {
    if (!card) continue;
    const name = card.sessionName;
    if (!waiting || !waiting.has(name) || (skip && skip.has(name))) continue;
    /* Review 3: a waiting agent this sweep can never grow is settled under its report, so it does not make every tick
       read the roster. A person watching, or no window found yet, may change: read again a few times (unsure). */
    if (card.isNamedOurs !== true || card.reachedByChannel === true || String(card.runner || 'claude') !== 'claude') { judged.push(name); continue; }
    const at = windowOf(card);
    const w = at && (windows || []).find((x) => x.session === at.session && x.window === at.window);
    if (!w) { unsure.push(name); continue; }
    if (w.markRaw && !(w.mark && w.mark.world === world)) { judged.push(name); continue; }   // another board's window
    if (w.markRaw) continue;   // ours, grown: the first loop looks after it
    if (w.panes !== 1 || !w.size) { judged.push(name); continue; }
    /* Review 4: someone watching is a moment, not evidence about the screen: looked at again every tick (the roster is
       the 20 s kept one), never counted toward the unsure budget. */
    if (w.attached > 0) { watched.push(name); continue; }
    if (isBusy(card)) continue;
    const text = read(card);
    if (text == null) { unsure.push(name); continue; }
    /* Only a FINAL verdict is judged (not read again under this report): a whole box, or one taller than MAX_ROWS.
       Review 2: no prompt on screen yet (the hook reports before the box is drawn) or a cut box with no hint yet is
       `unsure`, read again next tick; the caller caps those re-reads. */
    if (!status.claudePermissionPrompt(text)) { unsure.push(name); continue; }
    if (chat.permissionAnswerable(text)) { judged.push(name); continue; }
    const hidden = hiddenRows(text);
    if (!hidden) { unsure.push(name); continue; }
    const rows = w.size.h + hidden + FIT_MARGIN;
    if (rows > MAX_ROWS) { judged.push(name); continue; }
    acts.push({ act: 'grow', id: w.id, session: w.session, window: w.window, size: w.size, rows, name });
  }
  return { acts, judged, unsure, watched, seen };
}

/* Runs one action through `tmux(args)` (chat's runner: { ran, status, out }). Returns true when tmux took every step. */
function run(a, tmux, world) {
  const t = a.id || `=${a.session}:${a.window}`;   // the window id: one window whatever session group it is listed under
  const ok = (r) => Boolean(r && r.ran && r.status === 0);
  if (a.act === 'grow' && a.again) return ok(tmux(['resize-window', '-t', t, '-y', String(a.rows)]));   // the mark stands
  if (a.act === 'grow') {
    if (!ok(tmux(['set-option', '-w', '-t', t, GROWN_OPT, `${a.size.w}x${a.size.h}@${world}`]))) return false;
    if (ok(tmux(['resize-window', '-t', t, '-y', String(a.rows)]))) return true;
    // The resize may still have set window-size to manual: put the window back as it was, then clear the mark.
    tmux(['resize-window', '-t', t, '-x', String(a.size.w), '-y', String(a.size.h)]);
    tmux(['set-option', '-w', '-t', t, '-u', 'window-size']);
    tmux(['set-option', '-w', '-t', t, '-u', GROWN_OPT]);
    return false;
  }
  let fine = ok(tmux(['resize-window', '-t', t, '-x', String(a.size.w), '-y', String(a.size.h)]));
  // After the resize: resize-window sets window-size to manual, and unsetting it hands the size back to tmux's rule.
  fine = ok(tmux(['set-option', '-w', '-t', t, '-u', 'window-size'])) && fine;
  if (fine) fine = ok(tmux(['set-option', '-w', '-t', t, '-u', GROWN_OPT]));
  return fine;
}

/* Which agents' own hooks report a permission wait right now (selfreport's by:'auto' needs_you, what the phone's notice
   keys on): Map of the store's key (store.safeKey of the session name) -> the report's time. A cheap file read per agent,
   so the roster and the screens are read only on a tick that could act. */
function permissionWaits(cache = new Map()) {
  const selfreport = require('./selfreport');
  const fs = require('node:fs');
  const path = require('node:path');
  const found = new Map();
  let names;
  try { names = fs.readdirSync(selfreport.DIR); } catch { cache.clear(); return found; }
  const seen = new Set();
  for (const f of names) {
    if (!f.endsWith('.jsonl')) continue;
    const key = f.slice(0, -'.jsonl'.length);
    seen.add(key);
    try {
      // Review 2: a report is re-read only when its file changed (size or time), so a tick is a listing and stats.
      const st = fs.statSync(path.join(selfreport.DIR, f));
      const stamp = `${st.size}:${st.mtimeMs}`;
      let kept = cache.get(key);
      if (!kept || kept.stamp !== stamp) {
        const rep = selfreport.read(key);
        kept = { stamp, at: selfreport.isAutoPermissionWait(rep) ? String(rep.at || '') : null };
        cache.set(key, kept);
      }
      if (kept.at !== null) found.set(key, kept.at);
    } catch { cache.delete(key); /* unreadable: not known to be waiting */ }
  }
  for (const k of cache.keys()) if (!seen.has(k)) cache.delete(k);
  return found;
}

/* The store's key for a session name. Two names that differ only in case or punctuation share one (store.safeKey), so
   one agent's report can make the other look waiting: the cost is one extra screen read, never an action, since a grow
   needs that agent's own screen to show a cut box. */
function keyOf(name) {
  try { return require('./store').safeKey(name); } catch { return null; }
}

/* The sweep's memory between ticks: the reports already judged, and windows whose last action failed (left alone for
   RETRY_AFTER_MS, and logged once). */
const UNSURE_READS = 3;
function newMemory() { return { judged: new Map(), unsure: new Map(), failedUntil: new Map(), reports: new Map(), grownFor: new Map() }; }

/* The world as a mark carries it: only the characters markOf reads back (a world id is [a-z0-9_-] already). */
function worldTag(world) { return String(world == null ? '' : world).replace(/[^A-Za-z0-9_-]/g, '') || 'default'; }

/* One tick. `roster()` returns the board's roster (called at most once, and only on a tick that could act); `tmux`,
   `screenOf`, `busy` default to chat's; `waits()` to permissionWaits; `world` to this board's. `restoreOnly` (the
   operator brake) puts grown windows back and grows none. */
function sweepOnce({ roster, tmux = chat.tmuxCall, screenOf, busy = chat.paneKeysBusy, waits = permissionWaits,
  world = require('./launchidentity').currentWorldId(), memory = newMemory(), now = Date.now(), restoreOnly = false, log } = {}) {
  world = worldTag(world);
  const listed = tmux(LIST_ARGS);
  if (!listed || !listed.ran || listed.status !== 0) return [];
  const rows = parseWindows(listed.out);
  const ours = rows.some((w) => w.mark && w.mark.world === world);
  const byKey = restoreOnly ? new Map() : waits(memory.reports);
  for (const k of memory.judged.keys()) if (byKey.get(k) !== memory.judged.get(k)) memory.judged.delete(k);
  for (const [k, u] of memory.unsure) if (byKey.get(k) !== u.at) memory.unsure.delete(k);
  const fresh = [...byKey.keys()].some((k) => !memory.judged.has(k));
  if (!ours && !fresh) return [];
  const cards = typeof roster === 'function' ? roster() : roster;
  if (!Array.isArray(cards)) return [];
  const waiting = new Map();
  const skip = new Set();
  const onRoster = new Set();
  for (const c of cards) {
    const k = c && keyOf(c.sessionName);
    if (k == null) continue;
    onRoster.add(k);
    if (!byKey.has(k)) continue;
    waiting.set(c.sessionName, k);
    if (memory.judged.has(k)) skip.add(c.sessionName);
  }
  // Review 3: a report with no agent on the roster (a removed agent's last line) is settled, never read again.
  for (const [k, at] of byKey) if (!onRoster.has(k)) memory.judged.set(k, at);
  const windows = oneRowPerWindow(rows, cards);
  const ids = new Set(windows.map((w) => w.id));
  for (const k of memory.failedUntil.keys()) if (!ids.has(k)) memory.failedUntil.delete(k);
  for (const k of memory.grownFor.keys()) if (!ids.has(k)) memory.grownFor.delete(k);
  const read = screenOf || ((card) => chat.viewport(card.sessionName, cards).text);
  const { acts, judged, unsure, seen } = plan({ cards, windows, waiting, skip, screenOf: read, busy, world, grownFor: memory.grownFor, restoreOnly });
  for (const [id, req] of seen) memory.grownFor.set(id, req);
  for (const name of judged) { const k = waiting.get(name); if (k != null) { memory.judged.set(k, byKey.get(k)); memory.unsure.delete(k); } }
  /* An unsure screen is read again, UNSURE_READS times per report: a stale report whose agent shows no prompt costs a
     few reads, not one every tick for as long as the report stands. */
  const countUnsure = (name) => {
    const k = waiting.get(name);
    if (k == null) return;
    const u = memory.unsure.get(k) || { at: byKey.get(k), reads: 0 };
    u.reads += 1;
    if (u.reads >= UNSURE_READS) { memory.judged.set(k, byKey.get(k)); memory.unsure.delete(k); } else memory.unsure.set(k, u);
  };
  for (const name of unsure) countUnsure(name);
  const done = [];
  for (const a of acts) {
    const key = a.id;
    const until = memory.failedUntil.get(key);
    if (until && now < until) continue;
    const took = run(a, tmux, world);
    if (took && a.act === 'restore') memory.grownFor.delete(key);
    if (took && a.act === 'grow' && !a.again) memory.grownFor.delete(key);   // the box is learned when it reads whole
    // Review 4: a grow that fails counts toward the unsure budget, so a window tmux will not resize stops costing reads.
    if (!took && a.act === 'grow' && a.name) countUnsure(a.name);
    if (took) memory.failedUntil.delete(key);
    else memory.failedUntil.set(key, now + RETRY_AFTER_MS);
    if (typeof log === 'function' && (took || !until)) {
      log(`[permgrow] ${a.act}${a.again ? ' again' : ''} ${a.session}:${a.window} ${a.act === 'grow' ? `to ${a.rows} rows` : `to ${a.size.w}x${a.size.h}`} ${took ? 'done' : 'failed'}\n`);
    }
    done.push({ ...a, took });
  }
  return done;
}

module.exports = { GROWN_OPT, MAX_ROWS, FIT_MARGIN, DEFAULT_SIZE, RETRY_AFTER_MS, UNSURE_READS, LIST_ARGS, parseWindows, oneRowPerWindow, markOf, windowOf, worldTag,
  hiddenRows, plan, run, permissionWaits, newMemory, sweepOnce };
