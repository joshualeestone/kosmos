'use strict';
/* kosmos#8952 slice (d): permgrow's cheap gate, permissionWaits, read against the REAL self-report store in a sandbox:
   only the agents whose own hook reports a permission wait (selfreport's by:'auto' needs_you). */
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
// Sandbox every root BEFORE requiring any engine module (they resolve roots at require time).
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-permgrow-asking-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
const test = require('node:test');
const assert = require('node:assert');
const selfreport = require('./selfreport');
const pg = require('./permgrow');

test('permissionWaits: none with no reports, none for an agent asking in its own words, the agent whose hook reports a wait', () => {
  assert.ok(selfreport.DIR.startsWith(SANDBOX), 'premise: the store is the sandbox, not this computer');
  assert.deepEqual([...pg.permissionWaits().keys()], [], 'no store yet');
  selfreport.record('ada', { state: 'working', because: 'x' });
  assert.deepEqual([...pg.permissionWaits().keys()], [], 'working');
  selfreport.record('ada', { state: 'needs_you', because: 'which colour?' });
  assert.equal(selfreport.read('ada').by, 'agent');
  assert.deepEqual([...pg.permissionWaits().keys()], [], 'a question the agent typed is not a permission prompt');
  selfreport.record('bo', { state: 'needs_you', because: 'Claude needs your permission', auto: true });
  assert.equal(selfreport.isAutoPermissionWait(selfreport.read('bo')), true, 'premise: an auto needs_you is the permission wait');
  const w = pg.permissionWaits();
  assert.deepEqual([...w.keys()], ['bo']);
  assert.equal(w.get('bo'), selfreport.read('bo').at, 'keyed to the report, so a new report is judged again');
  selfreport.record('bo', { state: 'working', because: 'x', auto: true });
  assert.deepEqual([...pg.permissionWaits().keys()], [], 'answered');
});

test('permissionWaits with a cache: an unchanged report is not read again, a changed one is', () => {
  const cache = new Map();
  selfreport.record('cy', { state: 'needs_you', because: 'Claude needs your permission', auto: true });
  assert.deepEqual([...pg.permissionWaits(cache).keys()], ['cy']);
  const kept = cache.get('cy');
  assert.ok(kept && kept.at, 'premise: kept with its stamp');
  cache.set('cy', { ...kept, at: 'from-the-cache' });
  assert.equal(pg.permissionWaits(cache).get('cy'), 'from-the-cache', 'file unchanged: the kept reading is used');
  selfreport.record('cy', { state: 'working', because: 'x', auto: true });
  assert.deepEqual([...pg.permissionWaits(cache).keys()], [], 'file changed: read again');
});
