'use strict';

/**
 * kosmos#2036 -- the boot-time silent-revert diagnostic (observability slice).
 *
 * A box INSTALLED from the staging channel but RESOLVING prod has silently lost its
 * staging subscription at login (kosmos#2969): the board's launchd job carries no update
 * channel, so updateChannel() falls back to prod and the box quietly stops being ahead of
 * prod, with no error. `stagingRevertWarning(recorded, resolved)` is the pure predicate the
 * boot diagnostic fires on; the warn itself lives inside the listen callback, which a
 * require-only test never reaches, so the predicate is the testable seam.
 *
 * The signature is EXACTLY one of the four combinations: installed-from-staging yet
 * polling-prod. The other three are negative controls, and each is a real, correct state:
 *  - (staging, staging): a healthy staging subscriber. No warn.
 *  - (prod, prod): a plain prod box. No warn.
 *  - (prod, staging): installed from prod but deliberately pointed at staging (an explicit
 *    override, e.g. a tester who set the channel). NOT the #2969 silence, so no warn -- the
 *    predicate must not fire here, or it would cry wolf on an intentional staging aim.
 *
 * `recorded` is the RAW install stamp (recordedSourceChannel), never sourceChannelNow()'s
 * #2934-rederived badge, which would report 'prod' for a legitimately-promoted staging build
 * and mask a genuine revert. That distinction is documented at the predicate; this test pins
 * only the four-way truth table.
 *
 *   node --test server.staging-revert-warn-2036.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { stagingRevertWarning } = require('./server');

test('the silent-revert signature (installed staging, resolving prod) warns', () => {
  assert.equal(stagingRevertWarning('staging', 'prod'), true);
});

test('a healthy staging subscriber (installed staging, resolving staging) does not warn', () => {
  assert.equal(stagingRevertWarning('staging', 'staging'), false);
});

test('a plain prod box (installed prod, resolving prod) does not warn', () => {
  assert.equal(stagingRevertWarning('prod', 'prod'), false);
});

test('a prod box deliberately aimed at staging (installed prod, resolving staging) does not warn', () => {
  // The #2969 failure is a LOST staging subscription, not a gained one. An override toward
  // staging is intentional, not the silent revert, so the diagnostic must stay quiet.
  assert.equal(stagingRevertWarning('prod', 'staging'), false);
});

test('only the staging->prod combination is the revert (exhaustive truth table)', () => {
  const channels = ['staging', 'prod'];
  const fired = [];
  for (const recorded of channels) {
    for (const resolved of channels) {
      if (stagingRevertWarning(recorded, resolved)) fired.push(`${recorded}->${resolved}`);
    }
  }
  assert.deepEqual(fired, ['staging->prod']);
});

/*
 * The WIRING, not just the predicate. The truth table above cannot protect the one choice that
 * matters: that the boot site reads recordedSourceChannel() (the RAW install stamp) and NOT
 * sourceChannelNow() (the #2934-rederived badge). A future edit swapping the accessor would keep
 * every truth-table test green while silently defeating the diagnostic, so we exercise the no-arg
 * stagingRevertWarningNow() in the ONE state where the two accessors diverge: a legitimately
 * promoted staging build (installed from staging, and prod now publishes this exact version). The
 * sandbox + injected-fetcher setup mirrors server.sourcechannel-promote-2934.test.js so the
 * updater's cache carries the shape production writes, not a hand-built stand-in.
 */
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO = __dirname;
const RUNNING = require('./package.json').version;

function warnNowWith({ content, latest, channel, look = true }) {
  const sb = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'kosmos-revert2036-'));
  const store = require('./engine/store');
  const dataRoot = nodePath.join(sb, 'data', store.APP);
  fs.mkdirSync(nodePath.join(dataRoot, 'profiles'), { recursive: true });
  fs.mkdirSync(nodePath.join(sb, 'workers'), { recursive: true });
  fs.mkdirSync(nodePath.join(sb, 'launch'), { recursive: true });
  if (content !== undefined) fs.writeFileSync(nodePath.join(dataRoot, 'source-channel'), content);
  const bin = nodePath.join(sb, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(nodePath.join(bin, 'tmux'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });

  const script = `
    const app = require(${JSON.stringify(nodePath.join(REPO, 'server.js'))});
    const updates = require(${JSON.stringify(nodePath.join(REPO, 'engine', 'update.js'))});
    const LATEST = ${JSON.stringify(latest)};
    const LOOK = ${JSON.stringify(look)};
    updates.setAutoPref(() => false);
    updates.setInstalledRoot(() => null);
    updates.setFetcher(async () => {
      if (LATEST === null) throw new Error('offline');
      return { ok: true, json: async () => ({ version: LATEST }) };
    });
    (async () => {
      if (LOOK) await updates.refresh().catch(() => {});
      process.stdout.write(JSON.stringify({
        warn: app.stagingRevertWarningNow(),
        badge: app.sourceChannelNow(),
        resolved: updates.updateChannel(),
      }));
      process.exit(0);
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

  try {
    return JSON.parse(execFileSync(process.execPath, ['-e', script], { encoding: 'utf8', env }));
  } finally {
    fs.rmSync(sb, { recursive: true, force: true });
  }
}

test('WIRING: a promoted staging build (installed staging, prod publishes our version, no channel env) still warns -- because the boot site reads the raw stamp, not the #2934 badge', () => {
  const got = warnNowWith({ content: 'staging', latest: RUNNING });
  // The divergence that makes this test meaningful: the badge re-derives to 'prod' here...
  assert.equal(got.badge, 'prod', 'a promoted staging build reads prod on the #2934 badge (sourceChannelNow)');
  assert.equal(got.resolved, 'prod', 'with no channel env the poller resolves prod (the #2969 revert)');
  // ...yet the warn MUST still fire, because it is wired to the raw install stamp. If a future
  // edit swaps recordedSourceChannel() -> sourceChannelNow(), this flips to false and fails.
  assert.equal(got.warn, true, 'the raw install stamp is still staging, so the silent revert is surfaced');
});

test('WIRING: a healthy staging subscriber (installed staging, channel env still staging) does not warn', () => {
  const got = warnNowWith({ content: 'staging', latest: RUNNING, channel: 'staging' });
  assert.equal(got.resolved, 'staging', 'the channel env survived, so the poller resolves staging');
  assert.equal(got.warn, false, 'still on staging: nothing reverted, no warn');
});

test('WIRING: a plain prod box (no source-channel stamp) does not warn', () => {
  const got = warnNowWith({ content: undefined, latest: RUNNING });
  assert.equal(got.warn, false, 'never installed from staging, so there is no revert to report');
});
