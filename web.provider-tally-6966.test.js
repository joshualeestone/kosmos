"use strict";
/**
 * #6966: a project card shows which AI its agents run on, as one tally beside the count. The engine gives each member
 * row its provider (accountproblem.providerOf, tied members only); pjProviderTally counts them in a fixed order.
 *
 *   node --test web.provider-tally-6966.test.js
 */
require('./test-support/tmpscope'); // this file's temp dirs, removed when it exits (#4273)
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const page = require('./test-support/page');

process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-ptally-'));
process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-ptally-data-'));
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-ptally-workers-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-ptally-launch-'));
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');

const SCRIPT = page.scriptOf(fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8'));

/* Member rows from the real producer (projects.describe), never hand-built (fixture-discipline.test.js). */
const fleet = require('./test-support/fleet');
const projects = require('./engine/projects');
const status = require('./engine/status');
const ROWS = new Map();
test.before(() => {
  const board = fleet.install([
    fleet.agent('ada'),                                   // Claude (no runner recorded)
    fleet.agent('roo', { runner: 'gemini' }),
    fleet.agent('cleo', { runner: 'grok', state: 'stopped' }),   // its state does not matter here
    fleet.agent('dev', { runner: 'gemini', ours: false }),   // a pane we cannot tie to this name
  ]);
  try {
    const made = projects.create({ name: 'Provider Tally' });
    for (const sn of ['ada', 'roo', 'cleo', 'dev', 'pixel']) projects.addAgent(made.id, sn);
    /* pixel: an agent created here and not running, so the board gives it a paneless card (status.panelessCard):
       tied, no runner recorded. Asked of the real producer, as engine/status.created-roster-1078.test.js does. */
    let cards;
    status.setCreatedSource(() => ['pixel']);
    try { cards = status.snapshot().agents; } finally { status.setCreatedSource(null); }
    const pixel = cards.find((c) => c.sessionName === 'pixel');
    assert.ok(pixel && pixel.paneless === true && pixel.isNamedOurs === true, 'PRE-CONTROL: the board gave pixel no paneless card');
    const d = projects.describe(projects.readAll().find((x) => x.id === made.id), cards);
    for (const row of d.agents) ROWS.set(row.sessionName, row);
    assert.equal(ROWS.size, 5, 'PRE-CONTROL: the producer did not give a row for each member');
  } finally { board.restore(); }
});

test('#6966: a tied member row carries its provider; an untied or stopped one carries none', () => {
  assert.equal(ROWS.get('ada').provider, 'Claude');
  assert.equal(ROWS.get('roo').provider, 'Gemini');
  assert.equal(ROWS.get('cleo').provider, 'Grok');
  assert.equal(ROWS.get('dev').provider, null, 'a pane borrowing the name must not lend the card its provider');
  assert.equal(ROWS.get('pixel').provider, null, 'a stopped agent has no runner recorded; it must not read as Claude');
});

/* The tally, run for real with the two page helpers it calls stubbed: a mark is a span naming its picker key. */
const tally = new Function('providerMarkNode', 'esc', page.liftConst(SCRIPT, 'PJ_TALLY') + '\n' + page.liftConst(SCRIPT, 'PJ_TALLY_MARKS') + '\n' + page.lift(SCRIPT, 'pjProviderTally') + '\nreturn pjProviderTally;')(
  (pick) => ({ classList: { add() {} }, outerHTML: '<i data-k="' + pick + '"></i>' }),
  (s) => String(s),
);
const said = (html) => (html.match(/<span class="vh">([^<]*)<\/span>/) || [])[1];

test('#6966: the tally counts providers in the fixed order and says them in words', () => {
  const html = tally([{ provider: 'Grok' }, { provider: 'Claude' }, { provider: 'Gemini' }, { provider: 'Claude' }]);
  assert.equal(said(html), ', 2 Claude, 1 Gemini, 1 Grok');
  assert.deepEqual([...html.matchAll(/data-k="([^"]+)"/g)].map((m) => m[1]), ['claude', 'google', 'xai']);
});

test('#6966: Gemini on a Google subscription counts as Gemini; OpenAI reads GPT', () => {
  const html = tally([{ provider: 'Gemini (Google subscription)' }, { provider: 'Gemini' }, { provider: 'OpenAI' }]);
  assert.equal(said(html), ', 1 GPT, 2 Gemini');
});

test('#6966: a provider outside the list still counts, after the known ones; untied members and no members give no tally', () => {
  assert.equal(said(tally([{ provider: 'Acme' }, { provider: 'Meta Muse' }])), ', 1 Meta, 1 Acme');
  assert.equal(tally([{ provider: null }, {}, null]), '');
  assert.equal(tally([]), '');
  assert.equal(tally(undefined), '');
});

test('#7206: a DeepSeek member counts as DeepSeek, after Qwen and before a provider outside the list, with its own mark', () => {
  const html = tally([{ provider: 'Acme' }, { provider: 'DeepSeek' }, { provider: 'Qwen' }, { provider: 'DeepSeek' }]);
  assert.equal(said(html), ', 1 Qwen, 2 DeepSeek, 1 Acme');
  assert.deepEqual([...html.matchAll(/data-k="([^"]+)"/g)].map((m) => m[1]).slice(0, 2), ['alibaba', 'deepseek']);
});

test('#6966: every pick the tally uses is a key the provider picker has a mark for', () => {
  // The object up to its own closing line: liftConst stops at the first ';', and this one has one inside a comment.
  const at = SCRIPT.indexOf('const PROVIDER_MARK_KEY = {');
  assert.ok(at > -1, 'PROVIDER_MARK_KEY vanished from the page');
  const keys = new Function(SCRIPT.slice(at, SCRIPT.indexOf('\n};', at) + 3) + '\nreturn PROVIDER_MARK_KEY;')();
  const picks = new Function(page.liftConst(SCRIPT, 'PJ_TALLY') + '\nreturn PJ_TALLY;')().map((r) => r[1]);
  assert.ok(picks.length >= 7, 'PRE-CONTROL: the tally list was read');
  for (const k of picks) assert.ok(Object.prototype.hasOwnProperty.call(keys, k), k + ' has no mark in PROVIDER_MARK_KEY');
});

test('#6966: the project card appends the tally after its count', () => {
  assert.match(page.lift(SCRIPT, 'projectCard'), /\+ count \+ pjProviderTally\(p\.agents\) \+/);
});
