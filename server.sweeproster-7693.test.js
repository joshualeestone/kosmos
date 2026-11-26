'use strict';
require('./test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)
/* kosmos#7693: six sweeps that decide or only tell share one roster reading at most 20 s old, and every send they make reads a fresh one.
   kosmos#8952 slice (d) adds a seventh, permgrow: it sends nothing, and the windows it resizes are named by a fresh
   `tmux list-windows` each tick, the roster only matching a window to its agent.
   Source-level, since these sweeps are wired inside server.js's start(). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('the shared reading is used by exactly those seven sweeps', () => {
  const uses = [...src.matchAll(/sweepRoster\(\)/g)].length;
  assert.equal(uses, 7, 'sweepRoster() call sites: ' + uses);
  assert.match(src, /const SWEEP_ROSTER_TTL_MS = 20 \* 1000;/);
});

test('their sends read a fresh roster, never the shared one', () => {
  assert.match(src, /deliver: \(session, text\) => chat\.deliver\(session, text, safeRoster\(\), undefined, undefined\)/);
  assert.match(src, /deliver: \(session, text\) => chat\.deliverAutomatic\(session, text, safeRoster\(\), undefined, undefined\)/);
  assert.match(src, /givePart\(projectId, n, partId, who, \{ assigner: true, roster: sendRoster\(\) \|\| roster, from \}\)/);
  assert.match(src, /ask: \(session, text, roster\) => chat\.deliverAutomatic\(session, text, sendRoster\(\) \|\| roster\)/);
  assert.doesNotMatch(src, /deliver[A-Za-z]*\([^)]*sweepRoster\(\)/, 'CONTROL: no send takes the shared reading');
  // Review 2: the Assigner's sends share one fresh read per tick.
  assert.match(src, /const sendRoster = \(\) => \(freshAtSend === undefined \? \(freshAtSend = safeRoster\(\)\) : freshAtSend\);/);
});
