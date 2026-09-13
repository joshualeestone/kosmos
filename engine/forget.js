'use strict';

/**
 * Delete your history: the record of what your agents have SAID and REPORTED.
 *
 * 🛑 THIS IS THE ONE CONTROL IN KOSMOS THAT TAKES SOMETHING AWAY WITH NO UNDO,
 * so the scope is named exhaustively here and nowhere else, and the screen
 * reads it from this module rather than describing it in its own words. Two
 * kinds, both entirely ours, plus one derived view deleted WITH its kind:
 *
 *   chats/        every conversation -- the direct threads and the project rooms
 *   chats-daily/  the human-readable daily rollup engine/dailylog.js compiles
 *                 FROM chats/ (#2924). A derived copy of chats content, so it is
 *                 deleted together with chats/ (or a plaintext residue would
 *                 survive the forget) but NOT counted on the screen -- it is a
 *                 cache of history already counted as "conversations", not a
 *                 separate thing a person has.
 *   commitments/  what each agent last reported it was holding
 *
 * ⚠️ AND THE LIST OF THINGS IT DOES NOT TOUCH IS THE LOAD-BEARING HALF, because
 * a person deleting "history" cannot be expected to guess where the line is:
 *
 *   projects.json          projects, their members, and their tasks
 *   profiles/ avatars/     who an agent IS, which is not something it has done
 *   the worker folders     instructions, and the files agents made
 *   ~/.claude/projects/    the TRANSCRIPTS, which are Claude Code's and are
 *                          shared across accounts. Deleting those is the exact
 *                          amnesia the account move refuses to cause, and it
 *                          would be Kosmos destroying another tool's data.
 *
 * 🔑 IT CAN ONLY EVER REMOVE THOSE NAMES -- the two kinds and each kind's
 * declared `derived` views. `rm -rf` on a computed path is how a delete feature
 * becomes an incident: every path is joined from the fixed `KINDS` list here
 * (kind dirs AND derived dirs), and each is re-checked to be inside the data
 * root with a matching basename immediately before the delete. Nothing else is
 * reachable from any caller. There is no argument that widens it; widening is an
 * edit to KINDS here, which the surface-pinning test makes visible in a diff.
 */

const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');
/* The derived-view dir name comes from the module that OWNS it, so the two
   cannot drift: if dailylog renames its output dir, forget's cleanup follows. */
const { CHATS_DAILY_DIRNAME } = require('./dailylog');

// #1856: route through the one data-root derivation (store.ROOT = dataRootFor), not the raw
// AGENT_WORKFORCE_DATA switch -- prod-inert when it is unset (byte-identical), and under a
// multi-Kosmos switcher (#1704) it inherits the Kosmos leaf + #1820's isAbsolute guard.
const BASE = store.ROOT;

/* The whole surface. Adding a name here is the only way to widen this. */
/* ⚠️ BOTH FORMS, because the screen counts them. "1 reports" shipped on the
   one dialog a person reads before an irreversible act -- found by rendering
   it, not by reading it, since the plural is only wrong at exactly one count.
   📌 The words live HERE rather than on the screen for the reason the module
   header gives: a control with no undo must not describe its own scope in its
   own words. That applies to the grammar too. */
/* `derived` names dirs that are a COMPUTED VIEW of a kind's content, deleted
   WITH it but NOT counted or shown on the screen: they are not separate things a
   person has, they are a cache of a thing already counted, so a "N daily logs"
   line beside "N conversations" would double-count the same history. `chats-daily`
   is the human-readable rollup engine/dailylog.js compiles from `chats/` (#2924);
   forgetting conversations must take their compiled copy too, or a plaintext
   residue survives the forget. Each entry carries its own basename so the
   pre-delete guard checks it exactly as it checks a kind's own dir. */
const KINDS = [
  {
    key: 'chats',
    dir: () => path.join(store.ROOT, 'chats'),
    label: 'conversations',
    one: 'conversation',
    derived: [{ base: CHATS_DAILY_DIRNAME, dir: () => path.join(store.ROOT, CHATS_DAILY_DIRNAME) }],
  },
  { key: 'commitments', dir: () => path.join(BASE, 'commitments'), label: 'reports', one: 'report' },
];

function countIn(dir) {
  try { return fs.readdirSync(dir).filter((f) => !f.startsWith('.')).length; }
  catch { return 0; }
}

/**
 * What is there to delete, so the screen can say it before asking.
 *
 * ⚠️ A count of ZERO is not the same as a directory we could not read, and both
 * would render as "nothing to delete" if this returned a bare number. `readable`
 * carries the difference, and the screen refuses to offer a delete it cannot
 * describe -- "this will remove nothing" over an unreadable store is the worst
 * sentence this feature could say.
 */
function summary() {
  const parts = KINDS.map((k) => {
    const dir = k.dir();
    let readable = true;
    let count = 0;
    try {
      if (fs.existsSync(dir)) count = countIn(dir);
    } catch { readable = false; }
    return { key: k.key, label: k.label, one: k.one, count, readable };
  });
  return {
    parts,
    total: parts.reduce((n, p) => n + p.count, 0),
    readable: parts.every((p) => p.readable),
  };
}

/**
 * Remove them.
 *
 * 🛑 EVERY PATH IS RE-CHECKED TO BE INSIDE THE DATA ROOT IMMEDIATELY BEFORE THE
 * DELETE, even though it was built from a constant a line earlier. The check is
 * cheap and the failure it prevents is unbounded: an env var pointing the data
 * root somewhere unexpected, a symlinked directory, a future caller passing a
 * name. A guard that is only correct because of how it is called today is not a
 * guard.
 */
function forget() {
  const root = path.resolve(BASE);
  const altRoot = path.resolve(store.ROOT);
  const gone = [];
  for (const k of KINDS) {
    const dir = path.resolve(k.dir());
    const inside = (dir.startsWith(root + path.sep) || dir.startsWith(altRoot + path.sep));
    if (!inside) {
      return { ok: false, because: 'we will not delete anything outside your Kosmos data folder' };
    }
    if (path.basename(dir) !== k.key) {
      return { ok: false, because: 'that does not look like the folder we meant to delete' };
    }
    const count = fs.existsSync(dir) ? countIn(dir) : 0;
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      return { ok: false, because: 'we could not delete all of it, so some of your history is still here' };
    }
    /* Derived views of this kind, deleted under the SAME inside-root + basename
       guards as the kind's own dir (a derived dir that is missing or not where
       we expect it is force-removed harmlessly, but a path that escapes the data
       root is refused, exactly as above). Not counted -- see the KINDS note. */
    for (const d of (k.derived || [])) {
      const ddir = path.resolve(d.dir());
      const dInside = (ddir.startsWith(root + path.sep) || ddir.startsWith(altRoot + path.sep));
      if (!dInside) {
        return { ok: false, because: 'we will not delete anything outside your Kosmos data folder' };
      }
      if (path.basename(ddir) !== d.base) {
        return { ok: false, because: 'that does not look like the folder we meant to delete' };
      }
      try {
        fs.rmSync(ddir, { recursive: true, force: true });
      } catch {
        return { ok: false, because: 'we could not delete all of it, so some of your history is still here' };
      }
    }
    gone.push({ key: k.key, label: k.label, count });
  }
  return { ok: true, gone, total: gone.reduce((n, g) => n + g.count, 0) };
}

module.exports = { summary, forget, KINDS };
