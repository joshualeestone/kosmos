'use strict';

/*
 * kosmos#8952 slice (d): let a long permission request be approved from the phone or the board.
 *
 * THE PROBLEM. Agents start at tmux's default 80x24 (bin/agent-supervisor.sh passes no size). A permission prompt for a
 * long command does not fit, so Claude Code draws the bottom of the box only ("↑ 50 more lines"), its top rule and title
 * off screen. chat.permissionAnswerable is false there on purpose (#6054 review 3: a cut box could share its visible tail
 * with another command's), so slice (c) offers only its No.
 *
 * WHAT THIS DOES. While such a cut prompt is up on a Claude agent's window that nobody is watching, the window is made
 * GROW_ROWS tall. Claude Code redraws the WHOLE box at that height (measured 2026-11-24 on 2.1.331, tmux 3.6a: a 60-line
 * mkdir at 80x24 showed 15 lines; at 200 rows every line, title to question). The next read of the screen then takes the
 * ordinary whole-box path (permissionCard, the request fingerprint, the press route's re-look), unchanged. When the
 * prompt is gone the window goes back to the size it had.
 *
 * MEASURED, AND WHY EACH RULE IS HERE:
 *  - `resize-window` sets the window's `window-size` option to manual, and so does `resize-window -A`. Restoring is the
 *    recorded size first, THEN unsetting the option (unset before the resize and the resize sets it again).
 *  - A client attached to the session (a person watching in a terminal) is panned to the TOP of a window taller than
 *    itself, so it loses sight of the question. So a window with a client attached is never grown, and a grown window
 *    whose session gains a client is put back at once. That person is at the computer and can answer there.
 *  - The size is recorded in a window option (GROWN_OPT) BEFORE the resize, so a board restart or a crash between the two
 *    still finds the window to put back. Nothing else is kept in memory.
 *
 * NOT DONE: a box taller than GROW_ROWS stays cut, and slice (c)'s No stays. A window with more than one pane is left
 * alone (resizing the window would resize the other panes too; agents run one pane per session).
 */

const status = require('./status');
const chat = require('./chat');

const GROWN_OPT = '@kosmos_permgrow';
const GROW_ROWS = 200;
const FIELDS = ['#{session_name}', '#{window_index}', '#{window_panes}', '#{session_attached}', '#{window_width}', '#{window_height}', `#{${GROWN_OPT}}`];
const LIST_ARGS = ['list-windows', '-a', '-F', FIELDS.join('\t')];

function sizeOf(v) {
  const m = /^(\d{1,4})x(\d{1,4})$/.exec(String(v == null ? '' : v).trim());
  if (!m) return null;
  const w = Number(m[1]); const h = Number(m[2]);
  return w > 0 && h > 0 ? { w, h } : null;
}

/* One row per window, from LIST_ARGS's output. A row that does not parse is dropped (it names no window we can act on). */
function parseWindows(out) {
  const rows = [];
  for (const line of String(out == null ? '' : out).split('\n')) {
    if (!line) continue;
    const c = line.split('\t');
    if (c.length !== FIELDS.length) continue;
    const [session, win, panes, attached, w, h, grown] = c;
    if (!session || !/^\d+$/.test(win)) continue;
    rows.push({
      session,
      window: win,
      panes: Number(panes),
      attached: Number(attached) || 0,
      size: sizeOf(`${w}x${h}`),
      grown: grown ? sizeOf(grown) : null,
      grownRaw: grown || '',
    });
  }
  return rows;
}

/* The window a card's pane is in: card.target is "<session>:<window>.<pane>" (status.js PANE_COLUMNS). */
function windowOf(card) {
  const m = /^(.*):(\d+)\.\d+$/.exec(String((card && card.target) || ''));
  return m ? { session: m[1], window: m[2] } : null;
}

/* PURE. What to do this tick: [{ act: 'grow' | 'restore', session, window, size? }].
   `cards` is the roster; `windows` is parseWindows' rows; `screenOf(card)` returns the screen text the thread route
   would read (chat.viewport's), or null when it could not be read. */
function plan({ cards, windows, screenOf }) {
  const acts = [];
  const byKey = new Map();
  for (const w of windows || []) byKey.set(`${w.session}\u0000${w.window}`, w);
  const cardAt = new Map();
  for (const c of Array.isArray(cards) ? cards : []) {
    const at = windowOf(c);
    if (at) cardAt.set(`${at.session}\u0000${at.window}`, c);
  }
  for (const [key, w] of byKey) {
    if (!w.grownRaw) continue;
    /* A mark we cannot read back is cleared at the current size: no size to restore, and keeping it would keep this
       window out of the grow arm forever. */
    if (!w.grown) { acts.push({ act: 'restore', session: w.session, window: w.window, size: null }); continue; }
    if (w.attached > 0) { acts.push({ act: 'restore', session: w.session, window: w.window, size: w.grown }); continue; }
    const card = cardAt.get(key);
    let text = null;
    if (card) { try { text = screenOf(card); } catch { text = null; } }
    if (card && text == null) continue;   // could not read it: keep the size, ask again next tick
    if (!card || !status.claudePermissionPrompt(text)) acts.push({ act: 'restore', session: w.session, window: w.window, size: w.grown });
  }
  for (const card of Array.isArray(cards) ? cards : []) {
    if (!card || card.isNamedOurs !== true || card.reachedByChannel === true) continue;
    if (String(card.runner || 'claude') !== 'claude') continue;
    if (card.state !== status.STATE.NEEDS_YOU) continue;
    const at = windowOf(card);
    const w = at && byKey.get(`${at.session}\u0000${at.window}`);
    if (!w || w.grownRaw || w.attached > 0 || w.panes !== 1 || !w.size || w.size.h >= GROW_ROWS) continue;
    let text = null;
    try { text = screenOf(card); } catch { text = null; }
    if (text == null || !status.claudePermissionPrompt(text) || chat.permissionAnswerable(text)) continue;
    acts.push({ act: 'grow', session: w.session, window: w.window, size: w.size });
  }
  return acts;
}

/* Runs one action through `tmux(args)` (chat's runner: { ran, status, out }). Returns true when tmux took every step. */
function run(a, tmux) {
  const t = `=${a.session}:${a.window}`;
  const ok = (r) => Boolean(r && r.ran && r.status === 0);
  if (a.act === 'grow') {
    if (!ok(tmux(['set-option', '-w', '-t', t, GROWN_OPT, `${a.size.w}x${a.size.h}`]))) return false;
    if (ok(tmux(['resize-window', '-t', t, '-y', String(GROW_ROWS)]))) return true;
    tmux(['set-option', '-w', '-t', t, '-u', 'window-size']);
    tmux(['set-option', '-w', '-t', t, '-u', GROWN_OPT]);
    return false;
  }
  let fine = true;
  if (a.size) fine = ok(tmux(['resize-window', '-t', t, '-x', String(a.size.w), '-y', String(a.size.h)]));
  // After the resize: resize-window sets window-size to manual, and unsetting it hands the size back to tmux's rule.
  fine = ok(tmux(['set-option', '-w', '-t', t, '-u', 'window-size'])) && fine;
  if (fine) fine = ok(tmux(['set-option', '-w', '-t', t, '-u', GROWN_OPT]));
  return fine;
}

/* Does any agent's own hook report a permission wait right now (selfreport's by:'auto' needs_you, what the phone's
   notice keys on)? A cheap file read per agent, so the board's whole roster (a screen capture per agent) is built only
   on a tick that could act. A report that cannot be read counts as asking: the roster then decides. */
function anyPermissionWait() {
  const selfreport = require('./selfreport');
  let names;
  try { names = require('node:fs').readdirSync(selfreport.DIR); } catch (e) { return !(e && e.code === 'ENOENT'); }
  for (const f of names) {
    if (!f.endsWith('.jsonl')) continue;
    try { if (selfreport.isAutoPermissionWait(selfreport.read(f.slice(0, -'.jsonl'.length)))) return true; } catch { return true; }
  }
  return false;
}

/* One tick: list the windows, and only when a window is grown or an agent reports a permission wait, read the roster,
   plan and act. `roster` is the board's roster or a function returning it (called at most once); `tmux` and `screenOf`
   default to chat's; `asking` defaults to anyPermissionWait. */
function sweepOnce({ roster, tmux = chat.tmuxCall, screenOf, log, asking = anyPermissionWait } = {}) {
  const listed = tmux(LIST_ARGS);
  if (!listed || !listed.ran || listed.status !== 0) return [];
  const windows = parseWindows(listed.out);
  if (!windows.some((w) => w.grownRaw) && !asking()) return [];
  const cards = typeof roster === 'function' ? roster() : roster;
  if (!Array.isArray(cards)) return [];
  const read = screenOf || ((card) => chat.viewport(card.sessionName, cards).text);
  const acts = plan({ cards, windows, screenOf: read });
  for (const a of acts) {
    const done = run(a, tmux);
    if (typeof log === 'function') log(`[permgrow] ${a.act} ${a.session}:${a.window}${a.size ? ` ${a.size.w}x${a.size.h}` : ''} ${done ? 'done' : 'failed'}\n`);
  }
  return acts;
}

module.exports = { GROWN_OPT, GROW_ROWS, LIST_ARGS, parseWindows, windowOf, plan, run, anyPermissionWait, sweepOnce };
