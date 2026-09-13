'use strict';

/**
 * kosmos#2934 -- a prod-aligned board must not report sourceChannel: 'staging'.
 *
 * `<store.ROOT>/source-channel` is a ONE-TIME INSTALL STAMP: setup.sh writes which
 * pointer the install fetched from, and #2036's same-bytes-promotion invariant means a
 * promote moves no bytes on an installed box, so nothing ever re-runs to rewrite it. A
 * box that installed from staging and then had its build promoted keeps saying 'staging'
 * forever, which is what the mortals box measured at 0.6.59 (installed and served both
 * prod, both pointers on the same sha, a loud STAGING badge).
 *
 * So the board re-derives it: staging means THESE BYTES ARE AHEAD OF PROD, computed from
 * the prod pointer version the updater already caches. Every rung falls back to the
 * recorded stamp, so the re-derivation can only ever turn 'staging' into 'prod' on
 * positive evidence that prod caught up -- never the reverse.
 *
 *   node --test server.sourcechannel-promote-2934.test.js
 */

const test = require('node:test');
const store = require('./engine/store');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO = __dirname;
const RUNNING = require('./package.json').version;

// The version arithmetic is derived from the RUNNING version, never hardcoded: a release
// bump must not silently turn these arms into a different experiment.
function bump(v, delta) {
  const p = String(v).trim().split('.').map(Number);
  p[2] += delta;
  return p.join('.');
}
const PROD_BEHIND = bump(RUNNING, -1); // prod has NOT caught up: we are pre-release
const PROD_AHEAD = bump(RUNNING, +1);  // prod is past us entirely

/**
 * Boot the real server against a fresh sandbox, seed the source-channel file, and
 * populate the updater's cache through its REAL refresh() path with an injected
 * fetcher -- so the cache carries the same shape production writes (a validated
 * manifest object, and the channel the look went to), not a hand-built stand-in.
 *
 * latest: a version string to serve, or null for "the host could not be reached".
 */
function statusWith({ content, latest, channel }) {
  const sb = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'kosmos-sc2934-'));
  const dataRoot = nodePath.join(sb, 'data', store.APP);
  fs.mkdirSync(nodePath.join(dataRoot, 'profiles'), { recursive: true });
  fs.mkdirSync(nodePath.join(sb, 'workers'), { recursive: true });
  fs.mkdirSync(nodePath.join(sb, 'launch'), { recursive: true });
  if (content !== undefined) fs.writeFileSync(nodePath.join(dataRoot, 'source-channel'), content);
  const bin = nodePath.join(sb, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(nodePath.join(bin, 'tmux'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });

  const script = `
    const http = require('node:http');
    const app = require(${JSON.stringify(nodePath.join(REPO, 'server.js'))});
    const updates = require(${JSON.stringify(nodePath.join(REPO, 'engine', 'update.js'))});
    const LATEST = ${JSON.stringify(latest)};
    // Never let a look try to install anything in a sandbox.
    updates.setAutoPref(() => false);
    updates.setInstalledRoot(() => null);
    updates.setFetcher(async () => {
      if (LATEST === null) throw new Error('offline');
      return { ok: true, json: async () => ({ version: LATEST }) };
    });
    const srv = app.server || app;
    (async () => {
      await updates.refresh().catch(() => { /* poke() catches too; the miss stamp is in refresh's finally */ });
      srv.listen(0, '127.0.0.1', () => {
        http.get({ host: '127.0.0.1', port: srv.address().port, path: '/api/status' }, (res) => {
          let s = ''; res.on('data', (d) => { s += d; }); res.on('end', () => {
            process.stdout.write(s);
            srv.close(); process.exit(0);
          });
        });
      });
    })();
  `;
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    AGENT_WORKFORCE_DRY_RUN: '1',
    AGENT_WORKFORCE_TMUX_BIN: nodePath.join(bin, 'tmux'),
    AGENT_WORKFORCE_DATA: nodePath.join(sb, 'data'),
    AGENT_WORKFORCE_WORKERS: nodePath.join(sb, 'workers'),
    AGENT_WORKFORCE_LAUNCH: nodePath.join(sb, 'launch'),
    AGENT_WORKFORCE_PROJECTS: nodePath.join(sb, 'projects'),
  };
  delete env.AGENT_WORKFORCE_UPDATE_CHANNEL;
  delete env.KOSMOS_UPDATE_CHANNEL;
  if (channel) env.AGENT_WORKFORCE_UPDATE_CHANNEL = channel;

  const out = execFileSync(process.execPath, ['-e', script], { encoding: 'utf8', env });
  fs.rmSync(sb, { recursive: true, force: true });
  return JSON.parse(out);
}

// ---- THE REPORTED BOX -------------------------------------------------------------

test('THE CARD: installed from staging, build since promoted -- prod pointer names our exact version -> prod', () => {
  const got = statusWith({ content: 'staging', latest: RUNNING }).sourceChannel;
  assert.equal(got, 'prod',
    'a board whose running version is the one prod publishes is a prod board; the install stamp is stale');
});

test('prod has moved PAST us -- our bytes are certainly on prod -> prod', () => {
  assert.equal(statusWith({ content: 'staging', latest: PROD_AHEAD }).sourceChannel, 'prod');
});

// ---- THE CASE THE BADGE EXISTS FOR, which must survive the fix ---------------------

test('genuinely pre-release: we are NEWER than what prod publishes -> staging', () => {
  const got = statusWith({ content: 'staging', latest: PROD_BEHIND }).sourceChannel;
  assert.equal(got, 'staging',
    'a box ahead of prod is exactly what the STAGING badge is for; darkening it here is the regression');
});

// ---- EVERY FALLBACK KEEPS TODAY'S BEHAVIOR ----------------------------------------

test('host unreachable -- no cached prod version to compare -> keeps the recorded stamp', () => {
  assert.equal(statusWith({ content: 'staging', latest: null }).sourceChannel, 'staging');
});

test('polling the STAGING pointer -- its version says nothing about prod -> keeps the stamp', () => {
  const got = statusWith({ content: 'staging', latest: RUNNING, channel: 'staging' }).sourceChannel;
  assert.equal(got, 'staging',
    'comparing a staging pointer version against RUNNING would answer a different question');
});

test('a prod stamp is never re-derived into staging, whatever the cache says', () => {
  for (const latest of [PROD_BEHIND, RUNNING, PROD_AHEAD, null]) {
    assert.equal(statusWith({ content: 'prod', latest }).sourceChannel, 'prod');
  }
  assert.equal(statusWith({ content: undefined, latest: PROD_BEHIND }).sourceChannel, 'prod');
});

// ---- #2066's contract, re-asserted against the new code path ----------------------

test('#2066 still holds: trimmed, lowercased, and anything unexpected folds to prod', () => {
  assert.equal(statusWith({ content: 'STAGING\n', latest: PROD_BEHIND }).sourceChannel, 'staging');
  assert.equal(statusWith({ content: '  Staging  ', latest: PROD_BEHIND }).sourceChannel, 'staging');
  for (const bad of ['production', 'stage', 'xyzzy', '', 'staging extra']) {
    assert.equal(statusWith({ content: bad, latest: PROD_BEHIND }).sourceChannel, 'prod',
      JSON.stringify(bad) + ' must not paint STAGING');
  }
});

// ---- THE SHAPE TRAP, asserted directly ---------------------------------------------

test('cachedLatestVersion returns a STRING newer() can actually compare, not the manifest object', () => {
  const updates = require('./engine/update');
  updates.resetCache();
  updates.setAutoPref(() => false);
  updates.setInstalledRoot(() => null);
  updates.setFetcher(async () => ({ ok: true, json: async () => ({ version: PROD_BEHIND }) }));
  return updates.refresh().catch(() => {}).then(() => {
    const v = updates.cachedLatestVersion();
    assert.equal(typeof v, 'string', 'the manifest object would make newer() return false for every input');
    assert.equal(v, PROD_BEHIND);
    assert.equal(updates.newer(RUNNING, v), true,
      'this is the comparison the board makes; if it cannot fire, the badge darkens on a pre-release box');
    assert.equal(updates.cachedChannel(), 'prod');
    updates.resetCache();
  });
});
