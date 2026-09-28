'use strict';

/**
 * kosmos#2066 -- /api/status carries `sourceChannel` for the board (the federation gate and the
 * data-source-channel stamp; the corner build marker it was first for was removed in #3641).
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
 * 🛑 #2934 CHANGED THE CONTRACT THESE ARMS PIN, AND THE FILE READS AS IF IT DID NOT.
 * `sourceChannel` is no longer the file value alone: a recorded 'staging' is now
 * downgraded to 'prod' when the updater's cache positively shows prod publishing the
 * running version. These arms still pass, but for a reason they do not state -- this
 * harness never warms that cache (nothing injects a fetcher, and the board's own poke()
 * is async and cannot land before the synchronous read), so every 'staging' arm here is
 * exercising the UNKNOWN rung, which keeps the stamp. What this file pins is therefore
 * "the file value, with a cold cache", not "the file value" outright.
 * ⇒ The cache-warm behaviour is covered in server.sourcechannel-promote-2934.test.js.
 * Do not add an arm here that assumes the file alone decides the answer.
 *
 *   node --test server.sourcechannel-2066.test.js
 */

const test = require('node:test');
const store = require('./engine/store');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO = __dirname;

// Boot the real server against a fresh sandbox, optionally seeding the
// source-channel file in the store root the server reads, and return /api/status.
// One child serves every arm in a logical assertion. Requiring the full server
// once per value made the seven-value case spend nearly all its time booting
// seven identical boards; under full-suite CPU contention that crossed 15 s.
function statusesWithChannelFiles(contents) {
  const sb = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'kosmos-sc-'));
  const dataRoot = nodePath.join(sb, 'data', store.APP); // store.ROOT resolves here
  fs.mkdirSync(nodePath.join(dataRoot, 'profiles'), { recursive: true });
  fs.mkdirSync(nodePath.join(sb, 'workers'), { recursive: true });
  fs.mkdirSync(nodePath.join(sb, 'launch'), { recursive: true });
  const sourceFile = nodePath.join(dataRoot, 'source-channel');
  const bin = nodePath.join(sb, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(nodePath.join(bin, 'tmux'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });

  const script = `
    const http = require('node:http');
    const fs = require('node:fs');
    const app = require(${JSON.stringify(nodePath.join(REPO, 'server.js'))});
    const srv = app.server || app;
    const contents = ${JSON.stringify(contents)};
    const sourceFile = ${JSON.stringify(sourceFile)};
    const status = () => new Promise((resolve, reject) => {
      http.get({ host: '127.0.0.1', port: srv.address().port, path: '/api/status' }, (res) => {
        let s = ''; res.on('data', (d) => { s += d; }); res.on('end', () => resolve(JSON.parse(s)));
      }).on('error', reject);
    });
    srv.listen(0, '127.0.0.1', async () => {
      const out = [];
      for (const content of contents) {
        if (content === null) { try { fs.unlinkSync(sourceFile); } catch {} }
        else fs.writeFileSync(sourceFile, content);
        out.push(await status());
      }
      process.stdout.write(JSON.stringify(out));
      srv.close();
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

function statusWithChannelFile(content) {
  return statusesWithChannelFiles([content === undefined ? null : content])[0];
}

test('no source-channel file -> prod (the default every real install reads)', () => {
  assert.equal(statusWithChannelFile(undefined).sourceChannel, 'prod');
});

test("'staging' -> staging", () => {
  assert.equal(statusWithChannelFile('staging').sourceChannel, 'staging');
});

test('a channel file is trimmed and lowercased before it is trusted', () => {
  const got = statusesWithChannelFiles(['STAGING\n', '  Staging  ']);
  assert.deepEqual(got.map((s) => s.sourceChannel), ['staging', 'staging']);
});

test('an unexpected value folds to prod -- a corrupt file cannot paint STAGING on a prod board', () => {
  const badValues = ['prod', 'production', 'stage', 'nonprod', 'xyzzy', '', 'staging extra'];
  const got = statusesWithChannelFiles(badValues);
  for (let i = 0; i < badValues.length; i++) {
    assert.equal(got[i].sourceChannel, 'prod',
      JSON.stringify(badValues[i]) + ' should read as prod, not staging');
  }
});
