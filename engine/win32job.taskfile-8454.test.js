'use strict';
/**
 * kosmos#8454: where Task Scheduler keeps a registered task, which is the file whose time the board reads as "the job
 * last changed" on Windows (server.js, the codex-limits walk). A plist path named a file that never exists there, so a
 * Codex agent moved to another account kept showing its old account's limits.
 *
 * Pure path arithmetic, so it runs on every platform; the Windows separator is what path.join gives on Windows.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const win32job = require('./win32job');

function withEnv(over, fn) {
  const keys = Object.keys(over);
  const before = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) { if (over[k] === undefined) delete process.env[k]; else process.env[k] = over[k]; }
  try { return fn(); } finally {
    for (const k of keys) { if (before[k] === undefined) delete process.env[k]; else process.env[k] = before[k]; }
  }
}

test('#8454 an unsandboxed board reads the task file Task Scheduler keeps under System32\\Tasks', () => {
  // Both spellings: on Windows process.env ignores case, so deleting one would delete the other.
  withEnv({ AGENT_WORKFORCE_LAUNCH: undefined, SystemRoot: 'D:\\Win', SYSTEMROOT: 'D:\\Win' }, () => {
    assert.equal(win32job.taskFilePath('ava', null), path.join('D:\\Win', 'System32', 'Tasks', 'Kosmos', 'agent-ava'));
  });
});

test('#8454 a sandboxed board never stats the real Tasks folder: it reads its own, as linuxjob keeps its units', () => {
  withEnv({ AGENT_WORKFORCE_LAUNCH: path.join('sandbox', 'launch') }, () => {
    const at = win32job.taskFilePath('ava', null);
    assert.equal(at, path.join('sandbox', 'launch', 'win32-tasks', 'Kosmos', 'agent-ava'));
    assert.ok(!/System32/i.test(at), 'a sandboxed board named the real Tasks folder: ' + at);
  });
});

test('#8454 the file is named for the task, world included, so a named world reads its own agent', () => {
  withEnv({ AGENT_WORKFORCE_LAUNCH: path.join('sandbox', 'launch') }, () => {
    const name = win32job.taskName('ava', 'w2');
    assert.ok(name.startsWith('Kosmos\\agent-'), 'the task name changed shape: ' + name);
    assert.equal(win32job.taskFilePath('ava', 'w2'), path.join('sandbox', 'launch', 'win32-tasks', ...name.split('\\')));
    assert.notEqual(win32job.taskFilePath('ava', 'w2'), win32job.taskFilePath('ava', null), 'two worlds shared one task file');
  });
});
