'use strict';

/**
 * #1488: with an override home named, the switch picker must not offer rows the
 * engine can only refuse.
 *
 * ⚠️ WHAT THIS FILE CAN AND CANNOT SEE. The predicate arms below EXECUTE real code:
 * `codexupdate.homeIsNamed()` is called, and the page's own filter expression is
 * lifted out of `web/index.html` and RUN against synthetic rows. What it cannot see
 * is the rendered control: whether the menu visibly shrinks is
 * `docs/browser-checks/`'s job, and neither file replaces the other.
 *
 * 🛑 WHY IT EXISTS. The engine collapsed the OpenAI accounts to the named home and
 * refused every other, while the page built its menu from the unfiltered list. Both
 * sides were individually correct and they disagreed, which is the shape no
 * single-file test catches: the guard has to assert that ONE fact is asked in one
 * place.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const SERVER = fs.readFileSync(nodePath.join(__dirname, 'server.js'), 'utf8');
const ENGINE = fs.readFileSync(nodePath.join(__dirname, 'engine', 'create.js'), 'utf8');
const codexupdate = require('./engine/codexupdate');

/* 🛑 POPULATION FLOOR AT MODULE SCOPE, BEFORE ANY TEST RUNS. `assert.doesNotMatch('', /x/)`
   PASSES, so an absence assertion cannot tell "I looked and it is not there" from "I read
   nothing". Presence assertions fail loudly on an empty read; absence ones do not, which is
   why they are the only kind that can be true for no reason. At module scope so it runs even
   though node:test aborts a test at its first failing assertion. */
assert.ok(PAGE.length > 100000, 'web/index.html read short; every assertion below is suspect');
assert.ok(SERVER.length > 50000, 'server.js read short');
assert.ok(ENGINE.length > 20000, 'engine/create.js read short');

test('#1488: homeIsNamed answers the OVERRIDE question, not the default-home question', () => {
  const prevA = process.env.AGENT_WORKFORCE_CODEX_HOME;
  const prevB = process.env.CODEX_HOME;
  const set = (k, v) => { if (v === null) delete process.env[k]; else process.env[k] = v; };
  try {
    set('AGENT_WORKFORCE_CODEX_HOME', null); set('CODEX_HOME', null);
    assert.equal(codexupdate.homeIsNamed(), false, 'unset must not collapse the list');

    set('AGENT_WORKFORCE_CODEX_HOME', '');
    assert.equal(codexupdate.homeIsNamed(), false, 'an EMPTY value is not a named home');

    set('AGENT_WORKFORCE_CODEX_HOME', '/tmp/named');
    assert.equal(codexupdate.homeIsNamed(), true, 'a named home must collapse the list');

    /* ⚠️ THE ARM THAT MAKES THIS NOT EXPRESSIBLE AS "did defaultHome differ from the
       fallback". Plain CODEX_HOME changes the home and does NOT collapse the account
       list, so the two questions have different answers and need different functions. */
    set('AGENT_WORKFORCE_CODEX_HOME', null); set('CODEX_HOME', '/tmp/plain');
    assert.equal(codexupdate.homeIsNamed(), false,
      'plain CODEX_HOME must NOT collapse the list; only AGENT_WORKFORCE_CODEX_HOME does');
  } finally {
    set('AGENT_WORKFORCE_CODEX_HOME', prevA === undefined ? null : prevA);
    set('CODEX_HOME', prevB === undefined ? null : prevB);
  }
});

test('#1488: the rule is CALLED in both places, never restated', () => {
  /* The whole defect was two sides answering one question separately. A second copy
     re-opens it, so assert the call and assert the absence of a restatement. */
  assert.match(ENGINE, /codexupdate\.homeIsNamed\(\)/,
    'engine/create.js no longer calls the shared predicate, so it can drift from the route again');
  assert.match(SERVER, /codexupdate\.homeIsNamed\(\)/,
    'server.js no longer calls the shared predicate, so the route can drift from the engine');

  const restated = /typeof\s+process\.env\.AGENT_WORKFORCE_CODEX_HOME\s*===\s*'string'/;
  assert.doesNotMatch(ENGINE, restated,
    'engine/create.js restates the override rule inline again; a second copy of this fact IS #1488');
  assert.doesNotMatch(SERVER, restated,
    'server.js restates the override rule inline; call codexupdate.homeIsNamed() instead');
  /* control: the expression really is findable, so the two absence claims above mean
     something. It must be present in the ONE file that owns it. */
  const OWNER = fs.readFileSync(nodePath.join(__dirname, 'engine', 'codexupdate.js'), 'utf8');
  assert.match(OWNER, restated,
    'the predicate is not in codexupdate.js either, so the absence assertions above proved nothing');
});

test('#1488: the page filter EXECUTES and drops only non-offerable rows', () => {
  /* Lift the real filter expression out of the page and run it, rather than asserting
     on its text. A text assertion cannot tell a correct filter from a reversed one. */
  const at = PAGE.indexOf('function fillSwitchAccounts');
  assert.ok(at > -1, 'fillSwitchAccounts is gone; this test is aimed at nothing');
  const seg = PAGE.slice(at, at + 6000);
  const m = seg.match(/const list = ACCOUNTS\.filter\(\(x\) =>([\s\S]*?)\);/);
  assert.ok(m, 'the switch picker no longer builds `list` with a filter this test can lift');

  const pred = new Function('x', 'return (' + m[1] + ');');
  const row = (o) => Object.assign({ provider: 'openai', connection: { state: 'ok' } }, o);

  assert.equal(pred(row({ offerable: true })), true, 'an offerable row must be offered');
  assert.equal(pred(row({ offerable: false })), false,
    'a row the engine will refuse is still offered, which is the whole defect');
  assert.equal(pred(row({})), true,
    'a row with NO offerable field must stay offerable: a server that does not send it '
    + 'would otherwise get an empty menu, turning a narrow fix into a dead control');
  assert.equal(pred(row({ provider: 'anthropic', offerable: false })), false,
    'the filter must still exclude non-openai rows');
  assert.equal(pred(row({ connection: { state: 'none' }, offerable: true })), false,
    'the pre-existing dead-connection exclusion must survive');
});

test('#1488: the route computes offerable from the shared predicate', () => {
  const at = SERVER.indexOf("pathname === '/api/accounts'");
  assert.ok(at > -1, '/api/accounts route not found; this assertion is aimed at nothing');
  /* ⚠️ SLICE TO THE NEXT ROUTE, NOT TO A CHARACTER COUNT. My first version took 3000
     characters and the field sits 4037 past the anchor, so it failed for a reason that
     had nothing to do with the code. A fixed window is a spelling pin: it goes stale as
     the route grows, and it fails in the ALARMING direction, reporting a missing fix. */
  const next = SERVER.indexOf("if (pathname === '/api/accounts/", at + 1);
  assert.ok(next > at, 'cannot find the end of the /api/accounts route; the slice below is unbounded');
  const seg = SERVER.slice(at, next);
  /* control: the slice really contains the route body, so the assertions below are not
     reading an empty string. */
  assert.match(seg, /openaiAccounts\.listLive\(\)/,
    'the /api/accounts slice does not contain the route body, so every assertion below is vacuous');
  assert.match(seg, /offerable:/,
    'the accounts route no longer marks rows offerable, so the page cannot know an override is in force');
  assert.match(seg, /codexupdate\.homeIsNamed\(\)/,
    'the route computes offerable from something other than the shared predicate, which is how the two drift');
});
