'use strict';
/**
 * #6719 (Josh, 2026-10-20): "lets add a small star functionality to the top right of these tiles so like if I starred
 * you it would basically pin you to the top".
 *
 * The person's starred agents, by session name, kept on the board (store.ROOT/agent-stars.json) so they hold across
 * restarts and on every screen that views this board, Kosmos+ remote included. A set, not an order: within the starred
 * group the board's own sort order applies.
 *
 * Never throws to a caller. A file that cannot be read reads as no stars with ok false (the board draws every star off
 * rather than guessing), and a write that fails says so.
 */
const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');

const MAX_STARS = 500;
// A session name as the board draws it: printable, no path separators, bounded. Anything else is refused, not stored.
const NAME_RE = /^[^\x00-\x1f\x7f/\\]{1,128}$/;

const file = () => path.join(store.ROOT, 'agent-stars.json');

/** { names: string[], ok }. No file is no stars; an unreadable or malformed one is no stars with ok false. */
function read() {
  let raw;
  try { raw = fs.readFileSync(file(), 'utf8'); } catch (err) { return { names: [], ok: !err || err.code === 'ENOENT' }; }
  try {
    const v = JSON.parse(raw);
    const names = Array.isArray(v && v.names) ? v.names.filter((n) => typeof n === 'string' && NAME_RE.test(n)) : null;
    return names ? { names: [...new Set(names)].slice(0, MAX_STARS), ok: true } : { names: [], ok: false };
  } catch { return { names: [], ok: false }; }
}

/**
 * Stars (on true) or unstars one agent. { names, ok } after the change, or { refused } for a name that is not one.
 * Starring an agent already starred, or unstarring one that is not, changes nothing and is not an error.
 */
function set(name, on) {
  if (typeof name !== 'string' || !NAME_RE.test(name)) return { refused: 'not an agent name' };
  if (typeof on !== 'boolean') return { refused: 'on must be true or false' };
  const now = read();
  /* A file that could not be read is not overwritten from an empty reading: that would drop every star it held. */
  if (!now.ok) return { names: [], ok: false };
  const names = now.names.filter((n) => n !== name);
  if (on) {
    if (names.length >= MAX_STARS) return { refused: 'too many starred agents' };
    names.push(name);
  }
  try {
    fs.mkdirSync(store.ROOT, { recursive: true });
    store.saveFlushed(file(), JSON.stringify({ names }));
  } catch { return { names: now.names, ok: false }; }
  return read();
}

module.exports = { read, set, file, MAX_STARS };
