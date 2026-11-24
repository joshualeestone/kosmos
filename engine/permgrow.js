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
const FIELDS = ['#{session_name}', '#{window_index}', '#{window_panes}', '#{session_attached}', '#{session_group_attached}',
  '#{window_width}', '#{window_height}', `#{${GROWN_OPT}}`];
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
    const [session, win, panes, attached, groupAttached, w, h, mark] = c;
    if (!session || !/^\d+$/.test(win)) continue;
    rows.push({
      session,
      window: win,
      panes: Number(panes),
      attached: Math.max(Number(attached) || 0, Number(groupAttached) || 0),
      size: sizeOf(`${w}x${h}`),
      mark: mark ? markOf(mark) : null,
      markRaw: mark || '',
    });
  }
  return rows;
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
function plan({ cards, windows, waiting, skip, screenOf, busy, world }) {
  const acts = [];
  const judged = [];
  const unsure = [];
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
    const restore = { act: 'restore', session: w.session, window: w.window, size };
    if (card && isBusy(card)) continue;   // a press is reading this screen: leave it for the next tick
    if (!w.mark.size || w.attached > 0 || !card) { acts.push(restore); continue; }
    const text = read(card);
    if (text == null) continue;   // could not read it: keep the size, ask again next tick
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
    if (hidden && rows <= MAX_ROWS) acts.push({ act: 'grow', session: w.session, window: w.window, size, rows, again: true });
  }
  for (const card of list) {
    if (!card || card.isNamedOurs !== true || card.reachedByChannel === true) continue;
    if (String(card.runner || 'claude') !== 'claude') continue;
    const name = card.sessionName;
    if (!waiting || !waiting.has(name) || (skip && skip.has(name))) continue;
    const at = windowOf(card);
    const w = at && (windows || []).find((x) => x.session === at.session && x.window === at.window);
    if (!w || w.markRaw || w.attached > 0 || w.panes !== 1 || !w.size || isBusy(card)) continue;
    const text = read(card);
    if (text == null) continue;
    /* Only a FINAL verdict is judged (not read again under this report): a whole box, or one taller than MAX_ROWS.
       Review 2: no prompt on screen yet (the hook reports before the box is drawn) or a cut box with no hint yet is
       `unsure`, read again next tick; the caller caps those re-reads. */
    if (!status.claudePermissionPrompt(text)) { unsure.push(name); continue; }
    if (chat.permissionAnswerable(text)) { judged.push(name); continue; }
    const hidden = hiddenRows(text);
    if (!hidden) { unsure.push(name); continue; }
    const rows = w.size.h + hidden + FIT_MARGIN;
    if (rows > MAX_ROWS) { judged.push(name); continue; }
    acts.push({ act: 'grow', session: w.session, window: w.window, size: w.size, rows });
  }
  return { acts, judged, unsure };
}

/* Runs one action through `tmux(args)` (chat's runner: { ran, status, out }). Returns true when tmux took every step. */
function run(a, tmux, world) {
  const t = `=${a.session}:${a.window}`;
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
function newMemory() { return { judged: new Map(), unsure: new Map(), failedUntil: new Map(), reports: new Map() }; }

/* One tick. `roster()` returns the board's roster (called at most once, and only on a tick that could act); `tmux`,
   `screenOf`, `busy` default to chat's; `waits()` to permissionWaits; `world` to this board's. `restoreOnly` (the
   operator brake) puts grown windows back and grows none. */
function sweepOnce({ roster, tmux = chat.tmuxCall, screenOf, busy = chat.paneKeysBusy, waits = permissionWaits,
  world = require('./launchidentity').currentWorldId(), memory = newMemory(), now = Date.now(), restoreOnly = false, log } = {}) {
  const listed = tmux(LIST_ARGS);
  if (!listed || !listed.ran || listed.status !== 0) return [];
  const windows = parseWindows(listed.out);
  const ours = windows.some((w) => w.mark && w.mark.world === world);
  const byKey = restoreOnly ? new Map() : waits(memory.reports);
  for (const k of memory.judged.keys()) if (byKey.get(k) !== memory.judged.get(k)) memory.judged.delete(k);
  for (const [k, u] of memory.unsure) if (byKey.get(k) !== u.at) memory.unsure.delete(k);
  const fresh = [...byKey.keys()].some((k) => !memory.judged.has(k));
  if (!ours && !fresh) return [];
  const cards = typeof roster === 'function' ? roster() : roster;
  if (!Array.isArray(cards)) return [];
  const waiting = new Map();
  const skip = new Set();
  for (const c of cards) {
    const k = c && keyOf(c.sessionName);
    if (k == null || !byKey.has(k)) continue;
    waiting.set(c.sessionName, k);
    if (memory.judged.has(k)) skip.add(c.sessionName);
  }
  const read = screenOf || ((card) => chat.viewport(card.sessionName, cards).text);
  const { acts, judged, unsure } = plan({ cards, windows, waiting, skip, screenOf: read, busy, world });
  for (const name of judged) { const k = waiting.get(name); if (k != null) { memory.judged.set(k, byKey.get(k)); memory.unsure.delete(k); } }
  /* An unsure screen is read again, UNSURE_READS times per report: a stale report whose agent shows no prompt costs a
     few reads, not one every tick for as long as the report stands. */
  for (const name of unsure) {
    const k = waiting.get(name);
    if (k == null) continue;
    const u = memory.unsure.get(k) || { at: byKey.get(k), reads: 0 };
    u.reads += 1;
    if (u.reads >= UNSURE_READS) { memory.judged.set(k, byKey.get(k)); memory.unsure.delete(k); } else memory.unsure.set(k, u);
  }
  const done = [];
  for (const a of acts) {
    const key = `${a.session}\u0000${a.window}`;
    const until = memory.failedUntil.get(key);
    if (until && now < until) continue;
    const took = run(a, tmux, world);
    if (took) memory.failedUntil.delete(key);
    else memory.failedUntil.set(key, now + RETRY_AFTER_MS);
    if (typeof log === 'function' && (took || !until)) {
      log(`[permgrow] ${a.act}${a.again ? ' again' : ''} ${a.session}:${a.window} ${a.act === 'grow' ? `to ${a.rows} rows` : `to ${a.size.w}x${a.size.h}`} ${took ? 'done' : 'failed'}\n`);
    }
    done.push({ ...a, took });
  }
  return done;
}

module.exports = { GROWN_OPT, MAX_ROWS, FIT_MARGIN, DEFAULT_SIZE, RETRY_AFTER_MS, UNSURE_READS, LIST_ARGS, parseWindows, markOf, windowOf,
  hiddenRows, plan, run, permissionWaits, newMemory, sweepOnce };
