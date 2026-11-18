'use strict';

/**
 * kosmos#8667 (from #8662, feedback 11-17): an agent with no model recorded said a bare "Unknown Model", which read as a
 * fault with no way forward. It now says "No model recorded: set it in AI Settings", and on a card or list row
 * "AI Settings" links to that agent's AI Settings (#7280's ?tab=detail&agent=<name>&sec=model). "Made before Kosmos
 * recorded this" and a named model are unchanged.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { scriptOf, liftAll } = require('./test-support/page');

/* Real cards from test-support/fleet (fixture-discipline: no hand-built card); each test sets only the model fields
   it is about, on top of a card the board itself produced. */
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-nomodel-8667-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
const fleet = require('./test-support/fleet');
const board = fleet.install([fleet.agent('cleo', { state: 'idle' }), fleet.agent('a&b"c', { state: 'idle' })]);
test.after(() => { board.restore(); fs.rmSync(SANDBOX, { recursive: true, force: true }); });
const NONE = { modelName: null, plannedModelName: null, earlierModelName: null, neverRecorded: false, runner: '' };
const card = (name, extra) => Object.assign({}, board.card(name), NONE, extra || {});
const CLEO = () => board.card('cleo').sessionName;

const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = scriptOf(PAGE);
const NO_MODEL = 'No model recorded: set it in AI Settings';

function lifted(names, call) {
  const src = liftAll(SCRIPT, names);
  return new Function('a', `
    const cardStOf = () => ({ pres: 'off' });
    ${src}
    return ${call};
  `);
}
const modelLine = lifted(['modelLine'], 'modelLine(a)');
const tileModelLine = lifted(['modelLine', 'tileModelLine'], 'tileModelLine(a)');
const cardLine = lifted(['modelLine', 'tileModelLine', 'modelLineHtml', 'esc'], 'modelLineHtml(a, tileModelLine(a))');
const rowCell = lifted(['modelLine', 'tileModelLine', 'modelLineHtml', 'lmodelCell', 'esc'], 'lmodelCell(a)');

test('no model recorded says so and where to set it; the other two states are unchanged', () => {
  assert.equal(modelLine(card('cleo', { isNamedOurs: true })), NO_MODEL);
  assert.equal(modelLine(card('cleo', { neverRecorded: true })), 'Made before Kosmos recorded this',
    'an agent with no launch file lost its history sentence');
  assert.equal(modelLine(card('cleo', { plannedModelName: 'Sonnet 5' })), 'Claude Sonnet 5', 'a named model changed');
  assert.equal(SCRIPT.includes("'Unknown Model'"), false, 'the page still says the bare "Unknown Model" somewhere');
});

test('on a card "AI Settings" links to that agent\'s AI Settings; on a list row the whole line does', () => {
  const s = CLEO();
  const link = '<a class="modelset" href="?tab=detail&amp;agent=' + encodeURIComponent(s) + '&amp;sec=model" data-ai-settings="' + s + '"';
  assert.equal(cardLine(card('cleo', { isNamedOurs: true })), 'No model recorded: set it in ' + link + '>AI Settings</a>');
  // Review 1: the row is one line cut by an ellipsis, so the part still showing must be the link.
  assert.equal(rowCell(card('cleo', { isNamedOurs: true })), link + ' title="' + NO_MODEL + '">' + NO_MODEL + '</a>');
});

test('a session name is encoded in the address and escaped in the attribute', () => {
  const html = cardLine(card('a&b"c', { isNamedOurs: true }));
  assert.ok(board.card('a&b"c').sessionName.startsWith('a&b"c'), 'premise: the card keeps its name in its session');
  assert.match(html, /href="\?tab=detail&amp;agent=a%26b%22c[^"&]*&amp;sec=model"/);
  assert.match(html, /data-ai-settings="a&amp;b&quot;c[^"]*"/);
});

test('CONTROLS: every other line is the escaped text, with no link', () => {
  assert.equal(cardLine(card('cleo', { plannedModelName: '<b>x</b>' })), 'Claude &lt;b&gt;x&lt;/b&gt;');
  assert.equal(rowCell(card('cleo', { neverRecorded: true })), '<span class="vh">Made before Kosmos recorded this</span>');
  assert.equal(cardLine(card('cleo', { neverRecorded: true })), 'Made before Kosmos recorded this');
  assert.equal(cardLine(card('cleo', { runner: 'codex' })), 'OpenAI Codex', 'a runner that names itself got the link');
  assert.equal(cardLine({ isNamedOurs: true }), NO_MODEL, 'a row with no session name had nowhere to link and still got a link');
});

test('the tile still names an earlier session\'s model in place of the no-model line (#6716)', () => {
  assert.equal(tileModelLine(card('cleo', { isNamedOurs: true, earlierModelName: 'Opus 5' })), 'Claude Opus 5');
  assert.equal(cardLine(card('cleo', { isNamedOurs: true, earlierModelName: 'Opus 5' })), 'Claude Opus 5');
});

test('review 2: AI Settings\' own model menu says only "No model recorded" for that line', () => {
  assert.ok(SCRIPT.includes("esc(runningName === '" + NO_MODEL + "' ? 'No model recorded' : (runningName || 'We cannot tell'))"),
    'the Switch menu placeholder repeats "set it in AI Settings" inside AI Settings');
});

test('the card draws its model line through modelLineHtml, and the board opens the link in place', () => {
  assert.match(SCRIPT, /<div class="amodel">\$\{modelLineHtml\(a, tileModelLine\(a\)\)\}/);
  assert.equal(/<div class="amodel">\$\{esc\(tileModelLine\(a\)\)\}/.test(SCRIPT), false, 'the card still prints the line as text');
  // The board click handler routes the link before its plain open of the card.
  const at = SCRIPT.indexOf("const aiSet = e.target.closest('[data-ai-settings]');");
  const open = SCRIPT.indexOf("const card = e.target.closest('.acard[data-agent], .lrow[data-agent]');");
  assert.ok(at > 0 && open > at, 'the AI Settings link is not routed before the card open');
  const route = SCRIPT.slice(at, open);
  assert.match(route, /openDetail\(who, 'model'\);/);
  // A modified click is left to the browser (a new tab follows the href).
  assert.match(route, /if \(e\.metaKey \|\| e\.ctrlKey \|\| e\.shiftKey \|\| e\.altKey\) return;/);
});

test('review 7: an agent Kosmos did not start says only "No model recorded", with no link (AI Settings cannot set it)', () => {
  for (const ours of [false, undefined]) {
    const a = card('cleo', { isNamedOurs: ours });
    assert.equal(modelLine(a), 'No model recorded', 'not ours (' + ours + ') was told to set it in AI Settings');
    assert.equal(cardLine(a), 'No model recorded', 'not ours (' + ours + ') got a link');
    assert.equal(rowCell(a), 'No model recorded');
  }
  // The tile still borrows an earlier session's model for it (#6716).
  assert.equal(tileModelLine(card('cleo', { earlierModelName: 'Opus 5' })), 'Claude Opus 5');
});
