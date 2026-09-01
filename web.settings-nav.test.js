'use strict';
/**
 * The Settings page's sections (settings-nav, 2026-08-23): which box lives in
 * which section, the landing, and the two headings the mock renamed.
 *
 * The agent page's sibling test (web.agent-nav.test.js) explains the shape;
 * this pins Settings' own mapping, which is a regrouping of eight boxes into
 * seven sections and is the thing that would drift.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
/* From the panel's open to its own close: the panel closes at column 0 and
   the sections inside it close indented, so the first "\n</section>" is the
   panel's. (A fixed 60,000-character window sat here until 2026-08-25,
   when the Plus section's lost-phone box pushed Advanced past it and the
   test reported hist-go gone from a page that still had it.) */
const PANEL = PAGE.slice(PAGE.indexOf('<section class="panel" id="panel-settings"'));
const END = PANEL.indexOf('\n</section>');
const BODY = PANEL.slice(0, END);

function sectionOf(id) {
  const at = BODY.indexOf('id="' + id + '"');
  if (at < 0) return null;
  const opens = [...BODY.slice(0, at).matchAll(/<section class="dsec" id="s-sec-[a-z]+" data-sec="([a-z]+)"/g)];
  return opens.length ? opens[opens.length - 1][1] : null;
}

test('each settings box lives in the section the mock puts it in', () => {
  const want = {
    'you-file-btn': 'you', 'you-name': 'you', 'you-name-save': 'you',
    // 'set-account' (the standalone subscription-summary box) is gone
    // since #864 -- retired, not moved, so it has no section to check.
    'set-accounts': 'accounts',
    'lim-toggle': 'talking', 'lim-tier': 'talking',
    'set-applocation': 'mac', 'set-reveal': 'mac', 'set-machine': 'mac',
    'upd-btn': 'updates', 'auto-toggle': 'updates',
    'eng-toggle': 'advanced', 'hist-go': 'advanced', 'hist-count': 'advanced',
  };
  for (const [id, sec] of Object.entries(want)) {
    assert.ok(BODY.includes('id="' + id + '"'), 'the id ' + id + ' is no longer on the Settings page, so this test is reading nothing');
    assert.equal(sectionOf(id), sec, id + ' is not inside the ' + sec + ' section');
  }
  // Control: the nav itself is in no section.
  assert.equal(sectionOf('s-nav'), null, 'the nav moved inside a section');
});

test('the nav is in the ruled order, only You shows before a click, and the two renamed headings read as the mock', () => {
  const gos = [...BODY.matchAll(/<button type="button" data-go="([a-z]+)"/g)].map((m) => m[1]);
  /* Global skills joined after Connections (#478); Plus Account before
     Advanced (Josh, 2026-08-23 19:15). Union merged in landing order. */
  /* Token Usage after This computer, before Updates (#853). The SECTION rather
     than a top-level tab is a ruling with reasoning, not a preference: Josh
     parked a top-level analytics tab on #250 ("at some point ... but not now"),
     and today's line reads "I think we have one somewhere but THIS WOULD BE THE
     BASIS FOR IT" -- the engine feeds that tab, it is not an order to build it.
     Splinter, 2026-08-27 18:12, recorded so it can be overturned rather than
     obeyed. ⚠️ The POSITION within the nav is mine and carries no ruling: it sits
     with the other machine-wide, non-account sections. Moving it costs one line
     here and one in the page; the SHAPE is the part with a decision behind it. */
  assert.deepEqual(gos, ['you', 'accounts', 'connect', 'gskills', 'policy', 'talking', 'mac', 'automation', 'usage', 'updates', 'plus', 'styles', 'advanced']); // AI policy after Global Skills (#479); Styles before Advanced (#480); Automation after Mac, both machine-wide (#1724)
  const secs = [...BODY.matchAll(/<section class="dsec" id="s-sec-[a-z]+" data-sec="([a-z]+)"[^>]*?( hidden)?>/g)]
    .map((m) => ({ key: m[1], hidden: !!m[2] }));
  assert.deepEqual(secs.map((s) => s.key), gos, 'the sections are not in the order the nav lists them');
  assert.deepEqual(secs.filter((s) => !s.hidden).map((s) => s.key), ['you'], 'the landing is not You alone');
  assert.match(BODY, /<h3 class="dlab">Connections<\/h3>/, 'the task-board box is not headed Connections');
  assert.match(BODY, /<h3 class="dlab">Agents talking to each other<\/h3>/, 'the conversations box keeps its old heading');
  assert.doesNotMatch(BODY, /Your task board<\/h3>|Agent conversations<\/h3>/, 'an old heading survives');
});

test('the poll and the painter never choose the section', () => {
  const script = PAGE.slice(PAGE.lastIndexOf('<script>'));
  const at = script.indexOf('async function paintSettings(');
  const end = script.indexOf('\nfunction ', at + 1);
  const paint = script.slice(at, end > at ? end : undefined);
  assert.ok(paint.length > 500, 'paintSettings moved');
  assert.match(script, /function settingsGo\(/, 'control: settingsGo is gone, so the absences below prove nothing');
  assert.doesNotMatch(paint, /\bsettingsGo\b/, 'the painter picks a section');
  const tAt = script.indexOf('function tick(');
  const tick = script.slice(tAt, script.indexOf('\nfunction ', tAt + 1));
  assert.doesNotMatch(tick, /\bsettingsGo\b/, 'the poll picks a section');
});

test('a name-only save carries the other two fields whole', () => {
  const script = PAGE.slice(PAGE.lastIndexOf('<script>'));
  const at = script.indexOf("document.getElementById('you-name-save').addEventListener");
  const handler = script.slice(at, at + 3000);
  assert.match(handler, /body: JSON\.stringify\(\{ name, does: YOU_REC\.does, know: YOU_REC\.know \}\)/,
    '`you.save` replaces the record; a save that sends the name alone blanks what the person does');
  assert.match(handler, /if \(!YOU_REC\)/, 'a save with no record read is sent and refused by the engine instead of on screen');
  assert.match(handler, /t\.shownAs \|\| t\.agent/, 'a miss is read out by machine name');
  assert.doesNotMatch(handler, /Your agents have been told/, 'the sentence claims every agent was told when only running ones were reached');
});

// #864 (Josh, 2026-08-25 11:54): renamed "Accounts" to "AI Models" (his
// words: "that's really what it will mean to a white-collar end user"),
// removed the standalone "Claude subscription" summary box (it duplicated
// the provider rows below and could disagree with them), and made the
// connected dot pulse.
test('the accounts section is named AI Models, has no standalone subscription box, and the connected dot pulses', () => {
  assert.match(BODY, /<button type="button" data-go="accounts" aria-controls="s-sec-accounts">AI Models<\/button>/,
    'the nav label is not "AI Models"');
  assert.match(BODY, /<h3 class="dlab">Your AI models, by provider<\/h3>/,
    'the section heading is not "Your AI models, by provider"');
  assert.doesNotMatch(BODY, /id="set-account"/,
    'the standalone Claude-subscription summary box is still on the page');
  assert.doesNotMatch(PAGE, /function accountRow\(/,
    'accountRow still exists; #864 removed the box it drew, not just hid it');
  assert.match(PAGE, /\.acct-connected \.dot \{[^}]*animation: acct-pulse/,
    'the connected dot lost its pulse');
  assert.match(PAGE, /@media \(prefers-reduced-motion: reduce\) \{\n  \.acct-connected \.dot \{ animation: none; \}/,
    'the pulse has no reduced-motion guard');
});
