'use strict';

/**
 * Whether Kosmos installs a new version by itself.
 *
 * 🔑 THIS SWITCH REPLACED ONE THAT DID NOTHING. The row used to read "Tell me
 * when there is a new version", with a hint underneath admitting "Kosmos always
 * tells you. Turning that off is not built yet" -- a control that could not
 * move, next to a sentence explaining that it could not move. Josh, 2026-08-22:
 * "the switch should be on the updates to be automatically update Kosmos ..
 * right now the switch makes no sense". A switch is a promise that something
 * changes when you flip it, and that one was decoration.
 *
 * ⚠️ THE TWO FAILURE DIRECTIONS ARE DELIBERATELY DIFFERENT, which is why this
 * does not simply copy engmode.js's read():
 *
 *   file absent  -> ON.  Nobody has chosen; this is the shipped default, and a
 *                        beta everybody is meant to be current on should stay
 *                        current without being asked every time.
 *   file corrupt -> OFF. Somebody DID choose and we cannot read which way. The
 *                        only irreversible-feeling action here is installing
 *                        software, so an unreadable choice must not be read as
 *                        consent to install. (engmode fails toward its default
 *                        in both cases because both of its directions are
 *                        merely showing or hiding a panel.)
 *
 * `ok:false` travels with the OFF so the screen can say we could not read it,
 * rather than silently presenting a switch in a position nobody set.
 */

const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');

/* 🛑 RESOLVED PER CALL, NOT CAPTURED AT REQUIRE TIME (#1443). `store.ROOT` is a
   GETTER that re-resolves, which #1512 made true, and capturing it into a
   module-level const evaluates it ONCE and throws that away. Measured before this
   change: with the module required under the operator's real root and the seam
   set afterwards, `store.ROOT` followed the seam and `autoupdate.FILE` did not.

   That is the whole hazard in the card: a test installs its sandbox after
   requiring the module, and the module reads and writes the operator's REAL data.
   It does not fail, it passes, and the damage lands outside the run. */
const base = () => process.env.AGENT_WORKFORCE_DATA || store.ROOT;
const file = () => path.join(base(), 'autoupdate.json');

const DEFAULTS = { on: true };

function read() {
  let raw;
  try { raw = fs.readFileSync(file(), 'utf8'); } catch (err) {
    if (err && err.code === 'ENOENT') return { ...DEFAULTS, ok: true };
    // Present but unreadable (permissions, a bad mount): a choice exists and
    // we cannot see it. Fail toward not installing.
    return { on: false, ok: false };
  }
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return { on: false, ok: false }; }
  if (!parsed || typeof parsed !== 'object' || typeof parsed.on !== 'boolean') {
    return { on: false, ok: false };
  }
  return { on: parsed.on, ok: true };
}

function write({ on }) {
  if (typeof on !== 'boolean') {
    return { ok: false, because: 'the switch must be on or off' };
  }
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    // Same single-process tmp-rename shape as engmode.js and limits.js.
    const tmp = file() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ on }) + '\n');
    fs.renameSync(tmp, file());
    return { ok: true };
  } catch {
    return { ok: false, because: 'we could not save that setting' };
  }
}

/* `FILE` stays a property rather than becoming `file()`, so every consumer keeps
   working unchanged; it is a getter now, so it answers per read instead of
   holding the require-time value. Same shape as `store.ROOT` itself. */
module.exports = { get FILE() { return file(); }, DEFAULTS, read, write };
