'use strict';
/**
 * The view lives in the address bar (#374). Josh: refreshing on an agent's or
 * a project's page threw him back to the overview; it did every time, because
 * nothing wrote the view into the URL. `syncUrl` is lifted and driven with a
 * fake history and location; the browser check render-url-state.js does the
 * refresh for real.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const page = require('./test-support/page');
const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = page.scriptOf(PAGE);

function drive(state) {
  const writes = [];
  const fn = new Function('history', 'location', 'URL_TAB', 'PJ_VIEW', 'CURRENT', 'PJ_CURRENT', 'TK_OPEN',
    page.lift(SCRIPT, 'syncUrl') + '\nsyncUrl();')(
    { replaceState: (_s, _t, url) => writes.push(url) },
    { search: state.search || '', pathname: '/' },
    state.tab || 'agents', state.view || 'list', state.current || null, state.project || null, state.task === undefined ? null : state.task,
  );
  void fn;
  return writes;
}

test('each view writes its own URL, and the overview writes a clean one', () => {
  assert.deepEqual(drive({ tab: 'agents', search: '?tab=detail&agent=mara' }), ['/'], 'the overview did not clear the URL');
  assert.deepEqual(drive({ tab: 'agents' }), [], 'an already clean overview was rewritten');
  assert.deepEqual(drive({ tab: 'detail', current: Object.fromEntries([['sessionName', 'mara']]) }), ['?tab=detail&agent=mara']);
  assert.deepEqual(drive({ tab: 'projects' }), ['?tab=projects']);
  assert.deepEqual(drive({ tab: 'projects', view: 'one', project: 'winterlaunch' }), ['?tab=projects&project=winterlaunch']);
  assert.deepEqual(drive({ tab: 'projects', view: 'task', project: 'winterlaunch', task: 3 }), ['?tab=projects&project=winterlaunch&task=3']);
  assert.deepEqual(drive({ tab: 'settings' }), ['?tab=settings']);
});

test('the URL follows what is showing, not the state left behind it', () => {
  // Back on the list with a project still in memory: no project in the URL.
  assert.deepEqual(drive({ tab: 'projects', view: 'list', project: 'winterlaunch', task: 3 }), ['?tab=projects']);
  // On the project page with a task id lingering: no task in the URL.
  assert.deepEqual(drive({ tab: 'projects', view: 'one', project: 'winterlaunch', task: 3 }), ['?tab=projects&project=winterlaunch']);
  // A detail tab with no agent open falls through to a plain tab.
  assert.deepEqual(drive({ tab: 'detail', current: null }), ['?tab=detail']);
});

test('it does not write when the address bar already says it, and carries the debugging knobs', () => {
  assert.deepEqual(drive({ tab: 'projects', search: '?tab=projects' }), [], 'a no-op rewrite on every paint');
  assert.deepEqual(drive({ tab: 'agents', search: '?tab=projects&limit=3' }), ['?limit=3'], 'the limit knob was dropped');
  assert.deepEqual(drive({ tab: 'detail', current: Object.fromEntries([['sessionName', 'a b']]), search: '?limit=3' }), ['?tab=detail&agent=a+b&limit=3']);
});
