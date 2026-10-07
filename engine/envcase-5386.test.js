'use strict';
/**
 * kosmos#5386: modules that copy process.env for a child remove and set names through engine/win32env.js, so an
 * inherited spelling (Claude_Config_Dir, xai_api_key) cannot survive a plain `delete env.X` or sit beside a new key.
 * A copy keeps names as spelled; on Windows any one of them is the variable the child reads.
 *
 *   node --test engine/envcase-5386.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const FILES = ['subscription.js', 'orgchartfile.js', 'codexsigninlive.js', 'grokaccounts.js', 'create.js', 'boardrestart.js',
  'win32launch.js', 'win32agy.js', 'win32keyed.js', 'win32codex.js'];

test('#5386: no plain delete on an env copy in the modules that build a child\'s environment', () => {
  for (const f of FILES) {
    const code = fs.readFileSync(path.join(__dirname, f), 'utf8').split('\n')
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    assert.deepEqual(code.match(/\bdelete env(\.|\[)/g) || [], [], f + ': use envDelete (engine/win32env.js), not a plain delete');
  }
});

test('#5386: the scan can fail (control)', () => {
  assert.equal(('  delete env.CLAUDE_CONFIG_DIR;'.match(/\bdelete env(\.|\[)/g) || []).length, 1);
});
