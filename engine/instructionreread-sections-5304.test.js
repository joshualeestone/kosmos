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
      const text = fs.readFileSync(path.join(process.env.AGENT_WORKFORCE_WORKERS, name, 'CLAUDE.md'), 'utf8');
      const named = [...ir.lineFor([section]).matchAll(/"([^"]+)"/g)].map((m) => m[1]);
      assert.ok(named.length >= 1);
      for (const heading of named) assert.ok(text.includes('## ' + heading), mod + ': the line names "' + heading + '", which is not a heading in the file');
      // Every heading the block wrote is named, so the agent does not stop reading before the part that changed.
      const START = require('./projects')[{ connections: 'CONNECTIONS_START', dmfiles: 'DMFILES_START', reports: 'REPORTS_START', you: 'YOU_START', language: 'LANGUAGE_START' }[section]];
      const END = require('./projects')[{ connections: 'CONNECTIONS_END', dmfiles: 'DMFILES_END', reports: 'REPORTS_END', you: 'YOU_END', language: 'LANGUAGE_END' }[section]];
      const inner = text.slice(text.indexOf(START), text.indexOf(END));
      const written = inner.split('\n').filter((l) => /^## /.test(l)).map((l) => l.slice(3).trim());
      assert.deepEqual(written.filter((h) => !named.includes(h)), [], mod + ': a heading in the block is not named in the line');
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

test('#5304 review 1: switching the language back to English removes the block and owes nothing; CONTROL: a change of language owes a re-read', () => {
  const pl = require('./personlanguage');
  const name = 'alangx';
  const board = fleet.install([fleet.agent(name, { state: 'idle' })]);
  try {
    agentFile(name, '# ' + name + '\n\nThe person wrote this.\n');
    const added = pl.tellAgent(name, board.roster, { tag: 'es-MX' });
    assert.equal(added.changed, true);
    assert.notEqual(added.removed, true);
    assert.deepEqual(Object.keys(ir.oweEach([{ agent: name, ...added }], {}, 'language')), [name]);
    const gone = pl.tellAgent(name, board.roster, { tag: 'en-US' });
    assert.equal(gone.changed, true, 'fixture: English did not remove the block');
    assert.equal(gone.removed, true);
    assert.deepEqual(ir.oweEach([{ agent: name, ...gone }], {}, 'language'), {}, 'a removed block owed a re-read of a section that is gone');
  } finally { board.restore(); }
});
