'use strict';

/**
 * kosmos#2066 -- /api/status carries `sourceChannel` for the board's build marker.
 *
 * The channel is NOT baked into the artifact (#2036's same-bytes-promotion
 * invariant): the install/update side records which pointer it fetched from into
 * `<store.ROOT>/source-channel`, and the server reads it. This pins the read seam:
 *  - no file            -> 'prod' (every real install today; a missing file is prod, never blank)
 *  - 'staging'          -> 'staging'
 *  - 'STAGING\n' / ' Staging ' -> 'staging' (trimmed + lowercased)
 *  - anything unexpected -> 'prod' (a corrupt file can never paint a loud STAGING badge)
 *
 * Real server against a sandboxed store (AGENT_WORKFORCE_DATA), same fixture
 * discipline + launchd/tmux seams as server.offline-nextmove.test.js.
 *
 *   node --test server.sourcechannel-2066.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO = __dirname;

// Boot the real server against a fresh sandbox, optionally seeding the
// source-channel file in the store root the server reads, and return /api/status.
function statusWithChannelFile(content) {
  const sb = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'kosmos-sc-'));
  const dataRoot = nodePath.join(sb, 'data', 'AgentWorkforce'); // store.ROOT resolves here
  fs.mkdirSync(nodePath.join(dataRoot, 'profiles'), { recursive: true });
  fs.mkdirSync(nodePath.join(sb, 'workers'), { recursive: true });
  fs.mkdirSync(nodePath.join(sb, 'launch'), { recursive: true });
  if (content !== undefined) {
    fs.writeFileSync(nodePath.join(dataRoot, 'source-channel'), content);
  }
  const bin = nodePath.join(sb, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(nodePath.join(bin, 'tmux'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });

  const script = `
    const http = require('node:http');
    const app = require(${JSON.stringify(nodePath.join(REPO, 'server.js'))});
    const srv = app.server || app;
    srv.listen(0, '127.0.0.1', () => {
      http.get({ host: '127.0.0.1', port: srv.address().port, path: '/api/status' }, (res) => {
        let s = ''; res.on('data', (d) => { s += d; }); res.on('end', () => {
          process.stdout.write(s);
          srv.close(); process.exit(0);
        });
      });
    });
  `;
  const out = execFileSync(process.execPath, ['-e', script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      AGENT_WORKFORCE_DRY_RUN: '1',
      AGENT_WORKFORCE_TMUX_BIN: nodePath.join(bin, 'tmux'),
      AGENT_WORKFORCE_DATA: nodePath.join(sb, 'data'),
      AGENT_WORKFORCE_WORKERS: nodePath.join(sb, 'workers'),
      AGENT_WORKFORCE_LAUNCH: nodePath.join(sb, 'launch'),
      AGENT_WORKFORCE_PROJECTS: nodePath.join(sb, 'projects'),
    },
  });
  fs.rmSync(sb, { recursive: true, force: true });
  return JSON.parse(out);
}

test('no source-channel file -> prod (the default every real install reads)', () => {
  assert.equal(statusWithChannelFile(undefined).sourceChannel, 'prod');
});

test("'staging' -> staging", () => {
  assert.equal(statusWithChannelFile('staging').sourceChannel, 'staging');
});

test('a channel file is trimmed and lowercased before it is trusted', () => {
  assert.equal(statusWithChannelFile('STAGING\n').sourceChannel, 'staging');
  assert.equal(statusWithChannelFile('  Staging  ').sourceChannel, 'staging');
});

test('an unexpected value folds to prod -- a corrupt file cannot paint STAGING on a prod board', () => {
  for (const bad of ['prod', 'production', 'stage', 'nonprod', 'xyzzy', '', 'staging extra']) {
    assert.equal(statusWithChannelFile(bad).sourceChannel, 'prod',
      JSON.stringify(bad) + ' should read as prod, not staging');
  }
});
