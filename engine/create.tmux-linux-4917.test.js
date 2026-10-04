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
    assert.equal(create.linuxTmuxBin('linux', { PATH: `${path.dirname(first)}${path.delimiter}${path.join(root, 'second')}` }), first);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('#4917 Linux ignores a present but non-executable tmux', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-tmux-linux-mode-'));
  try {
    const badDir = path.join(root, 'bad');
    const goodDir = path.join(root, 'good');
    fs.mkdirSync(badDir, { recursive: true });
    const bad = path.join(badDir, 'tmux');
    fs.writeFileSync(bad, 'not executable', { mode: 0o644 });
    const good = executable(goodDir);
    assert.equal(create.linuxTmuxBin('linux', { PATH: `${badDir}${path.delimiter}${goodDir}` }), good);
    assert.equal(create.linuxTmuxBin('linux', { PATH: badDir }, () => false), null);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('#4917 Linux discovers tmux in snap or linuxbrew directories when missing from PATH', () => {
  const snapTmux = path.join('/snap/bin', 'tmux');
  const linuxbrewTmux = path.join('/home/linuxbrew/.linuxbrew/bin', 'tmux');
  assert.equal(create.linuxTmuxBin('linux', { PATH: '' }, (p) => p === snapTmux), snapTmux);
  assert.equal(create.linuxTmuxBin('linux', { PATH: '' }, (p) => p === linuxbrewTmux), linuxbrewTmux);
});

test('#4917 explicit tmux paths stay authoritative on every platform', () => {
  for (const platform of ['linux', 'darwin', 'win32']) {
    assert.equal(create.binPaths({ platform, tmuxBin: '/chosen/tmux' }).tmuxBin, '/chosen/tmux');
  }
});

test('#4917 Mac and Windows keep the Homebrew fallback when no override is set', () => {
  for (const platform of ['darwin', 'win32']) {
    assert.equal(create.linuxTmuxBin(platform, { PATH: '/somewhere/else' }), null);
    assert.equal(create.binPaths({ platform }).tmuxBin, process.env.AGENT_WORKFORCE_TMUX_BIN || '/opt/homebrew/bin/tmux');
  }
});
