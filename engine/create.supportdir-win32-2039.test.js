'use strict';
/* #2039: create.js's supportDir carried a SECOND copy of the data-root path
   formula with NO win32 branch, so on the first real Windows test it built a
   literal Mac data path on an NTFS disk. store.js already had the ONE
   win32-aware formula (dataRootFor); the fix collapses supportDir to it.
   store.dataroot-570.test.js proves dataRootFor is win32-correct; this pins that
   create DELEGATES to it rather than re-deriving -- behaviourally (the args it
   passes) AND structurally (no second copy), because supportDir reads
   process.platform and so its WINDOWS output cannot be asserted from a Mac. That
   unassertable-from-here property is exactly how the defect survived, so the
   structural pin is not decoration: it is the only guard that can catch a
   win32-less copy being reintroduced. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const create = require('./create');
const store = require('./store');

const homeDir = () => process.env.AGENT_WORKFORCE_HOME || os.homedir();

test('supportDir delegates to store.dataRootFor with the running platform + env', () => {
  const prev = process.env.AGENT_WORKFORCE_DATA;
  try {
    delete process.env.AGENT_WORKFORCE_DATA;
    assert.equal(create.supportDir(), store.dataRootFor(process.platform, homeDir(), process.env),
      'supportDir no longer returns what store.dataRootFor derives -- a copy has drifted back in');
    // AGENT_WORKFORCE_DATA is the sandbox path every other test relies on; it must
    // survive the collapse unchanged (the branch that WAS byte-identical before).
    process.env.AGENT_WORKFORCE_DATA = nodePath.join(os.tmpdir(), 'aw-supportdir-2039');
    assert.equal(create.supportDir(), store.dataRootFor(process.platform, homeDir(), process.env),
      'supportDir diverged from store.dataRootFor when AGENT_WORKFORCE_DATA is set');
    assert.ok(create.supportDir().endsWith(nodePath.join('aw-supportdir-2039', 'AgentWorkforce')),
      'the sandbox root lost its AgentWorkforce leaf under the collapse');
  } finally {
    if (prev === undefined) delete process.env.AGENT_WORKFORCE_DATA; else process.env.AGENT_WORKFORCE_DATA = prev;
  }
});

test('#2039: supportDir keeps NO second copy of the data-root formula (source-pinned; win32 output is unassertable from a Mac)', () => {
  const src = fs.readFileSync(nodePath.join(__dirname, 'create.js'), 'utf8');
  const at = src.indexOf('function supportDir()');
  assert.ok(at > -1, 'supportDir vanished or was renamed');
  const body = src.slice(at, src.indexOf('\n}', at) + 2);
  assert.match(body, /store\.dataRootFor\(/, 'supportDir stopped delegating to store.dataRootFor');
  /* A re-added copy would build the path itself with `path.join(...)`; the
     delegating version has none. This is the pin that catches the class (a
     second, win32-less formula) coming back -- verified to red on that revert. */
  assert.ok(!/path\.join\(/.test(body),
    'supportDir re-grew its own path.join formula -- the #2039 second-copy defect is back; delegate to store.dataRootFor instead');
});
