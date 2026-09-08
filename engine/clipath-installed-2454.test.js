'use strict';
/**
 * #2454: installedKosmosCli() is the safety GATE for the board's `kosmos restart`
 * self-restart (engine/boardrestart). It must return a path ONLY when the installed
 * layout is positively present, and null otherwise -- a false positive there would
 * let a from-source board be stopped (and never come back). It probes a supplied
 * root so the test never touches a real install.
 *
 *   node --test engine/clipath-installed-2454.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { installedKosmosCli } = require('./clipath');

function mkroot() { return fs.mkdtempSync(path.join(os.tmpdir(), 'aw-clipath-2454-')); }
function touch(p) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, ''); }

test('returns the installed cli path when BOTH bin/kosmos and app/server.js exist', () => {
  const root = mkroot();
  touch(path.join(root, 'bin', 'kosmos'));
  touch(path.join(root, 'app', 'server.js'));
  assert.equal(installedKosmosCli(root), path.join(root, 'bin', 'kosmos'));
  fs.rmSync(root, { recursive: true, force: true });
});

test('null when bin/kosmos is present but app/server.js is NOT (the conjunction is the guard)', () => {
  const root = mkroot();
  touch(path.join(root, 'bin', 'kosmos'));
  assert.equal(installedKosmosCli(root), null);
  fs.rmSync(root, { recursive: true, force: true });
});

test('null when app/server.js is present but bin/kosmos is NOT (a from-source repo parent)', () => {
  const root = mkroot();
  touch(path.join(root, 'app', 'server.js'));
  assert.equal(installedKosmosCli(root), null);
  fs.rmSync(root, { recursive: true, force: true });
});

test('null on an empty root (no install, no source) -- never a bare-word fallback', () => {
  const root = mkroot();
  assert.equal(installedKosmosCli(root), null);
  fs.rmSync(root, { recursive: true, force: true });
});
