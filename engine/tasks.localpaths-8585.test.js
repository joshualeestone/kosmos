'use strict';
/**
 * kosmos#8585: one helper, tasks.withoutLocalPaths, makes "a task without this computer's paths" for every view that
 * leaves them out (the project rows, the Tasks view, the page's task answers). It names the path-bearing fields once:
 * the delivered file's (builtFilePath), the replaced file's (builtReplaces.filePath) and a landed commit's repository
 * (landedRepo). The guard below keeps anyone from stripping one of them by hand again somewhere else.
 *
 *   node --test engine/tasks.localpaths-8585.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const tasks = require('./tasks');

const FULL = {
  number: 4, sentence: 'Fix it', builtAt: '2026-11-16T10:00:00.000Z', builtFingerprint: 'sha256:' + 'a'.repeat(64),
  builtFilePath: '/Users/someone/deck-v2.pdf',
  builtReplaces: { fingerprint: 'sha256:' + 'b'.repeat(64), filePath: '/Users/someone/deck-v1.pdf' },
  landedCommit: 'c'.repeat(40), landedRepo: '/Users/someone/repo', landedOnRemote: false,
};

test('#8585: every path-bearing field leaves; everything else stays', () => {
  const out = tasks.withoutLocalPaths(FULL);
  assert.equal('builtFilePath' in out, false, 'the delivered file\'s path stayed');
  assert.equal('filePath' in out.builtReplaces, false, 'the replaced file\'s path stayed');
  assert.equal('landedRepo' in out, false, 'the repository path stayed');
  assert.equal(JSON.stringify(out).includes('/Users/someone'), false, 'a path on this computer stayed: ' + JSON.stringify(out));
  assert.equal(out.builtFingerprint, FULL.builtFingerprint, 'CONTROL: the fingerprint is kept');
  assert.equal(out.builtReplaces.fingerprint, FULL.builtReplaces.fingerprint, 'CONTROL: what it replaced is still said');
  assert.equal(out.landedCommit, FULL.landedCommit, 'CONTROL: the commit is kept');
  assert.equal(out.landedOnRemote, false, 'CONTROL: whether a remote has it is kept');
});

test('#8585: a copy, so the stored task keeps its paths; a non-object passes through', () => {
  const stored = JSON.parse(JSON.stringify(FULL));
  tasks.withoutLocalPaths(stored);
  assert.deepEqual(stored, FULL, 'the stored task was changed');
  assert.equal(tasks.withoutLocalPaths(null), null);
  assert.equal(tasks.withoutLocalPaths(undefined), undefined);
});

/* The guard: outside engine/tasks.js, no source deletes one of these fields by hand, so a fourth path-bearing field
   needs adding in one place only. Scans the board's own sources (server.js and engine/, tests excluded). */
test('#8585: no source strips a path-bearing field by hand outside tasks.withoutLocalPaths (source guard)', () => {
  const root = path.join(__dirname, '..');
  const files = [path.join(root, 'server.js')].concat(
    fs.readdirSync(__dirname).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js') && f !== 'tasks.js').map((f) => path.join(__dirname, f)));
  assert.ok(files.length > 20, 'CONTROL: the scan found the board\'s sources (found ' + files.length + ')');
  const bad = [];
  for (const f of files) {
    fs.readFileSync(f, 'utf8').split('\n').forEach((l, i) => {
      if (/delete\s+[\w.[\]]+\.(landedRepo|builtFilePath)\b/.test(l)) bad.push(path.relative(root, f) + ':' + (i + 1) + ': ' + l.trim());
    });
  }
  assert.deepEqual(bad, [], 'strip these through tasks.withoutLocalPaths instead:\n' + bad.join('\n'));
});
