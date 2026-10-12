'use strict';
/* kosmos#5957 slice 2: a RUNNING idle card and list row draw the far-behind sentence through the real card() and
   lrow() (evaluated from the real page region, STATE_COPY through lrow, as web.connection-lost-3410.test.js does), so
   dropping `card: true` at either call site cannot leave the lifted stateReason tests green alone. */
/* SANDBOX BEFORE ANY REQUIRE that pulls engine/status (test-support/fleet does): status.js freezes its roots then. */
const os = require('node:os');
const fs = require('node:fs');
const nodePath = require('node:path');
const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'kosmos-rulesbehind-render-5957-'));
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = nodePath.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = nodePath.join(SANDBOX, 'launch');
const test = require('node:test');
const assert = require('node:assert/strict');
const page = require('./test-support/page');
const fleet = require('./test-support/fleet');

const SCRIPT = page.scriptOf(fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8'));
const from = SCRIPT.indexOf('const STATE_COPY = {');
const lrowAt = SCRIPT.indexOf('function lrow(a)');
const end = SCRIPT.indexOf('\n}', SCRIPT.indexOf('</div>`;', lrowAt)) + 2;
assert.ok(from > -1 && lrowAt > from && end > lrowAt, 'renderer block not found: this test is stale, not the code');
// eslint-disable-next-line no-new-func
const api = new Function('CURRENT', SCRIPT.slice(from, end) + '\n; return { card, lrow };')(null);

const BOARD = fleet.install([fleet.agent('stale', { state: 'idle' })]);
process.on('exit', () => { try { BOARD.restore(); } catch { /* best effort */ } });
/* As web.connection-lost-3410: the route's profile/context enrichment as plain objects, the rest the real card. */
/* running: true as the route sets it for a live pane (the snapshot card does not carry it; connection-lost-3410 does the same). */
const row = (extra) => Object.assign({}, BOARD.card('stale'), { profile: { role: 'Assistant' }, context: {}, running: true }, extra);
const SAID = 'Its working rules are 13 versions behind. Open it to update them.';

for (const which of ['card', 'lrow']) {
  test(`#5957 ${which}: a running idle agent far behind draws the sentence; null draws nothing (control)`, () => {
    assert.equal(row({}).running, true, 'fixture: the card is not a running one');
    assert.ok(api[which](row({ rulesBehind: 13 })).includes(SAID), `${which} did not draw the sentence for a running idle agent`);
    assert.ok(!api[which](row({ rulesBehind: null })).includes('working rules'), `${which} drew it with no number`);
  });
}
