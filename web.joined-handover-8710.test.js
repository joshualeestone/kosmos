'use strict';
/**
 * kosmos#8710 slice 3: the leaving member's joined view says which agents their company is moving to a colleague's
 * computer (/api/org handover, from engine/handoversend notice), and why a pack stopped when one did.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');

function lift(src, name) {
  const at = src.indexOf(name);
  assert.notEqual(at, -1, name + ' is gone');
  const from = src.indexOf('{', at);
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(at, i + 1);
  }
  assert.fail(name + ' never closes');
}
function load() {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext([lift(PAGE, 'function plusOrgIn('), lift(PAGE, 'function plusOrgHandover(')].join('\n'), ctx);
  return ctx;
}

test('#8710: the hand-over line names the agents, and a stopped pack says why', () => {
  const c = load();
  assert.equal(c.plusOrgHandover({ handover: { agents: ['Ledger'] } }), ' Your company is moving Ledger, with their recent conversations and notes, to a colleague\'s computer.');
  assert.equal(c.plusOrgHandover({ handover: { agents: ['Ledger', 'Permit Intake', 'Scout'] } }),
    ' Your company is moving Ledger, Permit Intake and Scout, with their recent conversations and notes, to a colleague\'s computer.');
  assert.equal(c.plusOrgHandover({ handover: { agents: ['Ledger'], stopped: 'there is no agent called Ledger on this computer' } }),
    ' Your company is moving Ledger, with their recent conversations and notes, to a colleague\'s computer. Kosmos could not pack it: there is no agent called Ledger on this computer.');
  assert.equal(c.plusOrgHandover({ handover: { agents: ['Ledger', 'Scout'], stopped: 'no folder' } }),
    ' Your company is moving Ledger and Scout, with their recent conversations and notes, to a colleague\'s computer. Kosmos could not pack them: no folder.');
  for (const st of [null, {}, { handover: null }, { handover: {} }, { handover: { agents: [] } }, { handover: { agents: [3, ''] } }]) {
    assert.equal(c.plusOrgHandover(st), '', JSON.stringify(st));
  }
});

test('#8710: the joined view\'s sentence carries the hand-over line after the backup line', () => {
  const lines = PAGE.split('\n').filter((l) => /^\s*else if \(here\) document\.getElementById\('plus-org-say'\)\.textContent = /.test(l));
  assert.equal(lines.length, 1);
  assert.match(lines[0], /\+ plusOrgBackupLate\(st\) \+ plusOrgHandover\(st\)\);$/);
});
