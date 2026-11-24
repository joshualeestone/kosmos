'use strict';
/* kosmos#8952 slice (d): permgrow's cheap gate, anyPermissionWait, read against the REAL self-report store in a sandbox:
   true only while some agent's own hook reports a permission wait (selfreport's by:'auto' needs_you). */
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

test('anyPermissionWait: false with no reports, false for an agent asking in its own words, true for a hook-reported wait', () => {
  assert.ok(selfreport.DIR.startsWith(SANDBOX), 'premise: the store is the sandbox, not this computer');
  assert.equal(pg.anyPermissionWait(), false, 'no store yet');
  selfreport.record('ada', { state: 'working', because: 'x' });
  assert.equal(pg.anyPermissionWait(), false, 'working');
  selfreport.record('ada', { state: 'needs_you', because: 'which colour?' });
  assert.equal(selfreport.read('ada').by, 'agent');
  assert.equal(pg.anyPermissionWait(), false, 'a question the agent typed is not a permission prompt');
  selfreport.record('bo', { state: 'needs_you', because: 'Claude needs your permission', auto: true });
  assert.equal(selfreport.isAutoPermissionWait(selfreport.read('bo')), true, 'premise: an auto needs_you is the permission wait');
  assert.equal(pg.anyPermissionWait(), true);
  selfreport.record('bo', { state: 'working', because: 'x', auto: true });
  assert.equal(pg.anyPermissionWait(), false, 'answered');
});
