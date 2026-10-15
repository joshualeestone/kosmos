'use strict';
/* kosmos#6239 (Kosmos+Kids slice 2): a FAMILY account's words are shown and accepted before this computer joins.
   plusOrgConnect stops after the preview for a family and shows the words (plusOrgFamilyShow); Accept and join sends the
   enroll with wordsShown (plusOrgFamilyAccept). A company still joins at once (web.joincorp-5791.test.js). The panel's
   functions are run against a small stand-in document; the wiring is pinned in the page source. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
const fn = (name) => { const at = PAGE.indexOf(name); assert.ok(at >= 0, name + ' is gone'); return PAGE.slice(at, PAGE.indexOf('\n}\n', at) + 2); };

function harness(answer) {
  const els = new Map();
  const el = (id) => {
    if (!els.has(id)) {
      const e = { id, hidden: true, disabled: false, value: '', textContent: '', children: [], focused: false,
        replaceChildren() { this.children = []; }, append(c) { this.children.push(c); }, focus() { this.focused = true; } };
      if (id === 'plus-org-family-accept' || id === 'plus-org-family-no') e.hidden = false;
      els.set(id, e);
    }
    return els.get(id);
  };
  const posted = [];
  const ctx = {
    document: { getElementById: el, createElement: () => ({ textContent: '' }) },
    PLUS_ORG: { busy: false, open: true, state: null, at: 1 },
    plusOrgPost: async (verb, body) => { posted.push({ verb, body }); return answer; },
    plusOrgPaint: () => { ctx.painted = true; }, plusOrgMaybe: () => {},
  };
  const src = 'let PLUS_ORG_FAMILY = null;\n' + fn('function plusOrgFamilyShow(') + fn('function plusOrgFamilyHide(') + fn('async function plusOrgFamilyAccept(')
    + '\nreturn { plusOrgFamilyShow, plusOrgFamilyHide, plusOrgFamilyAccept, state: () => PLUS_ORG_FAMILY };';
  const api = new Function('document', 'PLUS_ORG', 'plusOrgPost', 'plusOrgPaint', 'plusOrgMaybe', src)(ctx.document, ctx.PLUS_ORG, ctx.plusOrgPost, ctx.plusOrgPaint, ctx.plusOrgMaybe);
  return { api, el, posted, ctx };
}
const PREVIEW = { ok: true, ticket: 't1', org: { name: 'The Rivera family', kind: 'family' }, role: 'member',
  consent: { reports: ['line one <b>not html</b>', 'line two'], readers: ['the family\'s admins'], never: ['keys and passwords'] } };

test('#6239: the family\'s words are shown as text, line by line, with Accept and join focused', () => {
  const h = harness({ ok: true });
  h.api.plusOrgFamilyShow('RIVE-JOIN-1234', PREVIEW);
  assert.equal(h.el('plus-org-family').hidden, false, 'the words are not shown');
  assert.deepEqual(h.el('plus-org-family-reports').children.map((c) => c.textContent), PREVIEW.consent.reports, 'not every line, or not as text');
  assert.deepEqual(h.el('plus-org-family-readers').children.map((c) => c.textContent), PREVIEW.consent.readers);
  assert.equal(h.el('plus-org-family-never').textContent, 'Never sent: keys and passwords.');
  assert.match(h.el('plus-org-family-lead').textContent, /^The Rivera family is a family account\. As this child.s parent or guardian, read what joining shares, then accept to connect this computer\.$/);
  assert.equal(h.el('plus-org-family-accept').focused, true);
});

test('#6239: Accept and join sends the code, the ticket and wordsShown; a refusal is said and nothing is painted as joined', async () => {
  const ok = harness({ ok: true, org: { name: 'The Rivera family' }, role: 'member' });
  ok.api.plusOrgFamilyShow('RIVE-JOIN-1234', PREVIEW);
  await ok.api.plusOrgFamilyAccept();
  assert.deepEqual(ok.posted, [{ verb: 'enroll', body: { code: 'RIVE-JOIN-1234', accepted: true, ticket: 't1', wordsShown: true } }]);
  assert.equal(ok.el('plus-org-family').hidden, true, 'the words stayed open after joining');
  assert.equal(ok.ctx.PLUS_ORG.state.enrolled, true);
  assert.equal(ok.ctx.painted, true);
  const no = harness({ ok: false, because: 'That code has already been used.' });
  no.api.plusOrgFamilyShow('RIVE-JOIN-1234', PREVIEW);
  await no.api.plusOrgFamilyAccept();
  assert.equal(no.el('plus-org-msg').textContent, 'That code has already been used.');
  assert.equal(no.ctx.PLUS_ORG.state, null, 'a refused join was painted as joined');
  // A member moving computers: no code, the same wordsShown.
  const mv = harness({ ok: true });
  mv.api.plusOrgFamilyShow('X', { ...PREVIEW, move: true });
  await mv.api.plusOrgFamilyAccept();
  assert.deepEqual(mv.posted[0].body, { accepted: true, ticket: 't1', wordsShown: true });
});

test('#6239: Connect stops after a family preview to show the words; Cancel and Not now close them', () => {
  const c = fn('async function plusOrgConnect()');
  const pv = c.indexOf("plusOrgPost('preview'");
  const fam = c.indexOf("if (p.org && p.org.kind === 'family') { plusOrgFamilyShow(code, p); return; }");
  const en = c.indexOf("plusOrgPost('enroll'");
  assert.ok(pv > 0 && fam > pv && en > fam, 'a family is not stopped between the preview and the enroll');
  assert.doesNotMatch(c, /wordsShown/, 'the company path claims words were shown');
  assert.match(fn('function plusOrgCancel()'), /plusOrgFamilyHide\(\);/);
  assert.match(PAGE, /getElementById\('plus-org-family-accept'\)\.addEventListener\('click', plusOrgFamilyAccept\)/);
  assert.match(PAGE, /getElementById\('plus-org-family-no'\)\.addEventListener\('click', \(\) => \{ plusOrgFamilyHide\(\); /);
});
