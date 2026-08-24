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
const PANEL = PAGE.slice(PAGE.indexOf('<section class="panel" id="panel-settings"'),
                         PAGE.indexOf('<section class="panel" id="panel-settings"') + 60000);
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
    'set-accounts': 'accounts', 'set-account': 'accounts',
    'lim-toggle': 'talking', 'lim-tier': 'talking',
    'set-applocation': 'mac', 'set-reveal': 'mac', 'set-machine': 'mac',
    'upd-btn': 'updates', 'tell-toggle': 'updates', 'auto-toggle': 'updates',
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
  assert.deepEqual(gos, ['you', 'accounts', 'connect', 'gskills', 'talking', 'mac', 'updates', 'plus', 'styles', 'advanced']);
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
