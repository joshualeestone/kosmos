'use strict';
/**
 * #4506: the boot cover drops the tab layout's scrollbar gutter while it is up, so lifting it gives the page its 15px
 * back on a classic-scrollbar machine, and no window resize says so. The org chart fits itself to its width and
 * repaints on resize only, so revealBoot asks it to re-check once the cover is down. Lifted from the page and run.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
function lift(name) {
  const at = PAGE.indexOf('function ' + name + '(');
  assert.notEqual(at, -1, name + ' is gone from web/index.html');
  const open = PAGE.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < PAGE.length; i++) {
    if (PAGE[i] === '{') depth++;
    else if (PAGE[i] === '}' && --depth === 0) return PAGE.slice(at, i + 1);
  }
  assert.fail(name + ' never closes');
}
function run(cover, withOrg) {
  const calls = [];
  const ctx = vm.createContext({ document: { getElementById: (id) => (id === 'boot-cover' ? cover : null) } });
  if (withOrg) ctx.orgResizeRepaint = () => calls.push('org');
  vm.runInContext(lift('revealBoot'), ctx);
  vm.runInContext('revealBoot()', ctx);
  return calls;
}

test('#4506 lifting the cover hides it and asks the org chart to re-check its width', () => {
  const cover = { hidden: false };
  assert.deepEqual(run(cover, true), ['org']);
  assert.equal(cover.hidden, true);
});

test('#4506 CONTROL: a cover already down, or no cover, asks nothing (so the repaint is tied to the lift)', () => {
  assert.deepEqual(run({ hidden: true }, true), []);
  assert.deepEqual(run(null, true), []);
});

test('#4506 a page without the org chart (orgResizeRepaint absent) still lifts the cover', () => {
  const cover = { hidden: false };
  assert.deepEqual(run(cover, false), []);
  assert.equal(cover.hidden, true);
});
