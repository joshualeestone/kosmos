'use strict';
require('../test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const signedin = require('./signedin');

const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'signedin-7748-'));

test('#7748: GitHub reads gh\'s hosts file, and only a github.com entry counts', () => {
  const d = dir();
  const env = { GH_CONFIG_DIR: d };
  assert.equal(signedin.github({ env }), false, 'no file');
  fs.writeFileSync(path.join(d, 'hosts.yml'), 'gitlab.example.com:\n  user: x\n');
  assert.equal(signedin.github({ env }), false, 'another host');
  fs.writeFileSync(path.join(d, 'hosts.yml'), 'github.com:\n  git_protocol: ssh\n');
  assert.equal(signedin.github({ env }), false, 'a host with settings and no account');
  fs.writeFileSync(path.join(d, 'hosts.yml'), 'github.com:\n  git_protocol: ssh\nother.example:\n  user: x\n');
  assert.equal(signedin.github({ env }), false, 'an account under the next host is not this one');
  fs.writeFileSync(path.join(d, 'hosts.yml'), 'github.com:\n  user: x\n');
  assert.equal(signedin.github({ env }), true);
  fs.writeFileSync(path.join(d, 'hosts.yml'), 'github.com:\n  git_protocol: https\n  users:\n    x:\n');
  assert.equal(signedin.github({ env }), true, 'the newer shape, with a users list');
});

test('#7748: the default gh folder follows the platform', () => {
  const home = dir();
  fs.mkdirSync(path.join(home, '.config', 'gh'), { recursive: true });
  fs.writeFileSync(path.join(home, '.config', 'gh', 'hosts.yml'), 'github.com:\n  user: x\n');
  assert.equal(signedin.github({ env: {}, platform: 'darwin', home }), true);
  assert.equal(signedin.github({ env: {}, platform: 'win32', home }), false);
  fs.mkdirSync(path.join(home, 'AppData', 'Roaming', 'GitHub CLI'), { recursive: true });
  fs.writeFileSync(path.join(home, 'AppData', 'Roaming', 'GitHub CLI', 'hosts.yml'), 'github.com:\r\n  user: x\r\n');
  assert.equal(signedin.github({ env: {}, platform: 'win32', home }), true, 'a CRLF file');
});

test('#7748: Vercel reads a token from its auth file', () => {
  const d = dir();
  const env = { AGENT_WORKFORCE_VERCEL_CONFIG_DIR: d };
  assert.equal(signedin.vercel({ env }), false, 'no file');
  fs.writeFileSync(path.join(d, 'auth.json'), 'not json');
  assert.equal(signedin.vercel({ env }), false, 'garbage');
  fs.writeFileSync(path.join(d, 'auth.json'), '{"token":""}');
  assert.equal(signedin.vercel({ env }), false, 'an empty token');
  fs.writeFileSync(path.join(d, 'auth.json'), '{"token":"t"}');
  assert.equal(signedin.vercel({ env }), true);
});

test('#7748: the default Vercel folder follows the platform', () => {
  const home = dir();
  const mac = path.join(home, 'Library', 'Application Support', 'com.vercel.cli');
  fs.mkdirSync(mac, { recursive: true });
  fs.writeFileSync(path.join(mac, 'auth.json'), '{"token":"t"}');
  assert.equal(signedin.vercel({ env: {}, platform: 'darwin', home }), true);
  assert.equal(signedin.vercel({ env: {}, platform: 'linux', home }), false);
  const win = path.join(home, 'AppData', 'Roaming', 'xdg.data', 'com.vercel.cli');
  fs.mkdirSync(win, { recursive: true });
  fs.writeFileSync(path.join(win, 'auth.json'), '{"token":"t"}');
  assert.equal(signedin.vercel({ env: {}, platform: 'win32', home }), true);
});
