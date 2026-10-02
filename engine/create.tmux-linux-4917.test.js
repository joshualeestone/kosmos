'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const create = require('./create');

function executable(dir, name = 'tmux') {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  return file;
}

test('#4917 Linux resolves tmux from PATH before the usual system locations', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-tmux-linux-'));
  try {
    const first = executable(path.join(root, 'first'));
    executable(path.join(root, 'second'));
    assert.equal(create.binPaths({ platform: 'linux', env: { PATH: `${path.dirname(first)}${path.delimiter}${path.join(root, 'second')}` } }).tmuxBin, first);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('#4917 Linux ignores a present but non-executable tmux', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-tmux-linux-mode-'));
  try {
    const bad = path.join(root, 'tmux');
    fs.writeFileSync(bad, 'not executable', { mode: 0o644 });
    assert.notEqual(create.binPaths({ platform: 'linux', env: { PATH: root } }).tmuxBin, bad);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('#4917 explicit tmux paths stay authoritative on every platform', () => {
  for (const platform of ['linux', 'darwin', 'win32']) {
    assert.equal(create.binPaths({ platform, tmuxBin: '/chosen/tmux', env: { PATH: '/ignored' } }).tmuxBin, '/chosen/tmux');
    assert.equal(create.binPaths({ platform, env: { AGENT_WORKFORCE_TMUX_BIN: '/env/tmux', PATH: '/ignored' } }).tmuxBin, '/env/tmux');
  }
});

test('#4917 Mac and Windows keep the Homebrew fallback when no override is set', () => {
  for (const platform of ['darwin', 'win32']) {
    assert.equal(create.binPaths({ platform, env: { PATH: '/somewhere/else' } }).tmuxBin, '/opt/homebrew/bin/tmux');
  }
});
