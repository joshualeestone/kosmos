'use strict';
/**
 * #2863 (Josh): the top tally of unread direct messages, the rollup of the
 * per-agent DM bubbles ("tally those at the top... so you can see where
 * notifications are happening and need you"). This is the AGENTS tally (a
 * "Messages" tile summing a.dmUnread across the fleet); the projects tally is the
 * follow-up. Builds on Angel's a.dmUnread (#2881) and the per-agent badge (#2885).
 *
 *   node --test web.dm-tally-2863.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const page = require('./test-support/page');
const SCRIPT = page.scriptOf(PAGE);

/* The sum is inline in tick(); extract the exact expression from source and
   evaluate it, so the test guards the real reduce rather than a paraphrase. The
   inputs carry only dmUnread (no sessionName), so they are not hand-built cards
   the fixture-discipline lint forbids -- the reduce reads only a.dmUnread. */
const m = SCRIPT.match(/const dmTotal = (data\.agents\.reduce\([\s\S]*?\}, 0\));/);
const sumOf = (agents) => {
  assert.ok(m, 'the dmTotal reduce is gone from tick()');
  return new Function('agents', 'return ' + m[1].replace('data.agents', 'agents') + ';')(agents);
};

test('the tally sums unread across the fleet, and null/negative contribute 0', () => {
  assert.equal(sumOf([{ dmUnread: 3 }, { dmUnread: 5 }]), 8, 'the tally does not sum the per-agent counts');
  assert.equal(sumOf([{ dmUnread: 3 }, { dmUnread: null }, { dmUnread: 5 }]), 8, 'an unknown (null) count was not treated as 0');
  assert.equal(sumOf([{ dmUnread: 3 }, {}, { dmUnread: -2 }]), 3, 'a missing or negative count was not treated as 0');
  assert.equal(sumOf([{ dmUnread: 0 }, { dmUnread: 0 }]), 0, 'zeros did not sum to zero');
});

test('the Messages tile is wired: set from the sum, hidden at zero', () => {
  assert.match(SCRIPT, /document\.getElementById\('st-dm'\)\.textContent = String\(dmTotal\);/,
    'the tile count is not set from the sum');
  assert.match(SCRIPT, /document\.getElementById\('st-dm-tile'\)\.hidden = dmTotal <= 0;/,
    'the tile is not hidden at zero (a quiet board would carry an empty Messages tile)');
});

test('a failed poll shows the tile as unknown-and-hidden, not a stale count', () => {
  assert.match(SCRIPT, /document\.getElementById\('st-dm'\)\.textContent = '\?';/,
    'a failed poll leaves a stale Messages count standing');
  assert.match(SCRIPT, /document\.getElementById\('st-dm-tile'\)\.hidden = true;/,
    'a failed poll does not hide the Messages tile');
});

test('the tile markup and its muted (non-alert) glyph are present', () => {
  assert.match(PAGE, /<div class="stat" id="st-dm-tile" hidden[^>]*>[\s\S]*?<b id="st-dm"[^>]*>0<\/b><span class="slab">Messages<\/span>/,
    'the Messages tile markup is missing or malformed');
  /* Its own glyph, NOT the red .haz alert mark: unread DMs point you somewhere,
     they are not a fault. Muted, like .rest. */
  assert.doesNotMatch(PAGE.match(/<div class="stat" id="st-dm-tile"[\s\S]*?<\/div>/)[0], /class="haz"/,
    'the Messages tile wears the red alert mark; it should carry its own muted glyph');
  assert.match(PAGE, /\.dmtile-g \{[^}]*color: var\(--k-ink-2\)/, 'the tally glyph is not muted (--k-ink-2)');
});
