'use strict';
/**
 * kosmos#6367: when the company's policy requires this computer to report, Remove this computer (Kosmos+) says the
 * company will see it stop. A warning, never a refusal. Covers the engine's reading of the policy, what /api/org
 * passes on, and the confirm's line for each kind of org and state.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
const SERVER = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const orgpolicy = require('./engine/orgpolicy');

function lift(src, name, open = '{') {
  const at = src.indexOf(name);
  assert.notEqual(at, -1, name + ' is gone');
  const from = src.indexOf(open, at);
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(at, i + 1);
  }
  assert.fail(name + ' never closes');
}

test('#6367: reportingRequired is true only for telemetry.required === true', () => {
  assert.equal(orgpolicy.reportingRequired({ telemetry: { required: true } }), true);
  for (const p of [null, {}, { telemetry: null }, { telemetry: {} }, { telemetry: { required: false } },
    { telemetry: { required: 'true' } }, { telemetry: { required: 1 } }, { backup: { required: true } }]) {
    assert.equal(orgpolicy.reportingRequired(p), false, JSON.stringify(p));
  }
});

test('#6367: /api/org passes reportingRequired on, and only for the enrolled Kosmos', () => {
  assert.match(SERVER, /const reportingRequired = here \? require\('\.\/engine\/orgpolicy'\)\.reportingRequired\(\) : false;/);
  assert.match(SERVER, /reportingWait: why, wordsNeeded, reportingRequired,/);
});

function page(state) {
  const els = {};
  const el = (id) => (els[id] = els[id] || { id, hidden: true, textContent: '', focus() {} });
  const ctx = { document: { getElementById: el }, PLUS_ORG: { state } };
  vm.createContext(ctx);
  const required = PAGE.match(/const PLUS_FORGET_REQUIRED = '[^']*';/);
  assert.ok(required, 'PLUS_FORGET_REQUIRED is gone');
  vm.runInContext([required[0].replace(/^const/, 'var'), lift(PAGE, 'function plusOrgIn('),
    lift(PAGE, 'function plusForgetRequiredLine('), lift(PAGE, 'function plusForgetArm(')].join('\n'), ctx);
  return { ctx, el };
}

test('#6367: the Remove confirm says the company requires reports, for the enrolled Kosmos under that policy only', () => {
  const company = { enrolled: true, reportingRequired: true, org: { kind: 'company' } };
  const p = page(company);
  p.ctx.plusForgetArm(true);
  const line = p.el('plus-forget-required');
  assert.equal(line.hidden, false);
  assert.match(line.textContent, /^Your company requires this computer to report to it\. Once it is removed, it stops reporting, and your company will see that\.$/);
  p.ctx.plusForgetArm(false);
  assert.equal(p.el('plus-forget-required').hidden, true, 'closing the confirm hides it');

  const fam = page({ enrolled: true, reportingRequired: true, org: { kind: 'family' } });
  fam.ctx.plusForgetArm(true);
  assert.match(fam.el('plus-forget-required').textContent, /^Your family requires .* your family will see that\.$/, 'a family is not called a company');

  for (const st of [null, {}, { enrolled: false, reportingRequired: true }, { enrolled: true, reportingRequired: false },
    { enrolled: true }]) {
    const q = page(st);
    q.ctx.plusForgetArm(true);
    assert.equal(q.el('plus-forget-required').hidden, true, 'nothing said for ' + JSON.stringify(st));
    assert.equal(q.el('plus-forget-required').textContent, '');
  }
});

test('#6367: the line sits in the confirm, after what Remove does, and is hidden until the confirm opens', () => {
  const ask = PAGE.match(/<div id="plus-forget-ask" hidden>([\s\S]*?)<div class="frow">/);
  assert.ok(ask, 'the confirm markup is gone');
  assert.match(ask[1], /id="plus-forget-sure"[\s\S]*<p class="fhint" id="plus-forget-required" hidden><\/p>/);
});
