'use strict';
/**
 * kosmos#7586: when the company's policy requires reports and this computer cannot send them yet, the joined view says
 * the company requires them and sees it is not reporting. The line for each state, and that the joined view's sentence
 * carries it.
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
  const m = PAGE.match(/const PLUS_ORG_REQUIRED_WAIT = '[^']*';/);
  assert.ok(m, 'PLUS_ORG_REQUIRED_WAIT is gone');
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext([m[0].replace(/^const/, 'var'), lift(PAGE, 'function plusOrgIn('), lift(PAGE, 'function plusOrgRequiredWait(')].join('\n'), ctx);
  return ctx;
}

test('#7586: the line shows only when reports are required and this computer is not reporting', () => {
  const c = load();
  for (const wait of [null, 'print', 'printError']) {
    assert.equal(c.plusOrgRequiredWait({ reporting: false, reportingWait: wait, reportingRequired: true }),
      ' Your company requires this computer to report, and sees that it is not reporting yet.', String(wait));
  }
  for (const st of [null, {}, { reporting: true, reportingRequired: true }, { reporting: false, reportingRequired: false },
    { reporting: false }, { reporting: false, reportingRequired: 'true' },
    { reporting: false, reportingWait: 'noReports', reportingRequired: true }]) {
    assert.equal(c.plusOrgRequiredWait(st), '', JSON.stringify(st));
  }
});

test('#7586: a family reads it as its family', () => {
  const c = load();
  const line = c.plusOrgIn({ kind: 'family' }, '.' + c.plusOrgRequiredWait({ reporting: false, reportingRequired: true }));
  assert.equal(line, '. Your family requires this computer to report, and sees that it is not reporting yet.');
});

test('#7586: the joined view\'s sentence carries the line, inside its not-reporting branch', () => {
  // The assignment itself, not a comment: the line that sets plus-org-say for a joined work Kosmos.
  const lines = PAGE.split('\n').filter((l) => /^\s*else if \(here\) document\.getElementById\('plus-org-say'\)\.textContent = /.test(l));
  assert.equal(lines.length, 1, 'the joined view sentence moved: ' + lines.length);
  assert.match(lines[0], /st\.reporting === false \? \(.*\) \+ plusOrgRequiredWait\(st\) : ''\)\);$/);
});
