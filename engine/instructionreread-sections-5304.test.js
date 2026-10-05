'use strict';
/* kosmos#5304: each board-start block reports whether it rewrote the agent's file (`changed`), so a running agent can be
 * owed a re-read for that section (engine/instructionreread.js oweEach). Real cards from the real producer.
 *
 *   node --test engine/instructionreread-sections-5304.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-reread-5304-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
fs.mkdirSync(process.env.AGENT_WORKFORCE_WORKERS, { recursive: true });

const test = require('node:test');
const assert = require('node:assert/strict');
const fleet = require('../test-support/fleet');
const ir = require('./instructionreread');
test.after(() => { fleet.restore(); fs.rmSync(SANDBOX, { recursive: true, force: true }); });

function agentFile(name, text) {
  const dir = path.join(process.env.AGENT_WORKFORCE_WORKERS, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), text);
}

const CASES = [
  ['connections', 'connections', (m, s, r) => m.tellAgent(s, r)],
  ['dmfiles', 'dmfiles', (m, s, r) => m.tellAgent(s, r)],
  ['reports', 'reports', (m, s, r) => m.tellAgent(s, r)],
  ['you', 'you', (m, s, r) => m.tellAgent(s, r)],
  ['personlanguage', 'language', (m, s, r) => m.tellAgent(s, r, { tag: 'es-MX' })],
];

for (const [mod, section, tell] of CASES) {
  test(`#5304 ${mod}.tellAgent says changed: true when it writes, false when nothing changed`, () => {
    const name = 'a' + mod.slice(0, 6);
    if (mod === 'you') require('./you').save({ name: 'Josh', does: 'runs a company', know: '' });
    const board = fleet.install([fleet.agent(name, { state: 'idle' })]);
    try {
      agentFile(name, '# ' + name + '\n\nThe person wrote this.\n');
      const m = require('./' + mod);
      const first = tell(m, name, board.roster);
      assert.equal(first.state, require('./projects').TOLD.TOLD, first.because || '');
      assert.equal(first.changed, true, mod + ': a write did not say changed');
      // The heading the re-read line names is the one this block actually wrote.
      const heading = ir.lineFor([section]).match(/"([^"]+)"/)[1];
      const text = fs.readFileSync(path.join(process.env.AGENT_WORKFORCE_WORKERS, name, 'CLAUDE.md'), 'utf8');
      assert.ok(text.includes('## ' + heading), mod + ': the line names "' + heading + '", which is not the heading in the file');
      const second = tell(m, name, board.roster);
      assert.equal(second.changed, false, mod + ': an unchanged pass said changed (and would tell the agent again)');
    } finally { board.restore(); }
  });
}

test('#5304 oweEach owes the section to exactly the agents whose block changed', () => {
  const T = Date.parse('2026-10-05T17:00:00Z');
  const told = [{ agent: 'ann', changed: true }, { agent: 'bea', changed: false }, { agent: null, changed: true }];
  assert.deepEqual(ir.oweEach(told, {}, 'reports', T), { ann: { at: T, last: T, n: 1, sections: ['reports'] } });
  assert.deepEqual(ir.oweEach(null, {}, 'reports', T), {});
});
