#!/usr/bin/env node
// Browser-check-surface: plus-org-family plus-org-family-lead plus-org-family-account plus-org-family-accept plus-org-family-no plus-org-family-reports plus-org-family-backsup plus-org-family-readers plus-org-family-never plus-org-words plus-org-words-row
/*
 * kosmos#6239 (Kosmos+Kids, slice 2; Josh 10-15 10:42): a FAMILY account's words are read and accepted by a parent
 * before this computer joins. Runs the real page (web/index.html, file://) with fetch answered by a stand-in for the
 * board's /api/org routes, so nothing reaches a board or a coordinator, in chromium and webkit.
 *
 *   F0  a COMPANY code still joins at once (#5791): no family words, one enroll of exactly { code, accepted, ticket }.
 *   F1  a FAMILY code stops after the preview: the words show (lead names the family and the parent or guardian, then
 *       every list the coordinator sent), focus is on the words, and nothing is enrolled.
 *   F2  Accept and join sends exactly { code, accepted: true, ticket, wordsShown: true }; the words close, the joined
 *       view shows with no line under it, and focus is on the joined view's sentence.
 *   F3  Not now joins nothing, says so, and puts focus on the code field; Escape inside the words does the same.
 *   F4  another code typed over the words closes them.
 *   F5  a refusal with a code closes the words and puts focus on Connect; org_bad_world keeps them.
 *   F6  a family that backs up nothing says "Nothing is backed up."; a part with no lines hides its heading.
 *   F7  a family member moving here joins with no code, still only after Accept, with wordsShown.
 *   F8  390 wide: the words fit, with no sideways scroll.
 *   R1  a joined family whose words changed (wordsNeeded) says reports wait for a parent, and offers the words.
 *   R2  Read the family's words asks for the review ({ review: true }) and shows them as not accepted here, with Accept.
 *   R3  Not now accepts nothing, says so, and puts focus back on the button.
 *   R4  Accept sends exactly { accepted: true, ticket, wordsShown: true } (no code), and the joined view stops waiting.
 *   R5  a refusal with a code closes the words and puts focus back on the button.
 *   R6  a company, or a family whose words are accepted, is offered nothing to read.
 *   R7  a review refused with no code keeps the words and says to press Accept again; one with a code says to read them
 *       again (never "Connect Account", never "tries again on its own"); Leave with the words open closes them.
 *   R8  a review refused because this account is no longer in the family keeps the engine's reason, reads /api/org again,
 *       does not put focus on the words button, and the joined sentence asks nobody to accept.
 *   R11 org_bad_world (the ticket kept) keeps the words and says to press Accept again.
 *   R12 a refused review preview (already accepted here) says why and reads /api/org again.
 *   R13 an open review's words close when a read says they are accepted here (another window accepted them).
 *   R14 words held back after R8 do not outlive the membership: a Leave clears them, so after a new join they are offered again.
 *   R15 a review answered as not a family's says so, and the words stay held back across a read of the same record.
 *   R16 a review preview refused as not named here (org_not_named) holds the words back, as R8 does for an Accept.
 *   R17 a read that started before the page's own write is dropped, and a one-time note it carried shows on the next read.
 *   R18 a /api/org read asked before an Accept or a Leave, held open and released after it, changes nothing.
 *   R19 signing out of Kosmos+ closes a family's words on screen and releases words held back.
 *   R20 signing out also drops a carried one-time note, a pending could-not-record check and the once-a-minute gate.
 *   R9  a leave refused while the words are needed says a parent is needed, not that Kosmos takes the terms on itself.
 *   R10 an Accept the next read contradicts (still wordsNeeded) says this computer could not record the words.
 *   W1  kosmos#6567: the board's leave refusal on a stale joined screen ("not your work Kosmos") reads in a family's words;
 *       a company keeps its own (CONTROL).
 *   W2  kosmos#6567: the stopped note says "is no longer in" the family; a company keeps "the work Kosmos for" (CONTROL).
 *   F11 kosmos#6873: the words say whose account this computer must be signed in with (the child's, not the parent's own;
 *       under 13 one the parent made, at an address the parent reads), name no address, and Remove this computer is on
 *       screen with them; the review flow's words (R2) say the same.
 *   F10 a family's words checked while the block was held open only by a line under it stay up, with the code above.
 *   F9  no page errors.
 */
const path = require('node:path');
const playwright = require('playwright');

const PAGE = 'file://' + path.join(path.resolve(__dirname, '..', '..'), 'web', 'index.html');
const SHOTS = process.argv[2] || null;
const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

const FAMILY_WORDS = {
  reports: ['agent names, the AI provider and model each uses', 'project names'],
  backsUp: ['agent folders and their files'],
  readers: ['the parents and guardians of this family account'],
  never: ['keys and passwords'],
};
const COMPANY_WORDS = { reports: ['agent names'], backsUp: [], readers: ['your company'], never: ['keys and passwords'] };

function harness() {
  return () => {
    window.setInterval = () => 0;
    window.__org = [];
    const enc = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
    window.fetch = async (url, init) => {
      const u = String(url);
      const body = init && init.body ? JSON.parse(init.body) : null;
      if (u.includes('/api/org')) window.__org.push({ path: u.replace(/^.*?(\/api\/org[^?]*).*$/, '$1'), method: (init && init.method) || 'GET', body });
      // A read held open (R18): it answers with the state as it was when asked, once the check releases it.
      if (u.endsWith('/api/org') && !(init && init.method) && window.__holdNext && window.__orgState) {
        const held = window.__holdNext; window.__holdNext = null;
        const asked = JSON.stringify(window.__orgState);
        await held;
        return new Response(asked, { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (u.endsWith('/api/org/preview')) return enc(Object.assign({ ok: true, role: 'member', ticket: 't-' + window.__org.length }, window.__preview || {}));
      if (u.endsWith('/api/org/enroll')) {
        const a = window.__enrollAnswer || { ok: true, org: (window.__preview || {}).org, role: 'member' };
        if (a.ok) window.__joined = true;
        return enc(a);
      }
      if (u.endsWith('/api/org/leave')) { window.__joined = false; return enc(window.__leaveAnswer || { ok: true }); }
      if (u.endsWith('/api/org') && window.__orgState) return enc(window.__orgState);
      if (u.endsWith('/api/org') && window.__joined) return enc({ enrolled: true, reporting: true, stoppedFor: null, leaveRefused: null, org: { name: 'The Rivera family', slug: 'rivera' }, role: 'member', enrolledAt: '2026-10-15T00:00:00.000Z' });
      if (u.endsWith('/api/org')) return enc({ enrolled: false, stoppedFor: null, leaveRefused: null, org: null, role: null, enrolledAt: null });
      if (u.endsWith('/api/remote') && !(init && init.method)) return enc(window.__remote || { enrolled: true, on: true });
      if (u.includes('/api/history')) return enc({ readable: false });
      return enc({});
    };
  };
}

async function run(engineName) {
  const E = '[' + engineName + ']';
  const browser = await playwright[engineName].launch();
  const errs = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    page.on('pageerror', (e) => errs.push(e.message));
    await page.addInitScript(harness());
    await page.goto(PAGE);
    if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
    // R1 (read here, before any Accept sets it): the joined sentence is focusable by its markup.
    const sayTab0 = await page.evaluate(() => document.getElementById('plus-org-say').getAttribute('tabindex'));
    await page.evaluate(() => { showTab('settings'); settingsGo('plus'); });
    await page.waitForFunction(() => (window.__org || []).some((x) => x.path === '/api/org' && x.method === 'GET'), null, { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(200);

    const shown = (id) => page.evaluate((i) => { const el = document.getElementById(i); return !!el && !el.hidden && el.getClientRects().length > 0; }, id);
    const text = (id) => page.evaluate((i) => document.getElementById(i).textContent, id);
    const focus = () => page.evaluate(() => document.activeElement && document.activeElement.id);
    const lis = (id) => page.evaluate((i) => [...document.querySelectorAll('#' + i + ' li')].map((li) => li.textContent), id);
    const mark = () => page.evaluate(() => window.__org.length);
    const posts = (n) => page.evaluate((k) => window.__org.slice(k).filter((x) => x.method === 'POST'), n);
    const setPreview = (p) => page.evaluate((v) => { window.__preview = v; }, p);
    const setEnroll = (a) => page.evaluate((v) => { window.__enrollAnswer = v; }, a);
    const reset = () => page.evaluate(() => { window.__joined = false; window.__enrollAnswer = null; });
    const open = async () => {
      if (!(await shown('plus-org-out'))) await page.click('#plus-org-open');
      await page.waitForFunction(() => { const el = document.getElementById('plus-org-out'); return el && !el.hidden; }, null, { timeout: 5000 }).catch(() => {});
    };
    // Connect, and settle on: the family's words, the joined view, or a line under the field.
    const connect = async (code) => {
      await page.evaluate(() => { document.getElementById('plus-org-msg').textContent = ''; });
      await page.fill('#plus-org-code', code);
      await page.click('#plus-org-check');
      await page.waitForFunction(() => !document.getElementById('plus-org-family').hidden || !document.getElementById('plus-org-in').hidden
        || document.getElementById('plus-org-msg').textContent !== '', null, { timeout: 5000 }).catch(() => {});
    };
    // Back to "not joined" through the page's own read of /api/org.
    const unjoin = async () => {
      await reset();
      await page.evaluate(async () => { PLUS_ORG.state = null; PLUS_ORG.open = false; plusOrgFamilyHide(); plusOrgPaint(); });
      await page.waitForTimeout(100);
    };
    const FAMILY = { org: { id: 'org_f', name: 'The Rivera family', slug: 'rivera', kind: 'family' }, consent: FAMILY_WORDS };
    const COMPANY = { org: { id: 'org_c', name: 'Acme', slug: 'acme', kind: 'company' }, consent: COMPANY_WORDS };

    // F0: a company joins at once, as before.
    await open();
    await setPreview(COMPANY);
    let m = await mark();
    await connect('ACME-CODE');
    let p = await posts(m);
    const enroll0 = p.find((x) => x.path === '/api/org/enroll');
    chk(!(await shown('plus-org-family')) && await shown('plus-org-in') && p.length === 2 && enroll0
        && JSON.stringify(Object.keys(enroll0.body).sort()) === JSON.stringify(['accepted', 'code', 'ticket']) && enroll0.body.accepted === true,
      E + ' F0 a company code joins at once: no family words, enroll is exactly { code, accepted, ticket }', JSON.stringify(p.map((x) => [x.path, x.body])));
    await unjoin();

    // F1: a family stops after the preview and shows its words.
    await open();
    await setPreview(FAMILY);
    m = await mark();
    await connect('RIVERA-CODE');
    p = await posts(m);
    const f1 = {
      box: await shown('plus-org-family'), lead: await text('plus-org-family-lead'), focus: await focus(),
      reports: await lis('plus-org-family-reports'), backs: await lis('plus-org-family-backsup'), readers: await lis('plus-org-family-readers'),
      never: await text('plus-org-family-never'), accept: (await text('plus-org-family-accept')).trim(), no: (await text('plus-org-family-no')).trim(),
      group: await page.evaluate(() => { const el = document.getElementById('plus-org-family'); return el.getAttribute('role') + '|' + el.getAttribute('aria-label'); }),
      joined: await shown('plus-org-in'),
    };
    chk(f1.box && !f1.joined && p.length === 1 && p[0].path === '/api/org/preview',
      E + ' F1 a family code stops after the preview: the words show and nothing is enrolled', JSON.stringify(p.map((x) => x.path)));
    chk(f1.lead.includes('The Rivera family is a family account.') && f1.lead.includes('parent or guardian') && f1.focus === 'plus-org-family-lead',
      E + ' F1 the lead names the family and the parent or guardian, and focus is on the words', JSON.stringify({ lead: f1.lead, focus: f1.focus }));
    chk(JSON.stringify(f1.reports) === JSON.stringify(FAMILY_WORDS.reports) && JSON.stringify(f1.backs) === JSON.stringify(FAMILY_WORDS.backsUp)
        && JSON.stringify(f1.readers) === JSON.stringify(FAMILY_WORDS.readers) && f1.never === 'Never sent: keys and passwords.',
      E + ' F1 every part of the words shows, as the coordinator sent it', JSON.stringify(f1));
    chk(f1.accept === 'Accept and join' && f1.no === 'Not now' && f1.group === "group|The family's words",
      E + ' F1 Accept and join, Not now, and a labelled group', JSON.stringify({ a: f1.accept, n: f1.no, g: f1.group }));
    // F11 (kosmos#6873): the rule, and the way to change account, which is on screen with the words.
    const acct = await text('plus-org-family-account');
    const RULE = 'On a child\u2019s computer, Kosmos+ must be signed in with the child\u2019s account, not the address you sign in with yourself; for a child under 13, one you made for them, at an email address you read.';
    const RECOVER = 'If this computer was signed in with your own address, press Not now, then Remove this computer, sign in again with the child\u2019s account, and enter the family\u2019s join code again.';
    chk(acct.startsWith(RULE) && acct.includes('Do not use a child\u2019s own email address for a child under 13.') && acct.endsWith(RECOVER) && !acct.includes('@')
        && await shown('plus-org-family-account') && await shown('plus-forget-go'),
      E + ' F11 the words say whose account this must be, name no address, and Remove this computer is on screen', JSON.stringify({ acct, remove: await shown('plus-forget-go') }));
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'org-family-words-' + engineName + '.png') });

    // F2: Accept and join sends wordsShown and joins.
    m = await mark();
    await page.click('#plus-org-family-accept');
    await page.waitForFunction(() => !document.getElementById('plus-org-in').hidden || document.getElementById('plus-org-msg').textContent !== '', null, { timeout: 5000 }).catch(() => {});
    p = await posts(m);
    const e2 = p.find((x) => x.path === '/api/org/enroll');
    chk(p.length === 1 && e2 && JSON.stringify(Object.keys(e2.body).sort()) === JSON.stringify(['accepted', 'code', 'ticket', 'wordsShown'])
        && e2.body.code === 'RIVERA-CODE' && e2.body.accepted === true && e2.body.wordsShown === true && typeof e2.body.ticket === 'string',
      E + ' F2 Accept and join sends exactly { code, accepted: true, ticket, wordsShown: true }', JSON.stringify(p.map((x) => x.body)));
    const f2 = { box: await shown('plus-org-family'), joined: await shown('plus-org-in'), msg: await text('plus-org-msg'), focus: await focus(), code: await page.inputValue('#plus-org-code') };
    chk(!f2.box && f2.joined && f2.msg === '' && f2.focus === 'plus-org-say' && f2.code === '',
      E + ' F2 joined: the words close, the joined view shows with no line under it, focus on its sentence', JSON.stringify(f2));
    await unjoin();

    // F3: Not now, then Escape inside the words.
    for (const how of ['button', 'escape']) {
      await open();
      await setPreview(FAMILY);
      await connect('RIVERA-CODE');
      m = await mark();
      if (how === 'button') await page.click('#plus-org-family-no');
      else { await page.focus('#plus-org-family-lead'); await page.keyboard.press('Escape'); }
      await page.waitForTimeout(150);
      p = await posts(m);
      const f3 = { box: await shown('plus-org-family'), msg: await text('plus-org-msg'), focus: await focus(), joined: await shown('plus-org-in') };
      chk(!f3.box && !f3.joined && p.length === 0 && f3.msg === 'Nothing was joined.' && f3.focus === 'plus-org-code',
        E + ' F3 ' + (how === 'button' ? 'Not now' : 'Escape in the words') + ' joins nothing, says so, focus on the code field', JSON.stringify(f3));
    }

    // F4: another code typed over the words closes them.
    await setPreview(FAMILY);
    await connect('RIVERA-CODE');
    const before4 = await shown('plus-org-family');
    await page.type('#plus-org-code', 'X');
    await page.waitForTimeout(100);
    chk(before4 && !(await shown('plus-org-family')), E + ' F4 typing another code closes the words', JSON.stringify({ before4 }));

    // F5: a refusal with a code closes the words; org_bad_world keeps them.
    await page.fill('#plus-org-code', '');
    await setPreview(FAMILY);
    await connect('RIVERA-CODE');
    await setEnroll({ ok: false, code: 'org_family_words_unseen', because: 'A family joins only after a parent reads its words.' });
    await page.click('#plus-org-family-accept');
    await page.waitForFunction(() => document.getElementById('plus-org-msg').textContent !== '', null, { timeout: 5000 }).catch(() => {});
    const f5a = { box: await shown('plus-org-family'), msg: await text('plus-org-msg'), focus: await focus(), joined: await shown('plus-org-in') };
    chk(!f5a.box && !f5a.joined && f5a.msg === 'A family joins only after a parent reads its words.' && f5a.focus === 'plus-org-check',
      E + ' F5 a refusal with a code closes the words, says why, focus on Connect', JSON.stringify(f5a));
    await setEnroll(null);
    await setPreview(FAMILY);
    await connect('RIVERA-CODE');
    await setEnroll({ ok: false, code: 'org_bad_world', because: 'This is not your work Kosmos.' });
    await page.click('#plus-org-family-accept');
    await page.waitForFunction(() => document.getElementById('plus-org-msg').textContent !== '', null, { timeout: 5000 }).catch(() => {});
    const f5b = { box: await shown('plus-org-family'), msg: await text('plus-org-msg') };
    chk(f5b.box && f5b.msg === 'This is not your work Kosmos.', E + ' F5 org_bad_world keeps the words up', JSON.stringify(f5b));
    await setEnroll(null);
    await page.click('#plus-org-family-no');

    // F6: a family that backs up nothing, with no readers listed.
    await setPreview({ org: FAMILY.org, consent: { reports: ['project names'], backsUp: [], backsUpNone: true, readers: [], never: [] } });
    await connect('RIVERA-CODE');
    const f6 = { backs: await lis('plus-org-family-backsup'), backsHead: await shown('plus-org-family-backsup-head'),
      readersHead: await shown('plus-org-family-readers-head'), never: await text('plus-org-family-never') };
    chk(JSON.stringify(f6.backs) === JSON.stringify(['Nothing is backed up.']) && f6.backsHead && !f6.readersHead && f6.never === '',
      E + ' F6 "Nothing is backed up." shows; an empty part hides its heading; no never line is invented', JSON.stringify(f6));
    await page.click('#plus-org-family-no');

    // F7: a family member moving here joins with no code, still only after Accept.
    await page.fill('#plus-org-code', '');
    await setPreview(Object.assign({ move: true }, FAMILY));
    m = await mark();
    await connect('RIVERA-CODE');
    const mid7 = await posts(m);
    await page.click('#plus-org-family-accept');
    await page.waitForFunction(() => !document.getElementById('plus-org-in').hidden, null, { timeout: 5000 }).catch(() => {});
    p = await posts(m);
    const e7 = p.find((x) => x.path === '/api/org/enroll');
    chk(mid7.length === 1 && e7 && !('code' in e7.body) && e7.body.wordsShown === true && e7.body.accepted === true,
      E + ' F7 a move joins only after Accept, with no code and wordsShown', JSON.stringify(p.map((x) => x.body)));
    await unjoin();

    // F8: 390 wide.
    await page.setViewportSize({ width: 390, height: 844 });
    await open();
    await setPreview(FAMILY);
    await connect('RIVERA-CODE');
    const f8 = await page.evaluate(() => {
      const box = document.getElementById('plus-org-family').getBoundingClientRect();
      return { box: !document.getElementById('plus-org-family').hidden, right: Math.round(box.right), vw: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth > document.documentElement.clientWidth };
    });
    chk(f8.box && f8.right <= f8.vw && !f8.scroll, E + ' F8 390 wide: the words fit, no sideways scroll', JSON.stringify(f8));
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'org-family-words-phone-' + engineName + '.png'), fullPage: false });

    // R: a family's changed words, from the joined view.
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.evaluate(() => { plusOrgFamilyHide(); document.getElementById('plus-org-code').value = ''; document.getElementById('plus-org-msg').textContent = ''; });
    const WAITING = { enrolled: true, reporting: false, reportingWait: null, wordsNeeded: true, stoppedFor: null, leaveRefused: null, org: { name: 'The Rivera family', slug: 'rivera', kind: 'family' }, role: 'member', enrolledAt: '2026-10-15T00:00:00.000Z' };
    const reread = async (st) => { await page.evaluate((v) => { window.__orgState = v; PLUS_ORG.at = 0; plusOrgMaybe(); }, st); await page.waitForTimeout(250); };
    await reread(WAITING);
    const r1 = { joined: await shown('plus-org-in'), say: await text('plus-org-say'), row: await shown('plus-org-words'), label: (await text('plus-org-words')).trim(),
      tab: sayTab0 };
    chk(r1.joined && r1.row && r1.label === "Read the family's words" && r1.tab === '-1' && r1.say.includes('reports nothing until a parent or guardian reads and accepts them'),
      E + ' R1 a family whose words changed says reports wait for a parent, and offers them', JSON.stringify(r1));
    const REVIEW = { move: true, review: true, org: FAMILY.org, consent: FAMILY_WORDS };
    const openReview = async () => {
      await setPreview(REVIEW);
      await page.click('#plus-org-words');
      await page.waitForFunction(() => !document.getElementById('plus-org-family').hidden || document.getElementById('plus-org-msg').textContent !== '', null, { timeout: 5000 }).catch(() => {});
    };
    m = await mark();
    await openReview();
    p = await posts(m);
    const r2 = { box: await shown('plus-org-family'), lead: await text('plus-org-family-lead'), accept: (await text('plus-org-family-accept')).trim(), focus: await focus(), row: await shown('plus-org-words') };
    chk(p.length === 1 && p[0].path === '/api/org/preview' && JSON.stringify(p[0].body) === JSON.stringify({ review: true }),
      E + ' R2 Read the family\'s words asks for exactly { review: true }', JSON.stringify(p.map((x) => [x.path, x.body])));
    chk((await text('plus-org-family-account')).startsWith('On a child\u2019s computer, Kosmos+ must be signed in with the child\u2019s account')
        && (await text('plus-org-family-account')).endsWith('and enter the family\u2019s join code again.') && await shown('plus-forget-go'),
      E + ' F11 the review flow says whose account this must be, and Remove this computer is on screen');
    chk(r2.box && r2.lead.includes('Its words are not accepted on this computer') && r2.lead.includes('parent or guardian') && r2.accept === 'Accept' && r2.focus === 'plus-org-family-lead' && !r2.row,
      E + ' R2 the words show as not accepted here, with Accept, focus on them, and the button folds', JSON.stringify(r2));
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'org-family-review-' + engineName + '.png') });
    m = await mark();
    await page.click('#plus-org-family-no');
    await page.waitForTimeout(150);
    const r3 = { box: await shown('plus-org-family'), msg: await text('plus-org-msg'), focus: await focus(), posts: (await posts(m)).length };
    chk(!r3.box && r3.posts === 0 && r3.msg === 'Nothing was accepted. This computer still reports nothing to the family.' && r3.focus === 'plus-org-words',
      E + ' R3 Not now accepts nothing, says so, focus back on the button', JSON.stringify(r3));
    await openReview();
    await setEnroll({ ok: false, code: 'org_consent_changed', because: 'Your family changed its terms again since Kosmos read them. Nothing changed here; Kosmos tries again on its own.' });
    await page.click('#plus-org-family-accept');
    await page.waitForFunction(() => document.getElementById('plus-org-family').hidden, null, { timeout: 5000 }).catch(() => {});
    const r5 = { box: await shown('plus-org-family'), focus: await focus(), msg: await text('plus-org-msg') };
    chk(!r5.box && r5.focus === 'plus-org-words' && r5.msg === 'Your family changed its terms again since Kosmos read them. Nothing changed here. Press Read the family\u2019s words to read them again.',
      E + ' R5 a refusal with a code closes the words, keeps the reason without "tries again on its own", says to read them again', JSON.stringify(r5));
    await setEnroll({ ok: true, org: { name: 'The Rivera family', slug: 'rivera', kind: 'family' }, role: 'member' });
    await openReview();
    m = await mark();
    await page.evaluate(() => { window.__orgState = { enrolled: true, reporting: true, reportingWait: null, wordsNeeded: false, stoppedFor: null, leaveRefused: null, org: { name: 'The Rivera family', slug: 'rivera', kind: 'family' }, role: 'member', enrolledAt: '2026-10-15T00:00:00.000Z' }; });
    await page.click('#plus-org-family-accept');
    await page.waitForFunction(() => document.getElementById('plus-org-family').hidden, null, { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(300);
    p = await posts(m);
    const e4 = p.find((x) => x.path === '/api/org/enroll');
    chk(e4 && JSON.stringify(Object.keys(e4.body).sort()) === JSON.stringify(['accepted', 'ticket', 'wordsShown']) && e4.body.wordsShown === true && e4.body.accepted === true,
      E + ' R4 Accept sends exactly { accepted: true, ticket, wordsShown: true }, no code', JSON.stringify(p.map((x) => x.body)));
    const r4 = { row: await shown('plus-org-words'), say: await text('plus-org-say'), joined: await shown('plus-org-in'),
      // posts() keeps only POSTs, so the re-read is counted from the full log after the mark.
      reread: await page.evaluate((k) => window.__org.slice(k).some((x) => x.path === '/api/org' && x.method === 'GET'), m) };
    chk(r4.joined && !r4.row && !r4.say.includes('reports nothing until') && r4.reread,
      E + ' R4 accepted: the page reads /api/org again and the joined view stops waiting for a parent', JSON.stringify(r4));
    // kosmos#6565: a family's joined line says "in", never the company wording "your work Kosmos for".
    chk(r4.say === 'This Kosmos is in The Rivera family.' && !r4.say.includes('work Kosmos'),
      E + ' R4 a family\u2019s joined line reads "This Kosmos is in" the family, with no "work Kosmos"', JSON.stringify(r4.say));
    /* kosmos#6567: two sentences outside plusOrgIn. W1: the board's leave refusal on a stale joined screen is a plain
       server sentence, said through plusOrgIn with the org the page left. W2: the stopped note, written once the record
       is gone, says "is no longer in" for a family (the engine keeps the kind, GET /api/org sends stoppedKind). Each
       beside a company CONTROL, which keeps the company's words. */
    const REFUSAL = 'This Kosmos is not your work Kosmos. Leave from your work Kosmos.';
    for (const [who, org, want] of [['a family', { name: 'The Rivera family', slug: 'rivera', kind: 'family' }, 'This Kosmos is not your family\'s Kosmos. Leave from your family\'s Kosmos.'],
      ['CONTROL a company', { name: 'Acme', slug: 'acme', kind: 'company' }, REFUSAL]]) {
      const joinedSt = Object.assign({}, WAITING, { wordsNeeded: false, reporting: true, org });
      await reread(joinedSt);
      await page.evaluate((a) => { window.__leaveAnswer = a; document.getElementById('plus-org-msg').textContent = ''; }, { ok: false, because: REFUSAL });
      await page.click('#plus-org-leave');
      await page.click('#plus-org-leave-yes');
      await page.waitForFunction(() => document.getElementById('plus-org-msg').textContent !== '', null, { timeout: 5000 }).catch(() => {});
      const w1 = await text('plus-org-msg');
      chk(w1 === want, E + ' W1 #6567 ' + who + '\u2019s leave refused on a stale joined screen reads in its own words', JSON.stringify(w1));
      await page.evaluate(() => { window.__leaveAnswer = null; });
    }
    for (const [who, kind, want] of [['a family', 'family', 'This Kosmos is no longer in The Rivera family, so it has stopped reporting.'],
      ['CONTROL a company', 'company', 'This Kosmos is no longer the work Kosmos for The Rivera family, so it has stopped reporting.']]) {
      await page.evaluate(() => { document.getElementById('plus-org-msg').textContent = ''; });
      await reread({ enrolled: false, stoppedFor: 'The Rivera family', stoppedKind: kind, leaveRefused: null, org: null, role: null, enrolledAt: null });
      const w2 = await text('plus-org-msg');
      chk(w2 === want, E + ' W2 #6567 ' + who + '\u2019s stopped note reads in its own words', JSON.stringify(w2));
    }
    await page.evaluate(() => { document.getElementById('plus-org-msg').textContent = ''; });
    await setEnroll(null);
    for (const [label, st] of [['a company with its terms gone', Object.assign({}, WAITING, { wordsNeeded: false, org: { name: 'Acme', slug: 'acme' } })],
      ['a family whose words are accepted', Object.assign({}, WAITING, { wordsNeeded: false, reporting: true })]]) {
      if (st.org.slug === 'acme') st.org = { name: 'Acme', slug: 'acme', kind: 'company' };
      await reread(st);
      chk(await shown('plus-org-in') && !(await shown('plus-org-words')), E + ' R6 ' + label + ' is offered nothing to read');
    }
    // R7: a review refused with no code keeps the words; Leave with the words open closes them.
    await reread(WAITING);
    await openReview();
    await setEnroll({ ok: false, because: 'It is not known whether accepting reached your family. Nothing changed on this computer; Kosmos tries again on its own.' });
    await page.click('#plus-org-family-accept');
    await page.waitForFunction(() => document.getElementById('plus-org-msg').textContent !== '', null, { timeout: 5000 }).catch(() => {});
    const r7a = { box: await shown('plus-org-family'), msg: await text('plus-org-msg') };
    chk(r7a.box && r7a.msg === 'It is not known whether accepting reached your family. Nothing changed on this computer. Press Accept to try again.',
      E + ' R7 a review refused with no code keeps the words and the engine\'s reason, and says to press Accept again', JSON.stringify(r7a));
    await setEnroll(null);
    await page.evaluate(() => { window.__leaveAnswer = { ok: true }; window.__orgState = { enrolled: false, stoppedFor: null, leaveRefused: null, org: null, role: null, enrolledAt: null }; });
    await page.click('#plus-org-leave');
    await page.click('#plus-org-leave-yes');
    await page.waitForTimeout(300);
    const r7b = { box: await shown('plus-org-family'), joined: await shown('plus-org-in') };
    chk(!r7b.box && !r7b.joined, E + ' R7 Leave with the words open closes them', JSON.stringify(r7b));
    await page.evaluate(() => { window.__orgState = null; });

    // R8: no longer in the family: the engine's reason, nothing to read.
    await reread(WAITING);
    await openReview();
    await setEnroll({ ok: false, code: 'org_not_member', because: 'Your family says this account is no longer in it. Nothing changed on this computer.' });
    m = await mark();
    await page.click('#plus-org-family-accept');
    await page.waitForFunction(() => document.getElementById('plus-org-family').hidden, null, { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(250);
    const r8 = { msg: await text('plus-org-msg'), focus: await focus(), row: await shown('plus-org-words'), say: await text('plus-org-say'),
      reread: await page.evaluate((k) => window.__org.slice(k).some((x) => x.path === '/api/org' && x.method === 'GET'), m) };
    chk(r8.msg === 'Your family says this account is no longer in it. Nothing changed on this computer.' && r8.focus === 'plus-org-say' && r8.reread && !r8.row
        && r8.say.includes('reports nothing to the family') && !r8.say.includes('accepts'),
      E + ' R8 no longer in the family: the engine\'s reason, the view read again, the words button not offered again, nobody asked to accept', JSON.stringify(r8));
    // R14: held-back words do not outlive this membership. Leave (no read for a minute after it), join the family again,
    // and the next read still says the words are needed: the button is offered with the line that names it.
    await setEnroll(null);   // R8 left the stand-in refusing every enroll as "no longer in the family"
    await page.evaluate((st) => { window.__leaveAnswer = { ok: true }; window.__orgState = st; }, WAITING);
    await page.click('#plus-org-leave');
    await page.click('#plus-org-leave-yes');
    await page.waitForTimeout(300);
    await open();
    await setPreview(FAMILY);
    await connect('RIVERA-CODE');
    if (await shown('plus-org-family')) await page.click('#plus-org-family-accept');
    await page.waitForFunction(() => document.getElementById('plus-org-msg').textContent !== '', null, { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(250);
    const r14 = { msg: await text('plus-org-msg'), row: await shown('plus-org-words') };
    chk(r14.row && r14.msg === 'Kosmos+ took the family’s words, but this computer could not record them, so it still reports nothing. Press Read the family’s words to try again.',
      E + ' R14 after a leave and a new join, the words are offered again with the line that names them', JSON.stringify(r14));
    await page.evaluate(() => { window.__leaveAnswer = null; document.getElementById('plus-org-msg').textContent = ''; });
    // R11: org_bad_world keeps the ticket and the words; Accept works again.
    await reread(WAITING);
    await openReview();
    await setEnroll({ ok: false, code: 'org_bad_world', because: 'Your family did not take the acceptance. Nothing changed on this computer; Kosmos tries again on its own.' });
    await page.click('#plus-org-family-accept');
    await page.waitForFunction(() => document.getElementById('plus-org-msg').textContent !== '', null, { timeout: 5000 }).catch(() => {});
    const r11 = { box: await shown('plus-org-family'), msg: await text('plus-org-msg') };
    chk(r11.box && r11.msg === 'Your family did not take the acceptance. Nothing changed on this computer. Press Accept to try again.',
      E + ' R11 org_bad_world keeps the words and says to press Accept again', JSON.stringify(r11));
    if (r11.box) await page.click('#plus-org-family-no');
    await setEnroll(null);
    // R12: the review preview itself refused: the reason shows and the view is read again.
    await reread(WAITING);
    await setPreview({ ok: false, because: 'This Kosmos already has its family\u2019s words accepted here.' });
    m = await mark();
    await page.click('#plus-org-words');
    await page.waitForTimeout(300);
    const r12 = { msg: await text('plus-org-msg'), box: await shown('plus-org-family'),
      reread: await page.evaluate((k) => window.__org.slice(k).some((x) => x.path === '/api/org' && x.method === 'GET'), m) };
    chk(r12.msg === 'This Kosmos already has its family\u2019s words accepted here.' && !r12.box && r12.reread,
      E + ' R12 a refused review preview says why and reads /api/org again', JSON.stringify(r12));
    await page.evaluate(() => { document.getElementById('plus-org-msg').textContent = ''; });
    // R13: a read that says the words are accepted here closes an open review.
    await reread(WAITING);
    await openReview();
    const open13 = await shown('plus-org-family');
    await reread(Object.assign({}, WAITING, { wordsNeeded: false, reporting: true }));
    const r13 = { open13, box: await shown('plus-org-family'), row: await shown('plus-org-words') };
    chk(r13.open13 && !r13.box && !r13.row, E + ' R13 a read that says the words are accepted closes an open review', JSON.stringify(r13));
    // R15: a review answered as not a family's: says so, and the words stay held back across a read of the same record.
    await reread(WAITING);
    await setPreview({ move: true, review: true, org: COMPANY.org, consent: COMPANY_WORDS });
    await page.click('#plus-org-words');
    await page.waitForTimeout(300);
    const r15 = { msg: await text('plus-org-msg'), box: await shown('plus-org-family'), row0: await shown('plus-org-words') };
    await reread(WAITING);
    Object.assign(r15, { row: await shown('plus-org-words'), say: await text('plus-org-say'), focus: await focus() });
    chk(r15.msg === 'Kosmos+ did not answer as a family account, so there are no family words to read here.' && !r15.box && !r15.row0 && !r15.row
        && !r15.say.includes('accepts') && r15.focus === 'plus-org-say', E + ' R15 a review answered as not a family\'s says so, the words stay held back, focus on the joined sentence', JSON.stringify(r15));
    // A read that says the words are no longer needed releases them.
    await reread(Object.assign({}, WAITING, { wordsNeeded: false, reporting: true }));
    await page.evaluate(() => { document.getElementById('plus-org-msg').textContent = ''; });
    // R16: a review preview refused because the family no longer names this computer holds the words back (R8's twin).
    await reread(WAITING);
    await setPreview({ ok: false, code: 'org_not_named', because: 'Your family does not name this Kosmos as your family\'s Kosmos right now, so there is nothing to accept here.' });   // kosmos#6565: the engine (inKind) words it so now
    await page.click('#plus-org-words');
    await page.waitForTimeout(300);
    const r16 = { msg: await text('plus-org-msg'), row: await shown('plus-org-words'), say: await text('plus-org-say'), focus: await focus() };
    chk(r16.msg.startsWith('Your family does not name this Kosmos') && !r16.row && !r16.say.includes('accepts') && r16.focus === 'plus-org-say',
      E + ' R16 a review preview refused as not named here holds the words back, focus on the joined sentence', JSON.stringify(r16));
    await reread(Object.assign({}, WAITING, { wordsNeeded: false, reporting: true }));
    await page.evaluate(() => { document.getElementById('plus-org-msg').textContent = ''; });
    // R17: a read older than the page's own write is dropped, and its one-time note is carried to the next read.
    await page.evaluate(() => { PLUS_ORG.wroteAt = Date.now() + 2000; });
    await reread(Object.assign({}, WAITING, { org: { name: 'Stale family', slug: 'stale', kind: 'family' }, leaveRefused: 'The Rivera family' }));
    const r17a = { say: await text('plus-org-say') };
    // The stand-in stops carrying the note BEFORE reads are let through, so only the carried copy can show it.
    const after17 = Object.assign({}, WAITING, { wordsNeeded: false, reporting: true });
    await page.evaluate((st) => { window.__orgState = st; PLUS_ORG.wroteAt = 0; }, after17);
    await reread(after17);   // a read is sure to happen, whether or not the carried re-read already ran
    const r17 = Object.assign(r17a, { msg: await text('plus-org-msg') });
    chk(!r17.say.includes('Stale family') && r17.msg.includes('Your leave from The Rivera family was refused'),
      E + ' R17 an older read is dropped and its one-time note shows on the next read', JSON.stringify(r17));
    await page.evaluate(() => { document.getElementById('plus-org-msg').textContent = ''; });
    // R18: a read asked before the page's own write (an Accept, then a Leave) lands after it and changes nothing.
    const holdRead = () => page.evaluate(() => { window.__holdNext = new Promise((r) => { window.__releaseRead = r; }); PLUS_ORG.at = 0; plusOrgMaybe(); });
    const releaseRead = async () => { await page.evaluate(() => window.__releaseRead()); await page.waitForTimeout(300); };
    await reread(WAITING);
    await openReview();
    await holdRead();
    await page.evaluate(() => { window.__orgState = { enrolled: true, reporting: true, reportingWait: null, wordsNeeded: false, stoppedFor: null, leaveRefused: null, org: { name: 'The Rivera family', slug: 'rivera', kind: 'family' }, role: 'member', enrolledAt: '2026-10-15T00:00:00.000Z' }; });
    await setEnroll({ ok: true, org: { name: 'The Rivera family', slug: 'rivera', kind: 'family' }, role: 'member' });
    await page.click('#plus-org-family-accept');
    await page.waitForTimeout(300);
    await releaseRead();
    const r18a = { row: await shown('plus-org-words'), say: await text('plus-org-say'), msg: await text('plus-org-msg') };
    await setEnroll(null);
    await holdRead();
    await page.evaluate(() => { window.__leaveAnswer = { ok: true }; });
    await page.click('#plus-org-leave');
    await page.click('#plus-org-leave-yes');
    await page.waitForTimeout(300);
    await releaseRead();
    const r18b = { joined: await shown('plus-org-in') };
    chk(!r18a.row && !r18a.say.includes('reports nothing until') && !r18a.msg.includes('could not record') && !r18b.joined,
      E + ' R18 a read asked before an Accept or a Leave lands after it and changes nothing', JSON.stringify([r18a, r18b]));
    await page.evaluate(() => { window.__leaveAnswer = null; window.__orgState = null; document.getElementById('plus-org-msg').textContent = ''; });
    await reread(WAITING);
    // R19: signed out of Kosmos+ with the words open: they close, and do not come back on signing in again.
    await openReview();
    const open19 = await shown('plus-org-family');
    await page.evaluate(() => { PLUS_ORG.wordsRefused = true; });   // as after R8, so the release is seen too
    // The board's own repaint, signed out and then in again (paintPlus reads /api/remote).
    await page.evaluate(async () => { window.__remote = { enrolled: false }; await paintPlus(); });
    await page.evaluate(async () => { window.__remote = null; await paintPlus(); plusOrgPaint(); });
    await reread(WAITING);
    const r19 = { open19, box: await shown('plus-org-family'), plus: await shown('plus-org'), row: await shown('plus-org-words') };
    chk(r19.open19 && r19.plus && !r19.box && r19.row, E + ' R19 signing out closes the family\'s words and releases held-back words: signed in again, the button is back', JSON.stringify(r19));
    // R20: what the sign-in left is not shown after signing in again. A one-time note carried from a dropped read, a
    // pending "could not record" check from an Accept, and the once-a-minute gate are each planted, then signed out and in:
    // the first signed-in paint reads at once (the gate reset), and neither old line shows on what it reads.
    await reread(WAITING);
    await page.evaluate(() => { document.getElementById('plus-org-msg').textContent = '';
      PLUS_ORG.carried = { stoppedFor: null, leaveRefused: 'The Old family', leaveRefusedUndo: false };
      PLUS_ORG.reviewAccepted = Date.now() - 1000; PLUS_ORG.at = Date.now(); });
    await page.evaluate(async () => { window.__remote = { enrolled: false }; await paintPlus(); });
    m = await mark();
    await page.evaluate(async () => { window.__remote = null; await paintPlus(); });
    await page.waitForTimeout(300);
    const r20 = { read: await page.evaluate((k) => window.__org.slice(k).some((x) => x.path === '/api/org' && x.method === 'GET'), m),
      msg: await text('plus-org-msg') };
    chk(r20.read && !r20.msg.includes('The Old family') && !r20.msg.includes('could not record'),
      E + ' R20 signing out drops a carried note, a pending could-not-record check and the read gate', JSON.stringify(r20));
    await page.evaluate(() => { document.getElementById('plus-org-msg').textContent = ''; });
    // R9: a leave refused (the last admin) while the words are needed.
    await page.evaluate((st) => { window.__orgState = Object.assign({}, st, { leaveRefused: 'The Rivera family' }); PLUS_ORG.at = 0; plusOrgMaybe(); }, WAITING);
    await page.waitForTimeout(250);
    const r9 = await text('plus-org-msg');
    chk(r9.includes('reports nothing until a parent or guardian reads and accepts the family\u2019s words') && !r9.includes('once Kosmos has'),
      E + ' R9 a refused leave while the words are needed says a parent is needed', r9);
    await page.evaluate(() => { document.getElementById('plus-org-msg').textContent = ''; });
    // R10: Accept taken, and the next read still says the words are needed.
    await reread(WAITING);
    await openReview();
    await setEnroll({ ok: true, org: { name: 'The Rivera family', slug: 'rivera', kind: 'family' }, role: 'member' });
    await page.click('#plus-org-family-accept');
    await page.waitForFunction(() => document.getElementById('plus-org-msg').textContent !== '', null, { timeout: 5000 }).catch(() => {});
    const r10 = { msg: await text('plus-org-msg'), row: await shown('plus-org-words') };
    chk(r10.msg === 'Kosmos+ took the family\u2019s words, but this computer could not record them, so it still reports nothing. Press Read the family\u2019s words to try again.' && r10.row,
      E + ' R10 an Accept the next read contradicts says so, and offers the words again', JSON.stringify(r10));
    await setEnroll(null);
    await page.evaluate(() => { window.__orgState = null; document.getElementById('plus-org-msg').textContent = ''; });

    // F10: the block held open only by a line under it; a family's words then hold it open, with the code above them.
    // Not joined again first: R10's Accept left the stand-in board joined, and a join panel never shows over a joined view.
    await page.evaluate(() => { window.__joined = false; window.__orgState = null; window.__enrollAnswer = null; PLUS_ORG.state = { enrolled: false, org: null, role: null }; });
    await page.evaluate(() => { PLUS_ORG.open = false; plusOrgFamilyHide(); document.getElementById('plus-org-code').value = ''; document.getElementById('plus-org-msg').textContent = 'Nothing was joined.'; plusOrgPaint(); });
    await setPreview(FAMILY);
    await page.fill('#plus-org-code', 'RIVERA-CODE');
    await page.click('#plus-org-check');
    await page.waitForFunction(() => !document.getElementById('plus-org-family').hidden, null, { timeout: 5000 }).catch(() => {});
    await page.evaluate(() => plusOrgPaint());   // the board's own repaint
    const f10 = { box: await shown('plus-org-family'), out: await shown('plus-org-out'), opener: await shown('plus-org-open') };
    chk(f10.box && f10.out && !f10.opener, E + ' F10 a family\'s words hold the block open across a repaint, with the code above them', JSON.stringify(f10));
    // Only when it is there: a hidden button would wait out Playwright's timeout and end the run with no verdict line.
    if (f10.box) await page.click('#plus-org-family-no');

    chk(errs.length === 0, E + ' F9 no page errors', errs.join(' | '));
  } catch (e) {
    // A step that throws (a click that times out, say) is a FAIL with its name, never a run that ends with no verdict.
    chk(false, E + ' the run stopped: ' + ((e && e.message) || e).toString().split('\n')[0]);
  } finally {
    await browser.close();
  }
}

(async () => {
  for (const engineName of ['chromium', 'webkit']) await run(engineName);
  console.log(fail.length ? '\n' + fail.length + ' FAILED' : '\nall passed');
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
