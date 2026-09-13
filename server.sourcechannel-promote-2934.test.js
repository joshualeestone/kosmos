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
 * So the board re-derives it from `update.prodPublishesRunning()`, which answers
 * true/false/null off the pointer the updater already polls. ONLY A POSITIVE TRUE
 * darkens the badge; every unknown keeps the recorded stamp, so the re-derivation can
 * turn 'staging' into 'prod' on positive evidence and never the reverse.
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

/**
 * Version arithmetic derived from RUNNING, never hardcoded, so a release bump cannot
 * silently turn these arms into a different experiment.
 *
 * 🛑 IT MUST NOT UNDERFLOW. Decrementing the patch of an `x.y.0` release yields
 * "0.7.-1", which `parts()` rejects, so `readManifest()` returns null, the cache holds
 * no version, and the arm that means to exercise the COMPARISON silently routes through
 * the UNKNOWN rung instead -- passing green while testing nothing it claims to test.
 * So borrow from the minor (and the major) instead, and assert the result parses.
 */
function decrement(v) {
  const p = String(v).trim().split('.').map(Number);
  if (p[2] > 0) return [p[0], p[1], p[2] - 1].join('.');
  if (p[1] > 0) return [p[0], p[1] - 1, 999].join('.');
  return [p[0] - 1, 999, 999].join('.');
}
function increment(v) {
  const p = String(v).trim().split('.').map(Number);
  return [p[0], p[1], p[2] + 1].join('.');
}
const PROD_BEHIND = decrement(RUNNING); // prod publishes something OLDER than us
const PROD_AHEAD = increment(RUNNING);  // prod publishes something NEWER than us

// The guard that makes the underflow above impossible to reintroduce unnoticed: if any
// derived version stops looking like a version, these tests must fail loudly here rather
// than quietly re-route through the unknown rung.
const SEMVER = /^\d+\.\d+\.\d+$/;
for (const [name, v] of [['RUNNING', RUNNING], ['PROD_BEHIND', PROD_BEHIND], ['PROD_AHEAD', PROD_AHEAD]]) {
  assert.match(v, SEMVER, `${name} (${v}) must parse as x.y.z or the arms below test a different rung`);
}

/**
 * Boot the real server against a fresh sandbox, seed the source-channel file, and
 * populate the updater's cache through its REAL refresh() path with an injected
 * fetcher -- so the cache carries the shape production writes (a validated manifest
 * object, and the channel the look went to), not a hand-built stand-in.
 *
 * latest: a version string to serve, or null for "the host could not be reached".
 * look:   pass false to skip refresh() entirely -- the never-looked state a real board
 *         serves in the window between boot and its first poll landing.
 */
function statusWith({ content, latest, channel, look = true }) {
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
    const LOOK = ${JSON.stringify(look)};
    // Never let a look try to install anything in a sandbox.
    updates.setAutoPref(() => false);
    updates.setInstalledRoot(() => null);
    updates.setFetcher(async () => {
      if (LATEST === null) throw new Error('offline');
      return { ok: true, json: async () => ({ version: LATEST }) };
    });
    const srv = app.server || app;
    (async () => {
      // poke()/refresh() reject on an unreachable host; production catches it too and the
      // miss stamp is written in refresh()'s finally.
      if (LOOK) await updates.refresh().catch(() => {});
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
  // An operator running the suite on a staging-subscribed box must not change the answer.
  delete env.AGENT_WORKFORCE_UPDATE_CHANNEL;
  delete env.KOSMOS_UPDATE_CHANNEL;
  if (channel) env.AGENT_WORKFORCE_UPDATE_CHANNEL = channel;

  const out = execFileSync(process.execPath, ['-e', script], { encoding: 'utf8', env });
  fs.rmSync(sb, { recursive: true, force: true });
  return JSON.parse(out);
}

// ---- THE REPORTED BOX -------------------------------------------------------------

test('THE CARD: installed from staging, build since promoted -- prod publishes our exact version -> prod', () => {
  const got = statusWith({ content: 'staging', latest: RUNNING }).sourceChannel;
  assert.equal(got, 'prod',
    'the prod pointer naming our exact version means our bytes ARE the prod bytes (#2036: same bytes promoted)');
});

// ---- THE CASES THE BADGE EXISTS FOR, which must survive the fix --------------------

test('we are NEWER than what prod publishes -> staging (unpromoted pre-release bytes)', () => {
  const got = statusWith({ content: 'staging', latest: PROD_BEHIND }).sourceChannel;
  assert.equal(got, 'staging',
    'a box ahead of prod is exactly what the STAGING badge is for; darkening it here is the regression');
});

test('prod publishes something NEWER but DIFFERENT -> staging, because ">=" is not "our bytes shipped"', () => {
  const got = statusWith({ content: 'staging', latest: PROD_AHEAD }).sourceChannel;
  assert.equal(got, 'staging',
    'an ABANDONED staging build while prod moved on satisfies >= yet never reached prod; only equality is sound');
});

// ---- EVERY UNKNOWN KEEPS THE RECORDED STAMP ---------------------------------------

test('never looked yet (boot, before the first poll lands) -> keeps the recorded stamp', () => {
  const got = statusWith({ content: 'staging', latest: RUNNING, look: false }).sourceChannel;
  assert.equal(got, 'staging',
    'an empty cache must not be read as evidence about prod');
});

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

// ---- THE PREDICATE ITSELF, unit-level ---------------------------------------------

test('prodPublishesRunning: true ONLY on exact equality, null for every unknown', async () => {
  const updates = require('./engine/update');
  updates.setAutoPref(() => false);
  updates.setInstalledRoot(() => null);

  const look = async (version, { throws = false } = {}) => {
    updates.resetCache();
    updates.setFetcher(async () => {
      if (throws) throw new Error('offline');
      return { ok: true, json: async () => ({ version }) };
    });
    await updates.refresh().catch(() => {});
  };

  updates.resetCache();
  assert.equal(updates.prodPublishesRunning(), null, 'never looked -> null, not false');

  await look(RUNNING);
  assert.equal(updates.prodPublishesRunning(), true, 'exact equality is the only true');

  await look(PROD_AHEAD);
  assert.equal(updates.prodPublishesRunning(), false, 'prod ahead is NOT evidence our bytes shipped');

  await look(PROD_BEHIND);
  assert.equal(updates.prodPublishesRunning(), false);

  await look(null, { throws: true });
  assert.equal(updates.prodPublishesRunning(), null, 'unreachable -> null, never false');

  await look('not-a-version');
  assert.equal(updates.prodPublishesRunning(), null, 'an unreadable pointer -> null');

  updates.resetCache();
});
