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
const ROWS = new Map();
test.before(() => {
  const board = fleet.install([
    fleet.agent('ada'),                                   // Claude (no runner recorded)
    fleet.agent('ben', { runner: 'gemini' }),
    fleet.agent('cleo', { runner: 'grok', state: 'stopped' }),   // its state does not matter here
    fleet.agent('dev', { runner: 'gemini', ours: false }),   // a pane we cannot tie to this name
  ]);
  try {
    const made = projects.create({ name: 'Provider Tally' });
    for (const sn of ['ada', 'ben', 'cleo', 'dev']) projects.addAgent(made.id, sn);
    const d = projects.describe(projects.readAll().find((x) => x.id === made.id), board.agents);
    for (const row of d.agents) ROWS.set(row.sessionName, row);
    assert.equal(ROWS.size, 4, 'PRE-CONTROL: the producer did not give a row for each member');
  } finally { board.restore(); }
});

test('#6966: a tied member row carries its provider; an untied one carries none', () => {
  assert.equal(ROWS.get('ada').provider, 'Claude');
  assert.equal(ROWS.get('ben').provider, 'Gemini');
  assert.equal(ROWS.get('cleo').provider, 'Grok');
  assert.equal(ROWS.get('dev').provider, null, 'a pane borrowing the name must not lend the card its provider');
});

/* The tally, run for real with the two page helpers it calls stubbed: a mark is a span naming its picker key. */
const tally = new Function('providerMarkNode', 'esc', page.liftConst(SCRIPT, 'PJ_TALLY') + '\n' + page.lift(SCRIPT, 'pjProviderTally') + '\nreturn pjProviderTally;')(
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
  const html = tally([{ provider: 'Google' }, { provider: 'Gemini' }, { provider: 'OpenAI' }]);
  assert.equal(said(html), ', 1 GPT, 2 Gemini');
});

test('#6966: a provider with no mark still counts, after the known ones; untied members and no members give no tally', () => {
  assert.equal(said(tally([{ provider: 'Mistral' }, { provider: 'Meta' }])), ', 1 Meta, 1 Mistral');
  assert.equal(tally([{ provider: null }, {}, null]), '');
  assert.equal(tally([]), '');
  assert.equal(tally(undefined), '');
});
