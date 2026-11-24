'use strict';

/*
 * kosmos#8952 slice (d): let a long permission request be approved from the board or the phone's conversation page.
 *
 * THE PROBLEM. Agents start at tmux's default 80x24 (bin/agent-supervisor.sh passes no size). A permission prompt for a
 * long command does not fit, so Claude Code draws the bottom of the box only, ending in its own hint "↑ 50 more lines",
 * the top rule and title off screen. chat.permissionAnswerable refuses such a box (#6054 review 3: a cut box could share
 * its visible tail with another command's), so slice (c) offers only its No.
 *
 * WHAT THIS DOES. While such a cut prompt is up on a Claude agent's window that nobody is viewing, the window is made
 * taller by exactly the hidden rows (plus FIT_MARGIN), up to MAX_ROWS. Claude Code redraws the WHOLE box at that height,
 * and the next read of the screen takes the ordinary whole-box path (permissionCard, the request fingerprint, the press
 * route's re-look), unchanged. When the prompt is gone the window goes back to the size it had.
 *
 * MEASURED, on Claude Code 2.1.331 and tmux 3.6a only (2026-11-24; card #8952 comment 7131048790 and the plan file):
 *  - At 80x24 a 60-line mkdir shows 15 lines and "↑ 50 more lines". At 24 + 50 + 2 rows every line draws, title to
 *    question; FIT_MARGIN is 4 so two spare rows absorb a footer or tip line one row taller than the one measured. Extra
 *    rows go to the conversation above the box, not under it.
 *  - A flat 200 rows left 26 blank rows under the box, and status.classify (which reads the last 25 rows) said unknown
 *    instead of needs_you. So the window grows by the hint, never by a guess, and with no hint it is not grown.
 *  - `resize-window` (and `-A`) sets the window's `window-size` option to manual. Restoring is the recorded size first,
 *    THEN unsetting the option (unset first and the resize sets it again).
 *  - A client viewing the window (a person in a terminal) is panned to the TOP of a window taller than itself and loses
 *    sight of the question. So a viewed window is never grown, and a grown one that gains a viewer goes back at once.
 *    Viewing is #{session_attached}, #{session_group_attached} or #{window_active_clients} (a client on a grouped or a
 *    linking session). Not #{window_linked}: every window in a session group reads 1.
 *  - Shrinking while the box is still up leaves it cut again; 2.1.331 clears the scrollback on resize. The hint check in
 *    chat.permissionAnswerable is what keeps a stale top in scrollback from passing on a version that does not.
 *
 * THE MARK. Before resizing, the window gets the option GROWN_OPT = "<W>x<H>@<world>": the size to go back to, and the
 * board (world) that grew it. A board acts only on its own marks, so two boards on one tmux server never undo each
 * other, and a restart or a crash between mark and resize still finds the window to put back.
 *
 * MEMORY, kept by the caller between ticks (newMemory):
 *   by agent (the store key of its session name, store.safeKey):
 *     settled   key -> report time. Nothing more to do for that report: its box read whole, or growing cannot help, or
 *               the agent is not one this sweep grows. Read again only when a new report comes.
 *     unsure    key -> { at, reads }. Looked at but no box with its hint yet (the hook can report before the box is
 *               drawn), or not on the (20 s old) roster yet. Settled after UNSURE_READS reads AND UNSURE_MS.
 *     watching  key -> window id. Its window has a viewer: no roster read while it still has one.
 *   by window id (#{window_id}, one window even when a session group lists it twice):
 *     grown     id -> { at, req, hidden, misses, stuck, unread }, for a window carrying our mark:
 *                 at      the report it was grown for (null when not known: grown before a board restart)
 *                 req     the request id of its box, learned the first time it reads whole
 *                 hidden  the hint at the last grow, while the box has not yet read whole
 *                 misses  consecutive reads with no prompt on screen (MISSES puts it back)
 *                 stuck   consecutive grown reads of the same box whose hint did not shrink (STUCK puts it back)
 *                 unread  consecutive unreadable reads (UNREADABLE_TICKS puts it back)
 *               Deleted when the window is put back or no longer exists.
 *     failedUntil id -> time. A tmux step failed: left alone until then, logged once.
 *   by report file: reports, the cache permissionWaits keeps (file stamp -> reading).
 *
 * NOT DONE: a box taller than MAX_ROWS stays cut and slice (c)'s No stays. A window with more than one pane is left alone.
 * The lock-screen notice is unchanged: it offers buttons only for a one-line command (server.js phonePermissionNow).
 * A board that stops leaves its grown windows tall until it runs again.
 */

const status = require('./status');
const chat = require('./chat');

const GROWN_OPT = '@kosmos_permgrow';
const MAX_ROWS = 200;
const FIT_MARGIN = 4;
const DEFAULT_SIZE = { w: 80, h: 24 };   // tmux's default-size, what an agent starts at: the restore for a mark with no size
const RETRY_AFTER_MS = 60 * 1000;
const UNSURE_READS = 3;
const UNSURE_MS = 30 * 1000;
const UNREADABLE_TICKS = 3;
const MISSES = 2;
const STUCK = 2;
const FIELDS = ['#{window_id}', '#{session_name}', '#{window_index}', '#{window_panes}', '#{session_attached}',
  '#{session_group_attached}', '#{window_active_clients}', '#{window_width}', '#{window_height}', `#{${GROWN_OPT}}`];
const LIST_ARGS = ['list-windows', '-a', '-F', FIELDS.join('\t')];
// Claude Code's "↑ N more lines": the same shape as status.CLAUDE_SCROLL_HINT, the "↑" form only, with N captured.
const HIDDEN_ABOVE = /^\s*↑\s*(\d{1,4})\s+more\s+lines?\s*$/;

function sizeOf(v) {
  const m = /^(\d{1,4})x(\d{1,4})$/.exec(String(v == null ? '' : v).trim());
  if (!m) return null;
  const w = Number(m[1]); const h = Number(m[2]);
  return w > 0 && h > 0 ? { w, h } : null;
}

/* A mark is "<W>x<H>@<world>": { world, size } (size null when it does not read); null with no "@<world>". */
function markOf(v) {
  const m = /^(.*)@([A-Za-z0-9_-]+)$/.exec(String(v == null ? '' : v).trim());
  return m ? { world: m[2], size: sizeOf(m[1]) } : null;
}

/* One row per listed window (a grouped window once per session), from LIST_ARGS's output. A row that does not parse is
   dropped: it names no window that can be acted on. */
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
      attached: Math.max(Number(attached) || 0, Number(groupAttached) || 0, Number(viewing) || 0),
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

/* One row per window id: the row a card names when there is one, with the most viewers of any of its rows. */
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

/* The rows Claude Code says it left out above a box, read only in the last few rows (where it draws the hint, under the
   options). null when there is none. */
function hiddenRows(text) {
  const tail = String(text == null ? '' : text).replace(/\s+$/, '').split('\n').slice(-6);
  for (const l of tail) {
    const m = HIDDEN_ABOVE.exec(l);
    if (m) return Number(m[1]);
  }
  return null;
}

/* Is this a card this sweep may grow at all (ours, on a window, a Claude agent)? */
function growable(card) {
  return Boolean(card) && card.isNamedOurs === true && card.reachedByChannel !== true && String(card.runner || 'claude') === 'claude';
}

const blankGrown = () => ({ at: null, req: null, hidden: null, misses: 0, stuck: 0, unread: 0 });

/* PURE. One tick's decisions.
   In: cards (the roster), windows (oneRowPerWindow's rows), waiting (Map session name -> store key, the agents whose own
   hook reports a permission wait), skip (names settled under their current report), reportOf(name) (its report time, or
   null), screenOf(card) (the screen the thread route reads; null when unreadable), busy(card) (a press or delivery under
   way on its pane), world, grown (memory.grown), restoreOnly (the brake).
   Out: { acts, settle, unsure, watching, grownNext }:
     acts       [{ act: 'grow' | 'restore', id, session, window, size, rows?, again?, hidden?, name? }]
     settle     names to settle under their current report; unsure: names to count a read against
     watching   [[name, window id]]
     grownNext  [[window id, entry]]: the new `grown` entries for windows kept this tick */
function plan({ cards, windows, waiting = new Map(), skip = new Set(), reportOf = () => null, screenOf, busy, world,
  grown = new Map(), restoreOnly = false }) {
  const acts = [];
  const settle = [];
  const unsure = [];
  const watching = [];
  const grownNext = [];
  const list = Array.isArray(cards) ? cards : [];
  const cardAt = new Map();
  for (const c of list) { const at = windowOf(c); if (at) cardAt.set(`${at.session}\u0000${at.window}`, c); }
  const read = (card) => { try { return screenOf(card); } catch { return null; } };
  const isBusy = (card) => { try { return Boolean(busy && busy(card)); } catch { return true; } };
  const sameReport = (g, name) => g.at != null && g.at === reportOf(name);
  const settleOrLook = (g, name) => { if (waiting.has(name)) (sameReport(g, name) ? settle : unsure).push(name); };

  // 1. Windows carrying OUR mark: keep, grow again, or put back.
  for (const w of windows || []) {
    if (!w.mark || w.mark.world !== world) continue;   // not ours: another board's, or nothing this code wrote
    const card = cardAt.get(`${w.session}\u0000${w.window}`);
    const restore = { act: 'restore', id: w.id, session: w.session, window: w.window, size: w.mark.size || DEFAULT_SIZE };
    if (card && isBusy(card)) continue;   // a press is reading this screen: leave it for the next tick
    if (restoreOnly || !w.mark.size || w.attached > 0 || !growable(card)) { acts.push(restore); continue; }
    const g = { ...blankGrown(), ...(grown.get(w.id) || {}) };
    const name = card.sessionName;
    const text = read(card);
    if (text == null) {   // kept through a few unreadable ticks, then put back: never tall for good on a screen nobody reads
      if (g.unread + 1 >= UNREADABLE_TICKS) acts.push(restore); else grownNext.push([w.id, { ...g, unread: g.unread + 1 }]);
      continue;
    }
    g.unread = 0;
    if (!status.claudePermissionPrompt(text)) {
      /* No prompt: answered, or a redraw caught mid-way. MISSES reads in a row put it back. Settled only under the report
         it was grown for (no grow and shrink loop); a newer report is the next prompt, whose box may not be drawn yet. */
      if (g.misses + 1 < MISSES) { grownNext.push([w.id, { ...g, misses: g.misses + 1 }]); continue; }
      acts.push(restore);
      settleOrLook(g, name);
      continue;
    }
    g.misses = 0;
    if (chat.permissionAnswerable(text)) {
      /* Whole. Kept for THIS box, known by its request id the first time it reads whole. Another box (a new prompt, such
         as a short one after the long one) puts it back, so a short box is not drawn at the top of a tall window over
         blank rows the status reader cannot read; section 2 grows it again next tick if it needs it. A report changing
         under the same box changes nothing. */
      const box = chat.permissionCard(text);
      const req = box ? chat.permissionRequestId(box) : null;
      if (req && g.req && g.req !== req) { acts.push(restore); continue; }
      grownNext.push([w.id, { ...g, req: g.req || req, hidden: null, stuck: 0 }]);
      continue;
    }
    // Still cut at the grown height: the box grown for, not yet drawn whole, or a longer next box.
    const hidden = hiddenRows(text);
    const rows = hidden && w.size ? w.size.h + hidden + FIT_MARGIN : 0;
    const sameBox = sameReport(g, name) && !g.req;
    const notShrinking = sameBox && g.hidden != null && hidden != null && hidden >= g.hidden;
    if (!hidden || rows > MAX_ROWS || (notShrinking && g.stuck + 1 >= STUCK)) {
      // Growing cannot help (no hint, no room, or Claude Code keeps it cut): put back; settle this report.
      acts.push(restore);
      if (waiting.has(name)) settle.push(name);
      continue;
    }
    if (notShrinking) { grownNext.push([w.id, { ...g, stuck: g.stuck + 1 }]); continue; }
    acts.push({ act: 'grow', id: w.id, session: w.session, window: w.window, size: w.mark.size, rows, again: true, hidden, name });
  }

  // 2. Waiting agents with no mark on their window: grow a cut box, or say why not.
  for (const card of list) {
    if (!card) continue;
    const name = card.sessionName;
    if (!waiting.has(name) || skip.has(name)) continue;
    if (!growable(card)) { settle.push(name); continue; }
    const at = windowOf(card);
    const w = at && (windows || []).find((x) => x.session === at.session && x.window === at.window);
    if (!w) { unsure.push(name); continue; }
    if (w.markRaw) { if (!(w.mark && w.mark.world === world)) settle.push(name); continue; }   // ours: section 1; another board's: settled
    if (w.panes !== 1 || !w.size) { settle.push(name); continue; }
    if (w.attached > 0) { watching.push([name, w.id]); continue; }   // a moment, not evidence: no read budget spent
    if (isBusy(card)) continue;
    const text = read(card);
    if (text == null || !status.claudePermissionPrompt(text)) { unsure.push(name); continue; }
    if (chat.permissionAnswerable(text)) { settle.push(name); continue; }
    const hidden = hiddenRows(text);
    if (!hidden) { unsure.push(name); continue; }
    const rows = w.size.h + hidden + FIT_MARGIN;
    if (rows > MAX_ROWS) { settle.push(name); continue; }
    acts.push({ act: 'grow', id: w.id, session: w.session, window: w.window, size: w.size, rows, hidden, name });
  }
  return { acts, settle, unsure, watching, grownNext };
}

/* Runs one action through `tmux(args)` (chat's runner: { ran, status, out }). Returns true when tmux took every step. */
function run(a, tmux, world) {
  const t = a.id || `=${a.session}:${a.window}`;   // the window id: one window whatever session group lists it
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

/* Which agents' own hooks report a permission wait now (selfreport's by:'auto' needs_you, what the phone's notice keys
   on): Map of store key -> report time. A report is re-read only when its file changed (`cache`, by size and mtime), so a
   tick is a directory listing and a stat per agent. */
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
   one agent's report can make the other look waiting: the cost is a screen read, never an action, since a grow needs
   that agent's own screen to show a cut box. */
function keyOf(name) {
  try { return require('./store').safeKey(name); } catch { return null; }
}

function newMemory() {
  return { settled: new Map(), unsure: new Map(), watching: new Map(), grown: new Map(), failedUntil: new Map(), reports: new Map() };
}

/* One tick. `roster()` returns the board's roster (called at most once, and only on a tick that could act); `tmux`,
   `screenOf`, `busy` default to chat's; `waits(cache)` to permissionWaits; `world` to this board's. `restoreOnly` (the
   operator brake) puts every grown window back and grows none. Returns the actions taken, each with `took`. */
function sweepOnce({ roster, tmux = chat.tmuxCall, screenOf, busy = chat.paneKeysBusy, waits = permissionWaits,
  world = require('./launchidentity').currentWorldId(), memory = newMemory(), now = Date.now(), restoreOnly = false, log } = {}) {
  world = require('./launchidentity').worldIdForHeader(world);   // only characters a mark reads back
  const listed = tmux(LIST_ARGS);
  if (!listed || !listed.ran || listed.status !== 0) return [];
  const rows = parseWindows(listed.out);
  const ours = rows.some((w) => w.mark && w.mark.world === world);
  const byKey = restoreOnly ? new Map() : waits(memory.reports);

  // Forget what a new report (or none) has made stale.
  for (const [k, at] of memory.settled) if (byKey.get(k) !== at) memory.settled.delete(k);
  for (const [k, u] of memory.unsure) if (byKey.get(k) !== u.at) memory.unsure.delete(k);
  const viewed = new Set(rows.filter((r) => r.attached > 0).map((r) => r.id));
  for (const [k, id] of memory.watching) if (!byKey.has(k) || !viewed.has(id)) memory.watching.delete(k);

  // Only a tick that could act reads the roster: a window of ours, or a report neither settled nor being watched.
  const fresh = [...byKey.keys()].some((k) => !memory.settled.has(k) && !memory.watching.has(k));
  if (!ours && !fresh) return [];
  const cards = typeof roster === 'function' ? roster() : roster;
  if (!Array.isArray(cards)) return [];

  const countUnsure = (k) => {
    const u = memory.unsure.get(k) || { at: byKey.get(k), reads: 0 };
    u.reads += 1;
    const since = Date.parse(byKey.get(k) || '');
    const old = !Number.isFinite(since) || now - since >= UNSURE_MS;
    if (u.reads >= UNSURE_READS && old) { memory.settled.set(k, byKey.get(k)); memory.unsure.delete(k); } else memory.unsure.set(k, u);
  };
  const waiting = new Map();
  const skip = new Set();
  const onRoster = new Set();
  for (const c of cards) {
    const k = c && keyOf(c.sessionName);
    if (k == null) continue;
    onRoster.add(k);
    if (!byKey.has(k)) continue;
    waiting.set(c.sessionName, k);
    if (memory.settled.has(k)) skip.add(c.sessionName);
  }
  // A report with no agent on the roster: a removed agent's last line, or an agent newer than the (20 s old) roster.
  for (const k of byKey.keys()) if (!onRoster.has(k) && !memory.settled.has(k)) countUnsure(k);

  const windows = oneRowPerWindow(rows, cards);
  const ids = new Set(windows.map((w) => w.id));
  for (const k of memory.failedUntil.keys()) if (!ids.has(k)) memory.failedUntil.delete(k);
  for (const k of memory.grown.keys()) if (!ids.has(k)) memory.grown.delete(k);
  const reportOf = (name) => { const k = keyOf(name); return k != null && byKey.has(k) ? byKey.get(k) : null; };
  const read = screenOf || ((card) => chat.viewport(card.sessionName, cards).text);
  const out = plan({ cards, windows, waiting, skip, reportOf, screenOf: read, busy, world, grown: memory.grown, restoreOnly });

  for (const [id, entry] of out.grownNext) memory.grown.set(id, entry);
  for (const [name, id] of out.watching) memory.watching.set(waiting.get(name), id);
  for (const name of out.settle) { const k = waiting.get(name); if (k != null) { memory.settled.set(k, byKey.get(k)); memory.unsure.delete(k); } }
  for (const name of out.unsure) { const k = waiting.get(name); if (k != null) countUnsure(k); }

  const done = [];
  for (const a of out.acts) {
    const until = memory.failedUntil.get(a.id);
    if (until && now < until) continue;
    const took = run(a, tmux, world);
    if (took && a.act === 'restore') memory.grown.delete(a.id);
    if (took && a.act === 'grow') memory.grown.set(a.id, { ...blankGrown(), at: reportOf(a.name), hidden: a.hidden });
    if (!took && a.act === 'grow' && waiting.has(a.name)) countUnsure(waiting.get(a.name));   // a window tmux will not resize
    if (took) memory.failedUntil.delete(a.id); else memory.failedUntil.set(a.id, now + RETRY_AFTER_MS);
    if (typeof log === 'function' && (took || !until)) {
      log(`[permgrow] ${a.act}${a.again ? ' again' : ''} ${a.session}:${a.window} ${a.act === 'grow' ? `to ${a.rows} rows` : `to ${a.size.w}x${a.size.h}`} ${took ? 'done' : 'failed'}\n`);
    }
    done.push({ ...a, took });
  }
  return done;
}

module.exports = { GROWN_OPT, MAX_ROWS, FIT_MARGIN, DEFAULT_SIZE, RETRY_AFTER_MS, UNSURE_READS, UNSURE_MS, UNREADABLE_TICKS, MISSES, STUCK,
  LIST_ARGS, parseWindows, oneRowPerWindow, markOf, windowOf, hiddenRows, plan, run, permissionWaits, newMemory, sweepOnce };
