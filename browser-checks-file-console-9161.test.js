'use strict';
/**
 * kosmos#9161: docs/browser-checks/lib-file-console.js is the one pattern a file:// browser check uses to ignore its
 * own start-up fetch noise. These pin it against the lines Chromium prints in both modes, and against the lines it
 * must NOT ignore, and they keep the old copied pattern (which knew only the headless words) from coming back.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const DIR = nodePath.join(__dirname, 'docs', 'browser-checks');
const { isFilePageNoise } = require('./docs/browser-checks/lib-file-console.js');

// Printed by a HEADED run (full Chrome, Playwright 1.62.1 / Chromium 1234), copied from render-computers-4648's output.
const HEADED = "Access to fetch at 'file:///api/settings' from origin 'null' has been blocked by CORS policy: Cross origin requests are only supported for protocol schemes: chrome, chrome-extension, chrome-untrusted, data, http, https, isolated-app.";

test('#9161: the headed CORS refusal of a file:/// fetch is ignored', () => {
  assert.equal(isFilePageNoise(HEADED), true);
  assert.equal(isFilePageNoise(HEADED.replace('/api/settings', '/api/worlds/names')), true);
});

test('#9161: the headless wordings the copied pattern knew are still ignored', () => {
  for (const line of [
    'Failed to load resource: net::ERR_FILE_NOT_FOUND',
    'Fetch API cannot load file:///api/settings. URL scheme "file" is not supported.',
    'TypeError: Failed to fetch',
  ]) assert.equal(isFilePageNoise(line), true, line);
});

test('#9161: a CORS refusal of a real http(s) request is NOT ignored', () => {
  assert.equal(isFilePageNoise(HEADED.replace("'file:///api/settings'", "'http://127.0.0.1:4321/api/settings'")), false);
  assert.equal(isFilePageNoise("Access to fetch at 'https://agent1s.kosmosplus.com/api/status' from origin 'https://laptop.kosmosplus.com' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource."), false);
  // a file:/// fetch from a real origin is not the no-board case either
  assert.equal(isFilePageNoise(HEADED.replace("origin 'null'", "origin 'http://127.0.0.1:4321'")), false);
});

test('#9161: an ordinary page error is NOT ignored, and nothing is never noise', () => {
  assert.equal(isFilePageNoise('Uncaught TypeError: pjFieldBad is not a function'), false);
  assert.equal(isFilePageNoise('ReferenceError: settingsGo is not defined'), false);
  assert.equal(isFilePageNoise(''), false);
  assert.equal(isFilePageNoise(undefined), false);
});

test('#9161: no browser check carries its own copy of the old file:// pattern', () => {
  const OLD = 'if (/ERR_FILE_NOT_FOUND|URL scheme "file"|Failed to (fetch|load)/.test(x)) return;';
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.js'));
  assert.ok(files.length > 100, `read ${files.length} files from ${DIR}`);
  const copies = files.filter((f) => fs.readFileSync(nodePath.join(DIR, f), 'utf8').includes(OLD));
  // render-inline-field-errors-2606 drops the copy in #9158 (it is served from a board there); until that merges it
  // is the one allowed holder, so this test passes on either side of that merge.
  assert.deepEqual(copies.filter((f) => f !== 'render-inline-field-errors-2606.js'), []);
});

test('#9161: each check that ignored file:// noise now asks the shared pattern', () => {
  const WIRED = ['render-cluster-reorder-2929', 'render-consolidated-newagent-3053', 'render-cons-tree-2929',
    'render-consolidated-projects-3052', 'render-consolidated-nav-4345', 'render-consolidated-settings-2842',
    'render-firstrun-grok-3386', 'render-firstrun-reentry-3359', 'render-project-members-3387',
    'render-reassign-restart-2829', 'render-pjadd-back-2850', 'render-projects-badges-4730', 'render-subprojects-1994',
    'render-computers-4648'];
  for (const n of WIRED) {
    const src = fs.readFileSync(nodePath.join(DIR, n + '.js'), 'utf8');
    assert.match(src, /require\('\.\/lib-file-console\.js'\)/, n + ' requires the shared pattern');
    assert.match(src, /isFilePageNoise\(x\)/, n + ' applies it to the console line');
  }
});
