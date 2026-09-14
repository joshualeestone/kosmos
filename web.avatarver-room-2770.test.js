'use strict';

/**
 * #2770: a room message SENDER's avatar went stale after a profile-image
 * update.
 *
 * pjRoomRow drew the sender face with a BARE avatar URL. Its output is painted
 * through paintThreadInto -> setLive, and setLive skips the repaint when the
 * new HTML is byte-identical to the last. A no-store avatar route plus a URL
 * that never changes means the <img> is never recreated, so a sender who
 * changes their picture keeps showing the old one in the room. This is the
 * same class as #2698 (org chart) and #2762 (project member faces): the cure
 * is a ?v=<avatarVer> that MOVES when the picture changes.
 *
 * The sender's version does not travel on the project member row -- p.agents
 * (from projects.describe) carries hasAvatar but not avatarVer -- so pjRoomRow
 * reads it from LAST, the board snapshot, the same source the org chart
 * versions from. These tests pin (1) the row emits the versioned URL and the
 * bare one has not crept back, and (2) the pjAvatarVer helper resolves a
 * sender's version out of LAST, falling back to 0 for a sender who is not on
 * the board (the status quo for that row -- stale, but never a regression,
 * because with no card there is no newer version to show).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');

/* Boundary-matched brace slice so a sibling whose name merely starts with the
   wanted one cannot capture the extractor, and so the slice is the REAL body
   read out of the build rather than a copy restated here. */
function fnSrc(name) {
  const at = PAGE.indexOf('function ' + name + '(');
  assert.ok(at > -1, name + ' vanished from the page');
  let depth = 0;
  for (let k = PAGE.indexOf('{', at); k < PAGE.length; k += 1) {
    if (PAGE[k] === '{') depth += 1;
    else if (PAGE[k] === '}') { depth -= 1; if (depth === 0) return PAGE.slice(at, k + 1); }
  }
  throw new Error(name + ' had no balanced body');
}

test('#2770: the room sender avatar URL carries the avatar version so a changed picture repaints the row', () => {
  const row = fnSrc('pjRoomRow');
  assert.match(
    row,
    /\/avatar\?v='\s*\+\s*pjAvatarVer\(m\.from\)/,
    'the room sender avatar img must carry ?v=<version>; a bare URL never changes so setLive skips the repaint and the row keeps the old picture',
  );
  assert.doesNotMatch(
    row,
    /\/avatar" alt=""/,
    'the bare unversioned sender avatar URL crept back, which silently re-breaks #2770',
  );
});

test('#2770: pjAvatarVer resolves the sender version out of LAST with a safe 0 fallback', () => {
  // Source-slice, not a runtime fixture: the fixture-discipline gate forbids a
  // test hand-building a card (an object literal keyed on the session name),
  // and a real avatarVer only moves when an avatar file is saved, so a mock
  // LAST here would be that forbidden hand-built roster row. Pin the resolution
  // at the source instead: the helper
  // must read LAST (the board snapshot, the only surface carrying avatarVer,
  // per #2698) and fall back to 0 for a sender with no card / no version, which
  // is the status quo for that row rather than a regression.
  const src = fnSrc('pjAvatarVer');
  assert.match(src, /\bLAST\b/, 'pjAvatarVer must read the version from LAST, the board snapshot that carries avatarVer');
  assert.match(src, /\.sessionName\s*===\s*from/, 'pjAvatarVer must match the sender by sessionName, the key LAST cards are addressed on');
  assert.match(src, /\.avatarVer\b/, 'pjAvatarVer must read the sender card avatarVer');
  assert.match(src, /\|\|\s*0/, 'pjAvatarVer must fall back to 0 when the sender has no card or no version, never undefined');
});
