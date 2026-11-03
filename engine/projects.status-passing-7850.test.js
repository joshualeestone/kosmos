'use strict';
/*
 * kosmos#7850: folderState carries `passing: true` for a brief read error, for the listing routes. The project status
 * answer (describe) returns folderState too, and must not grow that field.
 *
 *   node --test engine/projects.status-passing-7850.test.js
 */
require('../test-support/tmpscope');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const projects = require('./projects');

const busy = () => { const e = new Error('EBUSY: test'); e.code = 'EBUSY'; throw e; };

test('#7850: a brief read error marks folderState passing, and project status leaves the mark out', () => {
  projects.setFsWorldForTests({ realpath: busy });
  try {
    const st = projects.folderState('/some/project/folder');
    assert.equal(st.passing, true, 'CONTROL: folderState marks the brief error: ' + JSON.stringify(st));
    const d = projects.describe({ id: 'p7850', name: 'P', folder: '/some/project/folder', agents: [] }, [], []);
    assert.ok(d && d.folderState, 'CONTROL: the status answer has a folderState: ' + JSON.stringify(d && d.folderState));
    assert.equal(d.folderState.state, st.state);
    assert.equal('passing' in d.folderState, false, 'the status answer carries the listing mark: ' + JSON.stringify(d.folderState));
  } finally {
    projects.setFsWorldForTests(null);
  }
});
