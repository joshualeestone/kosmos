'use strict';
/**
 * First-run help and first-visit tips (#3574, Josh 2026-09-24): which tips a
 * person has already closed, and whether they turned tips off.
 *
 * Kept on the board, like the layout preference, not in the page's storage:
 * page storage can come back empty (a private window, cleared site data), and
 * then every tip would show again to somebody who already closed them.
 *
 * A read that fails answers ok:false, and the page then shows no tips while it
 * cannot read them (showing a closed tip again is worse than missing one). The
 * page tries the read again, 5s then doubling to a minute, and a save that
 * answers mends it too. A file that will not parse stays unreadable: set()
 * refuses rather than overwrite it, so that board shows no tips for good.
 */
const fs = require('node:fs');
const path = require('node:path');

const FILE = () => path.join(require('./store').ROOT, 'tips.json');

/* Every tip the page knows. An id not on this list is refused, so a stray
   client cannot grow the file without bound. */
/* 'settings' left with the Settings tip (#3574, Josh 2026-09-25): read() drops an unknown id, so a store that
   still holds it simply loses it, and nothing on the page sends it any more. */
/* 'newagent' and 'ring' left with #3755 (Josh 2026-09-25 11:07): no Create Agent tip, and the ring is the first step
   of an agent page's tips now. Dropped the same way. */
const TIP_IDS = ['tour', 'agents', 'projects', 'project', 'agentpage'];

function read() {
  try {
    const data = JSON.parse(fs.readFileSync(FILE(), 'utf8')) || {};
    const seen = (Array.isArray(data.seen) ? data.seen : []).filter((id) => TIP_IDS.includes(id));
    return { ok: true, seen: [...new Set(seen)], off: data.off === true };
  } catch (err) {
    if (err && err.code === 'ENOENT') return { ok: true, seen: [], off: false };
    return { ok: false, seen: [], off: false, because: 'we could not read which tips you have seen' };
  }
}

function write(next) {
  fs.mkdirSync(path.dirname(FILE()), { recursive: true });
  const tmp = FILE() + '.' + process.pid + '.' + Date.now() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), { flag: 'wx' });
  try { fs.renameSync(tmp, FILE()); }
  catch (err) { try { fs.unlinkSync(tmp); } catch { /* the write failed louder */ } throw err; }
}

/* `seen` adds to what is already seen (it never un-sees); `off` turns every
   first-visit tip off or back on. Both are validated before anything lands. */
function set({ seen, off }) {
  const now = read();
  if (!now.ok) return { ok: false, because: now.because };
  let nextSeen = now.seen;
  if (seen !== undefined) {
    if (!Array.isArray(seen) || !seen.every((id) => typeof id === 'string' && TIP_IDS.includes(id))) {
      return { ok: false, because: 'seen must be a list of known tips' };
    }
    nextSeen = [...new Set([...now.seen, ...seen])];
  }
  let nextOff = now.off;
  if (off !== undefined) {
    if (typeof off !== 'boolean') return { ok: false, because: 'off must be true or false' };
    nextOff = off;
  }
  try { write({ seen: nextSeen, off: nextOff }); return { ok: true, seen: nextSeen, off: nextOff }; }
  catch { return { ok: false, because: 'we could not save your tips' }; }
}

module.exports = { read, set, TIP_IDS, FILE };
