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
const os = require('node:os');
const nodePath = require('node:path');

/* Sandboxed before the fleet loads (the exclusion test below needs real cards
   with a sessionName): install() writes worker folders and reads a data root. */
process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-dmt-'));
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-dmt-w-'));
const fleet = require('./test-support/fleet');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const page = require('./test-support/page');
const SCRIPT = page.scriptOf(PAGE);

/* The sum is inline in tick(); extract the exact expression from source and
   evaluate it (with CURRENT injected, since the reduce suppresses the open
   agent), so the test guards the real reduce rather than a paraphrase. */
const m = SCRIPT.match(/const dmTotal = (data\.agents\.reduce\([\s\S]*?\}, 0\));/);
const sumOf = (agents, current = null) => {
  assert.ok(m, 'the dmTotal reduce is gone from tick()');
  return new Function('agents', 'CURRENT', 'return ' + m[1].replace('data.agents', 'agents') + ';')(agents, current);
};

test('the tally sums unread across the fleet, and null/negative contribute 0', () => {
  /* Pure-sum cases carry only dmUnread (no sessionName), so they are not
     hand-built cards the fixture-discipline lint forbids; CURRENT is null. */
  assert.equal(sumOf([{ dmUnread: 3 }, { dmUnread: 5 }]), 8, 'the tally does not sum the per-agent counts');
  assert.equal(sumOf([{ dmUnread: 3 }, { dmUnread: null }, { dmUnread: 5 }]), 8, 'an unknown (null) count was not treated as 0');
  assert.equal(sumOf([{ dmUnread: 3 }, {}, { dmUnread: -2 }]), 3, 'a missing or negative count was not treated as 0');
  assert.equal(sumOf([{ dmUnread: 0 }, { dmUnread: 0 }]), 0, 'zeros did not sum to zero');
});

test('the agent whose thread is open (CURRENT) is excluded, so the tally agrees with the suppressed badge', () => {
  const [mara, bo] = fleet.install([fleet.agent('mara'), fleet.agent('bo')]).agents;
  const agents = [{ ...mara, dmUnread: 5 }, { ...bo, dmUnread: 3 }];
  assert.equal(sumOf(agents, mara), 3, 'the open agent (mara) unread was counted, disagreeing with its own suppressed badge');
  assert.equal(sumOf(agents, null), 8, 'control: with no thread open, both agents count');
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
