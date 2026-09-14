'use strict';
/**
 * #2863 (Josh): a red numbered bubble on an agent shows unread direct messages
 * from that agent, so you can see who is notifying you. This is the grid-card
 * half; the engine half (a.dmUnread on the fleet payload + POST /seen) shipped in
 * Angel's #2881. The list-view badge, the org node and the top tallies are the
 * follow-up.
 *
 *   node --test web.dm-badge-2863.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

/* Sandboxed before the fleet loads, as web.org-view.test.js does: install()
   writes worker folders and reads a data root, neither of which belongs to a
   test about a badge. */
process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-dm-'));
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-dm-w-'));
const fleet = require('./test-support/fleet');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const page = require('./test-support/page');
const SCRIPT = page.scriptOf(PAGE);

/* Real cards from the fleet, per fixture discipline. `dmUnread` is a
   server-payload field the pane/roster fixture does not emit, so it is SET on a
   real card here (a mutation, not a hand-built stand-in). */
const board = fleet.install([fleet.agent('mara', { state: 'working' }), fleet.agent('bo', { state: 'idle' })]);
const [mara, bo] = board.agents;

/* dmBadge reads only the module global CURRENT (and builtins), so it lifts and
   evaluates in isolation with CURRENT supplied. */
const dmBadgeSrc = page.lift(SCRIPT, 'dmBadge');
const makeDmBadge = (current) => new Function('CURRENT', dmBadgeSrc + '\nreturn dmBadge;')(current);
const withUnread = (agentCard, n) => { const a = { ...agentCard }; a.dmUnread = n; return a; };

test('dmBadge shows the count for unread, nothing for none/unknown', () => {
  const fn = makeDmBadge(null);
  assert.match(fn(withUnread(mara, 3)), /class="dmbadge"[^>]*>3<\/span>/, 'a 3-unread agent drew no numbered bubble');
  assert.equal(fn(withUnread(mara, 0)), '', 'a 0 count still drew a bubble');
  assert.equal(fn(withUnread(mara, null)), '', 'unknown (null) drew a bubble');
  assert.equal(fn(withUnread(mara, undefined)), '', 'a card with no dmUnread drew a bubble');
  assert.match(fn(withUnread(mara, 150)), />99\+<\/span>/, 'a big count did not cap at 99+');
});

test('dmBadge is suppressed for the agent being read (CURRENT), like the open project shows 0', () => {
  const fn = makeDmBadge(mara);
  assert.equal(fn(withUnread(mara, 5)), '', 'the agent being read still showed a badge');
  assert.match(fn(withUnread(bo, 5)), /dmbadge/, 'a different agent wrongly lost its badge');
});

test('both the running AND the offline card render the DM badge (a stopped agent that DM you still shows it)', () => {
  assert.match(SCRIPT, /<div class="agauge">\$\{ring\(a\)\}\$\{pres\}\$\{badge\}\$\{dmBadge\(a\)\}<\/div>/,
    'the running card gauge does not render dmBadge alongside the memory badge');
  /* The engine attaches dmUnread to offline agents too, so the not-running card
     must show it -- Josh's ask carries no running-only qualifier. */
  assert.match(SCRIPT, /<span class="pres off" aria-hidden="true"><\/span>\$\{dmBadge\(a\)\}<\/div>/,
    'the offline (not-running) card drops the DM badge, so a stopped agent that messaged you shows nothing');
});

test('#2863: the list row and the org node wire the DM badge (source guard, no browser needed)', () => {
  // The list badge is a direct .lrow child (the .lav avatar is overflow:hidden, so it
  // cannot live inside the avatar), in BOTH branches.
  assert.match(SCRIPT, /\$\{m\.st === 'attn' \? LROW_WARN : ''\}<\/div>\$\{dmBadge\(a\)\}/,
    'the running list row does not render dmBadge as a direct .lrow child');
  assert.match(SCRIPT, /<div class="lav">\$\{off\}<\/div>\$\{dmBadge\(a\)\}/,
    'the offline list row does not render dmBadge');
  // The org node concatenates dmBadge(a) (distinct from the grid card's ${dmBadge(a)}),
  // AND folds the unread count into the button aria-label -- a descendant badge's
  // aria-label is inert inside the labeled button, so the fold is the real signal.
  assert.match(SCRIPT, /\+ dmBadge\(a\)/,
    'the org node does not concatenate dmBadge(a)');
  assert.match(SCRIPT, /\(needsYou \? ', needs you' : ''\) \+ dmAria \+ '">'/,
    'the org node button aria-label does not fold in the unread-DM count (dmAria)');
});

test('reading a thread clears the unread count via a GATED POST /api/agent/<name>/seen', () => {
  const at = SCRIPT.indexOf('async function paintTalk');
  assert.ok(at > -1, 'paintTalk moved');
  const talk = SCRIPT.slice(at, at + 1800);
  assert.match(talk, /fetch\('\/api\/agent\/' \+ encodeURIComponent\(sessionName\) \+ '\/seen', \{ method: 'POST' \}\)/,
    'opening a thread does not advance the DM cursor, so the badge would never clear');
  assert.match(talk, /\.then\(\(r\) => r\.text\(\)\)/, 'the /seen response body is not read+dropped (the #39 networkidle rule)');
  /* paintTalk re-runs every ~5s poll while the panel is open; the POST must be
     gated so it does not do a full dm-seen.json write every tick. Gated on
     unread, and zero the local copy first (like the project p.unread = 0) so the
     re-run sees 0 and does not re-fire. */
  assert.match(talk, /if \(dmRec && dmRec\.dmUnread > 0\) \{[\s\S]*?dmRec\.dmUnread = 0;[\s\S]*?fetch\('\/api\/agent\//,
    'the /seen POST is not gated on unread + local-zero, so it fires a full write every ~5s poll');
});

test('the DM badge CSS is the red bubble, absolute, with a dark twin and the membadge co-occurrence offset', () => {
  // The BASE `.dmbadge` rule sits at line-start (no selector prefix). Anchor to the
  // preceding newline so this does not match the #2863 descendant selectors that also
  // contain ".dmbadge {" -- `.lrow > .dmbadge` and `.onode .dmbadge` -- one of which
  // now precedes the base rule in source order and would otherwise be read instead.
  const rule = PAGE.match(/\n\.dmbadge \{[^}]*\}/);
  assert.ok(rule, 'no .dmbadge rule');
  assert.match(rule[0], /position: absolute/, 'the badge is not absolute (would shift layout)');
  assert.match(rule[0], /background: #b3261e/, 'the badge is not the app red #b3261e');
  assert.match(rule[0], /pointer-events: none/, 'the badge would eat the card click');
  assert.match(PAGE, /:root\[data-theme="dark"\] \.dmbadge \{[^}]*#ff8c82/, 'no forced-dark twin for the DM badge');
  /* Scoped to :not(.unk): the unknown-memory badge is anchored to the BOTTOM of
     the gauge, a different corner, so offsetting it too would stretch it tall. */
  assert.match(PAGE, /\.agauge:has\(\.dmbadge\) \.membadge:not\(\.unk\) \{ top: 24px; \}/,
    'the plain memory badge is not dropped below the DM bubble on co-occurrence, or the offset is not scoped to :not(.unk)');
  assert.doesNotMatch(PAGE, /\.agauge:has\(\.dmbadge\) \.membadge \{ top: 24px; \}/,
    'the co-occurrence offset hits every .membadge (incl. the bottom-anchored .unk), which stretches the unknown badge');
});
