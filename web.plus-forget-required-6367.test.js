'use strict';
/**
 * kosmos#6367: when the company's policy requires this computer to report, Remove this computer (Kosmos+) says the
 * company will see it stop. A warning, never a refusal. Covers the engine's reading of the policy and the confirm's
 * line for each kind of org and state. What /api/org passes on is run for real in server.orgenroll-5531.test.js.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
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

function page(state) {
  const els = {};
  const el = (id) => (els[id] = els[id] || { id, hidden: true, textContent: '', focus() {} });
  const ctx = { document: { getElementById: el }, PLUS_ORG: { state } };
  vm.createContext(ctx);
  const consts = ['PLUS_FORGET_REQUIRED', 'PLUS_FORGET_REQUIRED_IDLE'].map((n) => {
    const m = PAGE.match(new RegExp('const ' + n + " = '[^']*';"));
    assert.ok(m, n + ' is gone');
    return m[0].replace(/^const/, 'var');
  });
  vm.runInContext([...consts, lift(PAGE, 'function plusOrgIn('), lift(PAGE, 'function plusForgetRequiredLine('),
    lift(PAGE, 'function plusForgetRequiredPaint('), lift(PAGE, 'function plusForgetRequiredOnRead('),
    lift(PAGE, 'function plusForgetArm(')].join('\n'), ctx);
  return { ctx, el };
}

test('#6367: the Remove confirm says the company requires reports, for the enrolled Kosmos under that policy only', () => {
  const company = { enrolled: true, reporting: true, reportingRequired: true, org: { kind: 'company' } };
  const p = page(company);
  p.ctx.plusForgetArm(true);
  const line = p.el('plus-forget-required');
  assert.equal(line.hidden, false);
  assert.match(line.textContent, /^Your company requires this computer to report to it\. Once it is removed, it stops reporting, and your company will see that\.$/);
  p.ctx.plusForgetArm(false);
  assert.equal(p.el('plus-forget-required').hidden, true, 'closing the confirm hides it');

  const fam = page({ enrolled: true, reporting: true, reportingRequired: true, org: { kind: 'family' } });
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

test('#6367: a Kosmos that does not report yet is told only that it cannot report once removed, never that it stops', () => {
  for (const st of [
    { enrolled: true, reporting: false, reportingRequired: true, wordsNeeded: true, org: { kind: 'family' } },
    { enrolled: true, reporting: false, reportingWait: 'print', reportingRequired: true, org: { kind: 'company' } },
    { enrolled: true, reporting: false, reportingWait: 'noReports', reportingRequired: true, org: { kind: 'company' } },
    { enrolled: true, reportingRequired: true, org: { kind: 'company' } },
  ]) {
    const p = page(st);
    p.ctx.plusForgetArm(true);
    const t = p.el('plus-forget-required').textContent;
    assert.match(t, /requires this computer to report to it\. Once it is removed, it cannot report\.$/, JSON.stringify(st));
    assert.doesNotMatch(t, /stops reporting/, 'nothing stops that never started: ' + JSON.stringify(st));
  }
});

test('#6367: a read of /api/org that lands while the confirm is open fills the line; one that lands while it is closed does not', () => {
  const later = { enrolled: true, reporting: true, reportingRequired: true, org: { kind: 'company' } };
  const open = page(null);
  open.ctx.plusForgetArm(true);
  assert.equal(open.el('plus-forget-required').hidden, true, 'pressed before the first read: no line yet');
  open.el('plus-forget-ask').hidden = false;   // what plusForgetArm(true) does to the real confirm
  open.ctx.PLUS_ORG.state = later;
  open.ctx.plusForgetRequiredOnRead();
  assert.equal(open.el('plus-forget-required').hidden, false);
  assert.match(open.el('plus-forget-required').textContent, /stops reporting/);
  const closed = page(null);
  closed.el('plus-forget-ask').hidden = true;
  closed.ctx.PLUS_ORG.state = later;
  closed.ctx.plusForgetRequiredOnRead();
  assert.equal(closed.el('plus-forget-required').hidden, true, 'a closed confirm is left alone');
  assert.equal(closed.el('plus-forget-required').textContent, '');
  // The read calls it once its state is set.
  assert.match(lift(PAGE, 'function plusOrgMaybe('), /PLUS_ORG\.state = j;[\s\S]{0,120}plusForgetRequiredOnRead\(\)/);
});

test('#6367: the line sits in the confirm, after what Remove does, and is hidden until the confirm opens', () => {
  const ask = PAGE.match(/<div id="plus-forget-ask" hidden>([\s\S]*?)<div class="frow">/);
  assert.ok(ask, 'the confirm markup is gone');
  assert.match(ask[1], /id="plus-forget-sure"[\s\S]*<p class="fhint" id="plus-forget-required" hidden><\/p>/);
});
