'use strict';
/**
 * #3660 fallback (Josh, 2026-09-25 07:22): the setup assistant uses the person's own model, and falls
 * back to the hosted assistant only while their guide cannot answer (the three states #3723 surfaces).
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-guide-fallback-')));
process.env.AGENT_WORKFORCE_HOME = path.join(SANDBOX, 'home');
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const sa = require('./setup-assistant');

test.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));

const withModel = () => ({ rows: [{ provider: 'openai' }], failed: false });
const noModel = () => ({ rows: [], failed: false });
const there = () => true;

test('#3660 guideFailure: the three #3723 states are a failure, with the runner; every other state is not', () => {
  for (const state of ['rate_limited', 'auth_failed', 'connection_lost']) {
    assert.deepEqual(sa.guideFailure({ state, runner: 'codex' }), { problem: state, runner: 'codex' }, state);
  }
  for (const state of ['working', 'idle', 'needs_you', 'restarting', 'stopped', 'unknown', 'blocked']) {
    assert.equal(sa.guideFailure({ state, runner: 'codex' }), null, state + ' read as their model failing');
  }
  assert.equal(sa.guideFailure(null), null, 'no card is not a failure');
  assert.equal(sa.guideFailure({ state: 'auth_failed' }).runner, null, 'a card with no runner does not invent one');
});

test('#3660 hostedWhy: with a model of their own, hosted only while the guide is failing', () => {
  assert.deepEqual(sa.hostedWhy({ available: there, listed: withModel, failing: () => null }), { ok: false, why: 'own_model' },
    'CONTROL: a working model of their own is not the hosted path');
  assert.deepEqual(sa.hostedWhy({ available: there, listed: withModel, failing: () => ({ problem: 'rate_limited', runner: 'codex' }) }),
    { ok: true, why: 'own_model_failing' }, 'a failing guide did not fall back');
  assert.deepEqual(sa.hostedWhy({ available: there, listed: noModel }), { ok: true, why: null }, 'CONTROL: no model at all is still hosted');
});

test('#3660 hostedWhy: no connector wins over a failing guide; an unreadable listing does not block the fallback', () => {
  const failing = () => ({ problem: 'auth_failed', runner: 'claude' });
  assert.deepEqual(sa.hostedWhy({ available: () => false, listed: withModel, failing }), { ok: false, why: 'no_connector' });
  assert.deepEqual(sa.hostedWhy({ available: there, listed: () => { throw new Error('unreadable'); }, failing }), { ok: true, why: 'own_model_failing' },
    'a failing guide was kept from the fallback because the account list could not be read');
  assert.deepEqual(sa.hostedWhy({ available: there, listed: () => { throw new Error('unreadable'); }, failing: () => null }), { ok: false, why: 'unchecked' },
    'CONTROL: with no failing guide an unreadable listing is still unchecked');
  assert.deepEqual(sa.hostedWhy({ available: there, listed: withModel, failing: () => { throw new Error('board'); } }), { ok: false, why: 'own_model' },
    'a failure reading the guide is not taken as the guide failing');
});
