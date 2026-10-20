'use strict';

/**
 * The notice that says which agents will not come back after a restart.
 *
 * 🛑 THE BOARD KNEW AND DID NOT SAY. An agent with a login job and one without
 * draw the same card, so the only way to learn which of yours survive a restart
 * was to restart. Josh did, on 2026-08-22, and one of his sixteen came back.
 *
 * #6714 (Josh, 2026-10-20): "i need a dismiss option, and also this is an ugly 100% wide button". It is a compact
 * notice per agent in the floating stack now, with Start at login, Remove and an honest x.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const page = require('./test-support/page');
const SCRIPT = page.scriptOf(PAGE);
const realEsc = (x) => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const LIFTED = ['survivalSay', 'survivalNotice', 'paintSurvivalHidden', 'paintSurvival'].map((f) => page.lift(SCRIPT, f)).join('\n');
const EACH_MAX = Number((SCRIPT.match(/const SURVIVAL_EACH_MAX = (\d+);/) || [])[1]);

function run(reply, { onAgents = true, slotStart = '', esc = realEsc, slot: given } = {}) {
  const slot = given || { innerHTML: slotStart, dataset: {} };
  const box = { hidden: true };
  const list = { innerHTML: '' };
  const doc = { getElementById: (id) => ({ 'survival-slot': slot, 'survival-hidden-box': box, 'survival-hidden-list': list })[id] || null };
  const fetchStub = async () => {
    if (reply === 'throws') throw new Error('offline');
    if (reply === 'down') return { ok: false, json: async () => ({ error: 'no' }) };
    return { ok: true, json: async () => reply };
  };
  return new Function('document', 'fetch', 'esc', 'onAgentsTab', 'SURVIVAL_BUSY', 'SURVIVAL_EACH_MAX',
    LIFTED + '\nreturn paintSurvival();',
  )(doc, fetchStub, esc, () => onAgents, false, EACH_MAX).then(() => ({ slot, box, list }));
}
const notices = (html) => (html.match(/<div class="utoast survival/g) || []).length;

test('the cap is a small number, so the floating stack never covers the board', () => {
  assert.ok(EACH_MAX >= 1 && EACH_MAX <= 3, 'SURVIVAL_EACH_MAX not found or too large: ' + EACH_MAX);
});

test('#6714: one compact notice per agent, each naming it, with Start at login, Remove and a x', async () => {
  const { slot } = await run({ ok: true, missing: ['brigitte', 'marilyn'], agents: [{ name: 'brigitte', shownAs: 'Brigitte' }] });
  assert.equal(notices(slot.innerHTML), 2);
  assert.match(slot.innerHTML, /Brigitte will not come back after a restart/);
  assert.match(slot.innerHTML, /marilyn will not come back/);
  for (const n of ['brigitte', 'marilyn']) {
    assert.match(slot.innerHTML, new RegExp('data-survival-fix="' + n + '">Start at login<'));
    assert.match(slot.innerHTML, new RegExp('data-survival-remove="' + n + '">Remove…<'));
    assert.match(slot.innerHTML, new RegExp('data-survival-hide="' + n + '"'));
  }
  assert.doesNotMatch(slot.innerHTML, /pj-empty|boardfail/, 'the full-width card is back');
});

test('#6714: the x says what it does, and nothing calls it a fix', async () => {
  /* A dismiss changes nothing about whether the agent comes back, so it must not read as if it did. */
  const { slot } = await run({ ok: true, missing: ['brigitte'], agents: [{ name: 'brigitte', shownAs: 'Brigitte' }] });
  assert.match(slot.innerHTML, /aria-label="Stop reminding me about Brigitte"/);
  assert.doesNotMatch(slot.innerHTML, /Later|Dismiss|Fixed|Done/);
});

test('it speaks the name the person typed, not the machine name', async () => {
  /* 🛑 IT PRINTED THE SLUG AND JOSH READ IT AS A MISSING AGENT. His list said
     `ava, bob, brigitte` while his cards said Ava, Brigitte and Scarlett. */
  const { slot } = await run({ ok: true, missing: ['scarlett'], agents: [{ name: 'scarlett', shownAs: 'Scarlett' }] });
  assert.match(slot.innerHTML, /<b>Scarlett will not/);
  assert.ok(!/<b>scarlett/.test(slot.innerHTML), 'the machine name reached the words');
  assert.match(slot.innerHTML, /data-survival-fix="scarlett"/, 'the action must carry the machine name');
});

test('past the cap, one notice names them all and starts them all', async () => {
  const many = Array.from({ length: EACH_MAX + 1 }, (_, i) => 'a' + i);
  const { slot } = await run({ ok: true, missing: many });
  assert.equal(notices(slot.innerHTML), 1);
  assert.match(slot.innerHTML, new RegExp((EACH_MAX + 1) + ' of your agents will not come back'));
  assert.match(slot.innerHTML, new RegExp('data-survival-names>' + many.join(', ') + '<'));
  assert.match(slot.innerHTML, /data-survival-fix="">Start them at login</);
  assert.match(slot.innerHTML, new RegExp('data-survival-hide="' + many.join(' ') + '"'));
  assert.doesNotMatch(slot.innerHTML, /1 of your agents/);
});

test('it says nothing at all when every agent has a job', async () => {
  const { slot } = await run({ ok: true, missing: [] }, { slotStart: 'OLD' });
  assert.equal(slot.innerHTML, '');
});

test('a failed look leaves the screen alone rather than clearing it', async () => {
  /* 🛑 THE WHOLE DEFECT THIS NOTICE EXISTS FOR IS A SILENCE READ AS AN
     ALL-CLEAR. A 500 whose JSON body parses is exactly how that happens
     again, one layer up. */
  for (const bad of ['down', 'throws', { ok: false, because: 'we could not read it' }, null, { ok: true }]) {
    const { slot } = await run(bad, { slotStart: 'STANDING' });
    assert.equal(slot.innerHTML, 'STANDING', `a ${JSON.stringify(bad)} answer wiped the notice`);
  }
});

test('it does not stand under another tab', async () => {
  const { slot } = await run({ ok: true, missing: ['brigitte'] }, { onAgents: false, slotStart: 'OLD' });
  assert.equal(slot.innerHTML, '');
});

test('the sentence never claims the folders are at risk', async () => {
  /* Nothing was deleted; these agents are stopped and unregistered. */
  const one = await run({ ok: true, missing: ['brigitte'] });
  assert.match(one.slot.innerHTML, /Its folder and memory are untouched\./);
  const many = await run({ ok: true, missing: Array.from({ length: EACH_MAX + 1 }, (_, i) => 'a' + i) });
  assert.match(many.slot.innerHTML, /Their folders and memory are untouched\./);
});

test('#6320: agents that could not be checked are said, with no button to set them up', async () => {
  const two = await run({ ok: true, missing: [], unknown: ['ava', 'bob'], agents: [{ name: 'ava', shownAs: 'Ava' }] });
  assert.match(two.slot.innerHTML, /We could not check whether 2 of your agents come back/);
  assert.match(two.slot.innerHTML, /data-survival-unknown>Ava, bob</);
  assert.doesNotMatch(two.slot.innerHTML, /data-survival-fix|data-survival-remove/, 'a button offered to change agents we could not check');
  assert.match(two.slot.innerHTML, /We will leave them as they are/);
  const one = await run({ ok: true, missing: [], unknown: ['ava'], agents: [{ name: 'ava', shownAs: 'Ava' }] });
  assert.match(one.slot.innerHTML, /whether Ava comes back/);
  assert.match(one.slot.innerHTML, /We will leave it as it is/);
  assert.doesNotMatch(one.slot.innerHTML, /these agents|leave them/, 'one agent spoken of as many');
  // Both at once: the missing one keeps its button; the unknown one is a separate, neutral notice.
  const both = await run({ ok: true, missing: ['rick'], unknown: ['ava'] });
  assert.equal(notices(both.slot.innerHTML), 2);
  assert.match(both.slot.innerHTML, /data-survival-fix="rick"/);
  assert.match(both.slot.innerHTML, /utoast survival unknown/);
});

test('every name is escaped, in the words and in the attributes', async () => {
  const { slot } = await run({ ok: true, missing: ['x'], unknown: ['y'], agents: [{ name: 'x', shownAs: '<b>x"' }, { name: 'y', shownAs: '<i>y' }] });
  assert.doesNotMatch(slot.innerHTML, /<b>x"|<i>y/);
  assert.match(slot.innerHTML, /&lt;b&gt;x&quot;/);
  assert.match(slot.innerHTML, /aria-label="Stop reminding me about &lt;b&gt;x&quot;"/);
});

test('#6714: Settings lists the hidden ones with Show again, and is hidden when there are none', async () => {
  const some = await run({ ok: true, missing: [], hidden: ['brigitte'], agents: [{ name: 'brigitte', shownAs: 'Brigitte' }] });
  assert.equal(some.box.hidden, false);
  assert.match(some.list.innerHTML, /<b>Brigitte<\/b>/);
  assert.match(some.list.innerHTML, /data-survival-show="brigitte">Show again</);
  assert.equal(some.slot.innerHTML, '', 'a hidden agent still has a notice');
  const none = await run({ ok: true, missing: [] });
  assert.equal(none.box.hidden, true);
  // Painted even off the agents tab, since Settings is where it is read.
  const off = await run({ ok: true, missing: [], hidden: ['b'] }, { onAgents: false });
  assert.equal(off.box.hidden, false);
});

test('#6714: the page has the floating slot and the Settings box, and the old full-width panel is gone', () => {
  assert.match(PAGE, /<div id="survival-slot"><\/div>/);
  assert.match(PAGE, /id="survival-hidden-box" hidden/);
  assert.doesNotMatch(PAGE, /id="restart-wrap"/);
});

test('#6714 review 1: the notice is not repainted when nothing changed, so focus and an error line survive the poll', async () => {
  const reply = { ok: true, missing: ['brigitte'] };
  const { slot } = await run(reply);
  slot.innerHTML += '<small data-survival-err>We could not record that just now.</small>';   // what a failed x adds
  await run(reply, { slot });
  assert.match(slot.innerHTML, /data-survival-err/, 'an unchanged poll repainted the notice and wiped the error line');
  // CONTROL: a change does repaint.
  await run({ ok: true, missing: ['brigitte', 'marilyn'] }, { slot });
  assert.doesNotMatch(slot.innerHTML, /data-survival-err/);
  assert.match(slot.innerHTML, /data-survival-fix="marilyn"/);
});

test('#6714 review 1: Settings reads the hidden list on its own, and opening Settings asks for it', async () => {
  const box = { hidden: true };
  const list = { innerHTML: '' };
  const doc = { getElementById: (id) => ({ 'survival-hidden-box': box, 'survival-hidden-list': list })[id] || null };
  await new Function('document', 'fetch', 'esc', page.lift(SCRIPT, 'paintSurvivalHidden') + '\n' + page.lift(SCRIPT, 'refreshSurvivalHidden') + '\nreturn refreshSurvivalHidden();')(
    doc, async () => ({ ok: true, json: async () => ({ ok: true, missing: [], hidden: ['brigitte'] }) }), realEsc);
  assert.equal(box.hidden, false);
  assert.match(list.innerHTML, /data-survival-show="brigitte"/);
  assert.match(SCRIPT, /if \(tab === 'settings'\) \{ centreSettingsPill\(\); refreshSurvivalHidden\(\); \}/, 'opening Settings does not read the hidden list');
});

test('#6714 review 1: a failed start keeps the warning look and is closable as a report', () => {
  assert.match(SCRIPT, /survivalNotice\(r\.ok \? 'done report' : 'failed report'/);
  assert.match(PAGE, /\.utoast\.survival\.done, \.utoast\.survival\.unknown \{ --utone: var\(--label-2\); \}/);
  assert.doesNotMatch(PAGE, /\.utoast\.survival\.failed[^{]*\{[^}]*label-2/, 'a failed start is styled as a calm fact');
});

test('#6714 review 18: a start report goes in its own slot, which no poll touches; the notices keep repainting', () => {
  assert.match(PAGE, /<div id="survival-report-slot"><\/div>\s*<div id="survival-slot"><\/div>/);
  assert.doesNotMatch(page.lift(SCRIPT, 'paintSurvival'), /survival-report-slot/, 'a poll can wipe a report the person is reading');
  assert.match(SCRIPT, /reports\.insertAdjacentHTML\('afterbegin', report\)/);
  assert.doesNotMatch(SCRIPT, /SURVIVAL_HELD/, 'the hold that froze every notice is back');
});

test('#6714 review 5: past the cap, Start them at login gives one report', () => {
  assert.match(SCRIPT, /const report = body\.results\.length > capNow\s*\? survivalNotice\(/);
});

test('#6714 review 7: the combined report keeps each agent\'s guessed-model sentence', () => {
  const at = SCRIPT.indexOf("const report = body.results.length > capNow");
  assert.ok(at > 0, 'the combined report is not where this test looks: re-derive it');
  assert.match(SCRIPT.slice(at, at + 900), /guessedLine\(r\)/, 'the combined report dropped what we had to assume');
});

test('#6714 reviews 15, 17: after a notice closes, focus goes to the next one\'s words, never to a button', () => {
  const f = page.lift(SCRIPT, 'survivalFocusNext');
  assert.match(f, /querySelector\('#survival-report-slot \.utoast \.utxt, #survival-slot \.utoast \.utxt'\)/, 'focus no longer goes to the notice words (review 17)');
  assert.doesNotMatch(f, /\.utoast button'\)|\.utoast \.ux'\)/, 'focus can land on a button, so a repeated Enter acts');
});

test('#6714 review 16: no focus path in the notice can land on a start button by default', () => {
  const paint = page.lift(SCRIPT, 'paintSurvival');
  assert.match(paint, /slot\.querySelector\(key\) \|\| slot\.querySelector\('\.utoast \.utxt'\)/, 'a repaint fallback no longer goes to the notice words');
  assert.doesNotMatch(paint, /\|\| slot\.querySelector\('button'\)/, 'a repaint can drop focus on Start at login');
});

test('#6714 review 17: the notice words are focusable and inert, and a poll re-checks the hold after its wait', () => {
  assert.match(page.lift(SCRIPT, 'survivalNotice'), /class="utxt" role="status" tabindex="-1"/);
  const paint = page.lift(SCRIPT, 'paintSurvival');
  const afterFetch = paint.indexOf('paintSurvivalHidden(body);');
  assert.ok(afterFetch > 0);
  assert.match(paint.slice(afterFetch, afterFetch + 300), /if \(SURVIVAL_BUSY\) return;/, 'a poll can paint over a running start');
});

test('#6714 review 20: a second Start at login while one runs is refused with a line, not raced', () => {
  const at = SCRIPT.indexOf("const only = btn.getAttribute('data-survival-fix');");
  assert.ok(at > 0, 'the start handler is not where this test looks: re-derive it');
  assert.match(SCRIPT.slice(at - 300, at), /if \(SURVIVAL_BUSY\) \{ survivalSayIn\(btn, /, 'a second start can run while the first is in flight');
});
