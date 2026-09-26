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
    // #2054: the "Agents Talking" tab was deleted and its one block (the
    // conversation limit) moved into Automation, alongside Auto-save and Prompter,
    // which became sliders in the same change.
    'lim-toggle': 'automation', 'lim-tier': 'automation',
    'ah-toggle': 'automation', 'ah-threshold': 'automation',
    'hb-toggle': 'automation', 'hb-interval': 'automation',
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
  assert.deepEqual(gos, ['you', 'accounts', 'connect', 'gskills', 'policy', 'mac', 'automation', 'usage', 'updates', 'plus', 'advanced']); // AI policy after Global Skills (#479); Automation after Mac, both machine-wide (#1724); 'talking' removed and folded into Automation (#2054); Styles removed entirely (#2618, the tab/consolidated flipper covers it)
  const secs = [...BODY.matchAll(/<section class="dsec" id="s-sec-[a-z]+" data-sec="([a-z]+)"[^>]*?( hidden)?>/g)]
    .map((m) => ({ key: m[1], hidden: !!m[2] }));
  assert.deepEqual(secs.map((s) => s.key), gos, 'the sections are not in the order the nav lists them');
  assert.deepEqual(secs.filter((s) => !s.hidden).map((s) => s.key), ['you'], 'the landing is not You alone');
  assert.match(BODY, /<h3 class="dlab">Connections<\/h3>/, 'the task-board box is not headed Connections');
  assert.match(BODY, /<h3 class="dlab">Agent Communication<\/h3>/, 'the conversations box is not headed Agent Communication (#2619 retitle)');
  assert.doesNotMatch(BODY, /Your task board<\/h3>|Agent conversations<\/h3>|Agents talking to each other<\/h3>/, 'an old heading survives');
});

// #2054: the consolidated Automation section, in Mona Lisa's ruled order. The
// "Agents Talking" top-level tab is gone (checked by the nav-order test above,
// which no longer lists 'talking'); its one block lives here as block 3. Daily
// report (#2037) is block 4. #2619 (Josh review) adds two more automations:
// Recommender (block 5, with its three irreversible-consequence guards) and
// Assigner (block 6).
test('#2054/#3138/#2619: Automation holds Auto-save, Prompter, Agent Communication, Daily report, Recommender, Assigner in order (Sounds moved to This computer), and Agents Talking is no longer its own tab', () => {
  const at = BODY.indexOf('id="s-sec-automation"');
  assert.ok(at > -1, 'the Automation section is gone');
  const end = BODY.indexOf('<section class="dsec"', at + 1);
  const sec = BODY.slice(at, end > at ? end : undefined);
  const headings = [...sec.matchAll(/<h3 class="dlab">([^<]+)<\/h3>/g)].map((m) => m[1]);
  // #2037 PR-C1: "Daily report" is the last block, the one the section's own
  // placeholder note reserved ("before the future Daily report (#2037)").
  // #3138 (Josh, 6.68): "Sounds" MOVED out of Automation to Settings > This computer
  // (bottom) -- whether YOU hear the pop is a per-device property, not a board setting.
  assert.deepEqual(headings, ['Auto-save', 'Prompter', 'Agent Communication', 'Daily report', 'Recommender', 'Assigner'],
    'the Automation blocks are not Auto-save, Prompter, Agent Communication, Daily report, Recommender, Assigner in that order (#2619 added the last two; Sounds moved out per #3138)');
  assert.ok(!headings.includes('Sounds'), '#3138: Sounds must NOT be in Automation anymore');
  // #2619: the Recommender carries its three irreversible-consequence guards, each a
  // real checkbox, all present. (Their DEFAULT-checked state + persistence are pinned
  // in engine/recommender-setting.test.js; here we assert the controls exist in the UI.)
  for (const g of ['rec-guard-money', 'rec-guard-public', 'rec-guard-delete']) {
    assert.match(sec, new RegExp('id="' + g + '"[^>]*type="checkbox"|type="checkbox"[^>]*id="' + g + '"'),
      '#2619: the Recommender guard checkbox ' + g + ' is missing');
  }
  // #2619: both new automations carry the same .toggle switch shape as the others.
  assert.match(sec, /id="rec-toggle"[^>]*class="toggle"|class="toggle"[^>]*id="rec-toggle"/, '#2619: the Recommender toggle is missing');
  assert.match(sec, /id="asg-toggle"[^>]*class="toggle"|class="toggle"[^>]*id="asg-toggle"/, '#2619: the Assigner toggle is missing');
  // #3595 phase 2: the Assigner is live too. No disabled attribute (the real boolean one, NOT
  // aria-disabled: a plain /\bdisabled\b/ matches inside "aria-disabled", so the lookbehind
  // (?<!aria-) requires the standalone attribute), the toggle starts hidden until the read
  // lands, no "not active yet" note is left, and it is painted from the server and wired to save.
  assert.doesNotMatch(sec, /id="asg-toggle"[^>]*(?<!aria-)\bdisabled\b/, '#3595: the Assigner toggle is still disabled though its behaviour is built');
  assert.match(sec, /id="asg-toggle"[^>]*\bhidden\b/, '#3595: the Assigner toggle must start hidden until the setting is read (never a false Off)');
  assert.doesNotMatch(sec, /Not active yet/, '#3595: a "not active yet" note is left though both automations are live');
  assert.match(PAGE, /function paintAssigner\(/, '#3595: the Assigner has no painter');
  assert.match(PAGE, /\/api\/assigner-setting/, '#3595: the page never reads or writes the Assigner setting');
  // #3595: the Recommender is live. Its toggle and guards carry NO disabled attribute, the
  // toggle starts hidden (status contract: shown only once the server read lands), and it
  // is painted from the server and wired to save.
  assert.doesNotMatch(sec, /id="rec-toggle"[^>]*(?<!aria-)\bdisabled\b/, '#3595: the Recommender toggle is still disabled though its behaviour is built');
  assert.match(sec, /id="rec-toggle"[^>]*\bhidden\b/, '#3595: the Recommender toggle must start hidden until the setting is read (never a false Off)');
  for (const g of ['rec-guard-money', 'rec-guard-public', 'rec-guard-delete']) {
    assert.doesNotMatch(sec, new RegExp('id="' + g + '"[^>]*(?<!aria-)\\bdisabled\\b'), '#3595: the guard ' + g + ' is still disabled');
  }
  // #3595 (Splinter): the guards are instructions only (agents run with bypass permissions),
  // so the screen must say Kosmos cannot yet stop these actions itself. Pinned so a later copy
  // edit cannot quietly promise enforcement that does not exist.
  assert.match(sec, /Kosmos cannot yet stop these actions on its own/, '#3595: the instruction-only guard disclosure is gone');
  assert.match(PAGE, /function paintSettings\(\)[\s\S]*?paintRecommender\(\)/, '#3595: paintSettings no longer paints the Recommender');
  assert.match(PAGE, /getElementById\('rec-toggle'\)\.addEventListener\('click', recToggleClick\)/, '#3595: the Recommender toggle is not wired to save');
  // #2619 (a11y, CI named-controls): each guard checkbox needs an accessible name
  // the named-controls browser check recognizes. That check reads the name from
  // aria-label / aria-labelledby / own text / title / label[for=id] - it does NOT
  // read an implicit wrapping <label>. A wrapped-only checkbox reads as unnamed and
  // fails "every visible control has a name" in CI (caught on PR #3549). Pin the
  // explicit label[for] association here so the class is caught at the cheap layer.
  for (const g of ['rec-guard-money', 'rec-guard-public', 'rec-guard-delete']) {
    assert.match(sec, new RegExp('<label[^>]*\\bfor="' + g + '"'),
      '#2619: the guard checkbox ' + g + ' needs an explicit <label for="' + g + '"> so it has an accessible name (named-controls CI check)');
  }
  // #3138: Sounds is now LAST in the This computer (mac) section.
  const macAt = BODY.indexOf('id="s-sec-mac"');
  const macEnd = BODY.indexOf('<section class="dsec"', macAt + 1);
  const macSec = BODY.slice(macAt, macEnd > macAt ? macEnd : undefined);
  const macHeadings = [...macSec.matchAll(/<h3 class="dlab">([^<]+)<\/h3>/g)].map((m) => m[1]);
  assert.ok(macHeadings.includes('Sounds'), '#3138: Sounds must be in the This computer section now');
  assert.equal(macHeadings[macHeadings.length - 1], 'Sounds', '#3138: Sounds must be LAST in the This computer section');
  assert.ok(macSec.includes('id="snd-toggle"'), '#3138: the snd-toggle moved with its block into This computer');
  // The tab and its section are deleted, not merely hidden.
  assert.doesNotMatch(BODY, /data-go="talking"/, 'the Agents Talking nav pill survives');
  assert.doesNotMatch(BODY, /id="s-sec-talking"/, 'the Agents Talking section survives');
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
