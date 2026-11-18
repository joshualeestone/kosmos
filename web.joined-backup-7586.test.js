'use strict';
/**
 * kosmos#7586: when the company's policy requires backup and the coordinator's record of this computer's last backup
 * does not meet it (/api/org backupLate, from engine/orgpolicy.backupLate), the joined view says so. The line for each
 * state, a family's wording, and that the joined view's sentence carries it OUTSIDE the not-reporting branch (a
 * computer that reports can still be behind on backup).
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
  const consts = ['PLUS_ORG_BACKUP_NEVER', 'PLUS_ORG_BACKUP_LATE'].map((n) => {
    const m = PAGE.match(new RegExp('const ' + n + " = '[^']*';"));
    assert.ok(m, n + ' is gone');
    return m[0].replace(/^const/, 'var');
  });
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext([...consts, lift(PAGE, 'function plusOrgIn('), lift(PAGE, 'function plusOrgBackupLate(')].join('\n'), ctx);
  return ctx;
}

test('#7586: the backup line for never and late, and nothing otherwise', () => {
  const c = load();
  assert.equal(c.plusOrgBackupLate({ backupLate: 'never' }),
    ' Your company requires this computer to be backed up, and its console shows it has not backed up yet.');
  assert.equal(c.plusOrgBackupLate({ backupLate: 'late' }),
    ' Your company requires this computer to be backed up, and its console shows its last backup is older than your company allows.');
  for (const st of [null, {}, { backupLate: null }, { backupLate: 'Late' }, { backupLate: true }]) {
    assert.equal(c.plusOrgBackupLate(st), '', JSON.stringify(st));
  }
});

test('#7586: a family reads it as its family', () => {
  const c = load();
  assert.equal(c.plusOrgIn({ kind: 'family' }, '.' + c.plusOrgBackupLate({ backupLate: 'never' })),
    '. Your family requires this computer to be backed up, and its console shows it has not backed up yet.');
  assert.equal(c.plusOrgIn({ kind: 'family' }, '.' + c.plusOrgBackupLate({ backupLate: 'late' })),
    '. Your family requires this computer to be backed up, and its console shows its last backup is older than your family allows.');
});

test('#7586: the joined view\'s sentence carries the backup line after the reporting branch, not inside it', () => {
  const lines = PAGE.split('\n').filter((l) => /^\s*else if \(here\) document\.getElementById\('plus-org-say'\)\.textContent = /.test(l));
  assert.equal(lines.length, 1, 'the joined view sentence moved: ' + lines.length);
  assert.match(lines[0], /\+ plusOrgRequiredWait\(st\) : ''\) \+ plusOrgBackupLate\(st\)\);$/);
});
