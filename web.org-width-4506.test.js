'use strict';
/**
 * #4506: the org chart fits itself to its width. That width changes with no window resize whenever the tab layout's
 * scrollbar gutter comes or goes (the boot cover, the first-run and update overlays, the first screen, the restart
 * screen and Talk drop it), so the chart also watches its own box: orgWatchWidth hands #orgview to a ResizeObserver
 * whose callback is orgResizeRepaint (which repaints only on a real width change, web.orgchart-phone-718.test.js).
 * Lifted from the page and run against a fake ResizeObserver.
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
function run(orgview, withObserver) {
  const seen = [];
  const ctx = vm.createContext({ document: { getElementById: (id) => (id === 'orgview' ? orgview : null) } });
  ctx.orgResizeRepaint = function orgResizeRepaint() {};
  if (withObserver) {
    ctx.ResizeObserver = class { constructor(cb) { this.cb = cb; } observe(el, opts) { seen.push({ cb: this.cb, el, opts }); } };
  }
  vm.runInContext(lift('orgWatchWidth'), ctx);
  vm.runInContext('orgWatchWidth()', ctx);
  return { seen, repaint: ctx.orgResizeRepaint };
}

test('#4506 the org chart watches its own box, with the width-guarded repaint as the callback', () => {
  const wrap = { id: 'orgview' };
  const { seen, repaint } = run(wrap, true);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].el, wrap);
  assert.equal(seen[0].cb, repaint);
});

test('#4506 and it is armed at load, next to the resize listener', () => {
  assert.match(PAGE, /window\.addEventListener\('resize', orgResizeRepaint\);\n[\s\S]{0,1200}\norgWatchWidth\(\);\n/);
});

test('#4506 CONTROL: no chart box or no ResizeObserver is not an error, and nothing is observed', () => {
  assert.deepEqual(run(null, true).seen, []);
  assert.deepEqual(run({ id: 'orgview' }, false).seen, []);
});
