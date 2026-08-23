'use strict';
/**
 * The agent page's sections (agent-page-nav, 2026-08-23): which box lives in
 * which section, and the two behaviours that moved with the split.
 *
 * server.test.js pins the ORDER of the nav and the sections. This pins the
 * MEMBERSHIP, box by box, because that is what drifts: the next person to add
 * a box puts it in the column it was nearest to, and the nav above it says
 * something else. The browser check (docs/browser-checks/render-agent-nav.js)
 * proves a click puts the right section on screen; this proves the section
 * holds what it claims to.
 *
 * ⚠️ Every id below is one that shipped in the single column. A rename of any
 * of them fails here loudly rather than letting the membership assertion pass
 * on an id that is no longer on the page (the control at the end).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const PANEL = PAGE.slice(PAGE.indexOf('<section class="detail" id="panel-detail"'),
                         PAGE.indexOf('<section class="panel" id="panel-settings"'));

function sectionOf(id) {
  /* The sections are consecutive siblings with nothing but comments between
     them, and they close the panel, so the section an id is inside is the last
     `.dsec` opened before it. An id above the first open (the header) is in
     none, which is what the control below asserts. */
  const at = PANEL.indexOf('id="' + id + '"');
  if (at < 0) return null;
  const opens = [...PANEL.slice(0, at).matchAll(/<section class="dsec" id="d-sec-[a-z]+" data-sec="([a-z]+)"/g)];
  return opens.length ? opens[opens.length - 1][1] : null;
}

test('each shipped box lives in the section the mock puts it in', () => {
  const want = {
    'd-convo': 'talk', 'd-talk-box': 'talk', 'd-say': 'talk', 'd-qask': 'talk',
    'd-model': 'model', 'd-account': 'model', 'd-runson': 'model',
    'd-memory': 'memory', 'd-restart-agent': 'memory', 'd-restart-start': 'memory',
    'd-instr': 'instr', 'd-instr-save': 'instr', 'd-instr-outdated': 'instr',
    'd-file': 'profile', 'd-rename': 'profile', 'd-role': 'profile', 'd-reports': 'profile', 'd-save': 'profile',
    'd-window-box': 'term', 'd-window': 'term',
    'd-remove-agent': 'remove', 'd-remove-start': 'remove',
  };
  for (const [id, sec] of Object.entries(want)) {
    assert.ok(PANEL.includes('id="' + id + '"'), 'the id ' + id + ' is no longer on the agent page, so this test is reading nothing');
    assert.equal(sectionOf(id), sec, id + ' is not inside the ' + sec + ' section');
  }
  // Control: the header's elements are ABOVE the sections and must say so.
  assert.equal(sectionOf('d-name'), null, 'the header moved inside a section');
  assert.equal(sectionOf('d-instr-stale'), null, 'the stale note moved out of the header');
});

test('only Talk is on screen before a click, and every section can be reached from the nav', () => {
  const secs = [...PANEL.matchAll(/<section class="dsec" id="d-sec-[a-z]+" data-sec="([a-z]+)"[^>]*?( hidden)?>/g)]
    .map((m) => ({ key: m[1], hidden: !!m[2] }));
  assert.equal(secs.length, 7, 'the page has ' + secs.length + ' sections, not seven');
  assert.deepEqual(secs.filter((s) => !s.hidden).map((s) => s.key), ['talk'], 'the landing is not Talk alone');
  const gos = [...PANEL.matchAll(/data-go="([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(new Set(gos), new Set(secs.map((s) => s.key)), 'a section has no pill, or a pill has no section');
  for (const s of secs) {
    assert.match(PANEL, new RegExp('id="d-sec-' + s.key + '" data-sec="' + s.key + '" tabindex="-1"'), s.key + ' cannot take focus, so a click strands the keyboard on the nav');
  }
});

test('the poll never chooses the section', () => {
  const script = PAGE.slice(PAGE.lastIndexOf('<script>'));
  /* The poll is the one caller that would flip a reader off the section
     they chose five seconds after they chose it. The identifier, not just a
     call: an alias (`const go = detailGo`) is the same defect. */
  const at = script.indexOf('function tick(');
  const end = script.indexOf('\nfunction ', at + 1);
  const tick = script.slice(at, end > at ? end : undefined);
  assert.ok(tick.length > 5000, 'tick() moved or shrank; the slice below covers ' + tick.length + ' characters');
  assert.doesNotMatch(tick, /\bdetailGo\b/, 'the poll picks a section');
  // And the poll's capture is gated on the Terminal section being on screen,
  // with the arrival capture in detailGo, or a page left open on Talk costs a
  // capture-pane every five seconds for nothing anybody can see.
  assert.match(tick, /!detailSection\('term'\)\.hidden/, 'the poll captures the window while the Terminal section is hidden');
  const go = script.slice(script.indexOf('function detailGo('), script.indexOf('\nfunction ', script.indexOf('function detailGo(') + 1));
  assert.match(go, /section === 'term'[\s\S]{0,400}detailPaintWindow\(/, 'arriving at Terminal does not capture, so the section shows a stale window until the next tick');
  // And from the FRESH record, not the one captured at open: the poll never
  // rewrites CURRENT, so a tie that changed while the person was elsewhere
  // would paint the wrong sentence for a round of the tick.
  assert.match(go, /detailPaintWindow\(LAST\.find\([\s\S]{0,80}CURRENT\.sessionName\)\)/, 'the arrival paint reads the record captured at open');
  assert.doesNotMatch(go, /\|\| CURRENT\)/, 'a missing record falls back to the open-time one, so a removed agent is painted as still here');
});

test('the agent window no longer answers to the Engineering mode switch on this page', () => {
  const src = fs.readFileSync(nodePath.join(__dirname, 'server.js'), 'utf8');
  const at = src.indexOf("/^\\/api\\/agent\\/([^/]+)\\/window$/");
  const next = src.indexOf('pathname.match(', at + 1);   // the next route's own matcher closes this one
  const route = src.slice(at, next > at ? next : undefined);
  assert.ok(route.length > 100 && route.length < 20000, 'the window route moved, or the slice ran into the rest of the file: ' + route.length);
  assert.doesNotMatch(route, /engmode\.read\(\)\.on/, 'the agent window route still reads the switch');
  // The switch's copy must describe what it now governs, and say where the
  // window still is for somebody who turns it off.
  assert.match(PAGE, /Show agents' windows on project pages/, 'the switch still claims to govern each agent\'s window');
  assert.match(PAGE, /Each agent's own page always shows its window\./, 'the switch copy does not say where the window still is');
  assert.doesNotMatch(PAGE, /Show the window each agent is running in/, 'the old switch label survives somewhere');
  assert.match(PAGE, /#d-window \{ max-height: 560px; \}/, 'the window cap is not scoped to the agent page box');
});

test('the nav names the agent in the two places a bare label would be unsafe', () => {
  const script = PAGE.slice(PAGE.lastIndexOf('<script>'));
  assert.match(script, /'Talk to ' \+ n/, 'the Talk pill does not name the agent');
  assert.match(script, /'Remove ' \+ n/, 'the Remove pill does not name the agent');
  assert.match(script, /'Change & Restart ' \+ n/, 'the model button does not name the agent');
  assert.match(script, /detailNavNames\(renameTo\)/, 'a rename leaves the old name on the pills until the page is reopened');
  // Shipped markup carries the nameless form: a painter that returns early
  // must not leave the previous agent's name on a button.
  assert.match(PANEL, /id="d-nav-talk">Talk to this agent</, 'the markup ships a name');
  assert.match(PANEL, /id="d-nav-remove">Remove this agent</, 'the markup ships a name');
});
