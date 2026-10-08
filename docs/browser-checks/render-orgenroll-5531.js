#!/usr/bin/env node
/*
 * #5531 (Enterprise E0.2, umbrella #5529): Settings > Kosmos+ > Your company, the block where a person joins this
 * Kosmos to a company. Runs the real page (web/index.html, file://) with fetch answered by a stand-in for the board's
 * /api/org routes, so nothing reaches a board or a coordinator, and drives the block directly.
 *
 *   O0  no company: only a one-line opener shows; no heading, code field, consent or joined line (10-08).
 *   O1  opened: the heading and the code field show; the consent and the joined line do not.
 *   O17 on a fresh page: a failed /api/org read still shows only the opener; an already joined Kosmos shows its joined
 *       view and heading at once, with no opener (review 1).
 *   O2  Check code shows the company, the role and the four consent lists, drawn as TEXT (a string with markup in it
 *       stays visible text, no element is made), and moves focus to Join.
 *   O3  Not now sends NOTHING more (no enroll request) and says nothing was sent about this Kosmos.
 *   O4  Join sends exactly { code, accepted: true, ticket } to /api/org/enroll, and the block then says this is the work Kosmos.
 *   O5  Leave asks first; Leave then posts /api/org/leave and the code field returns.
 *   O6  no page errors.
 *   O7  a member moving here sees the consent as a move, and Join sends no code.
 *   O8  a Kosmos the company stopped naming says so (stoppedFor from /api/org), as text.
 *   O9  a leave that ends only on this computer (localOnly) says the membership goes on, never "You left".
 *   O10 a company consent with an EMPTY never list still shows this Kosmos's own line: other Kosmoses are not part of it.
 *   O11 a leave refused before anything was done (the route's "not your work Kosmos", the screen check's { error })
 *       keeps the joined view and says why, never "stopped reporting" (#5531 review 19).
 *   O15 a joined Kosmos that sends nothing offers "Review what your company sees": the consent, Accept with no code, and a
 *       Not now that changes nothing; words open too long point back at the Review button; a Kosmos that reports is not
 *       offered it (#5531 follow-up).
 *   O14 a join whose outcome is not known yet, or whose undo is still to send, goes back to the code field and says so:
 *       the consent (and its "Not now", which would say nothing was joined) is gone (#5531 review 25).
 *   O12 a retried leave the company refused as the last admin (leaveRefused from /api/org) says so, as text, with the
 *       joined view back: the person was told it had stopped (#5531 review 21).
 *   O13 a company that SAID it backs up nothing (backsUpNone) gets "Nothing is backed up." under its heading, muted and
 *       unbulleted; an empty list it did not state (backsUpNone false) hides the group; with a list, the list.
 */
const path = require('node:path');
const { chromium } = require('playwright');

const PAGE = 'file://' + path.join(path.resolve(__dirname, '..', '..'), 'web', 'index.html');
const SHOTS = process.argv[2] || null;
const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

const CONSENT = {
  reports: ['agent names, the AI provider and model each uses', 'project names <b>bold?</b>'],
  backsUp: ['agent folders and their files', 'transcripts'],
  readers: ['you', "your company's recovery role, only by restoring it, and every restore is logged and shown to you"],
  never: ['your other Kosmoses on this computer', 'keys and passwords'],
};

function harness() {
  return ([consent]) => {
    window.setInterval = () => 0;
    window.__org = [];
    const enc = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
    window.fetch = async (url, init) => {
      const u = String(url);
      const body = init && init.body ? JSON.parse(init.body) : null;
      if (u.includes('/api/org')) window.__org.push({ path: u.replace(/^.*?(\/api\/org[^?]*).*$/, '$1'), method: (init && init.method) || 'GET', body });
      if (u.endsWith('/api/org/preview')) return enc(Object.assign({ ok: true, org: { id: 'org_1', name: 'Acme', slug: 'acme' }, role: 'member', consent: window.__noNever ? Object.assign({}, consent, { never: [] }) : window.__noBackup ? Object.assign({}, consent, { backsUp: [], backsUpNone: window.__noBackup === 'said' }) : consent, ticket: 't-' + Date.now() }, window.__review ? { move: true, review: true } : window.__move ? { move: true } : {}));
      if (u.endsWith('/api/org/enroll')) return enc(window.__enrollAnswer || { ok: true, org: { id: 'org_1', name: 'Acme', slug: 'acme' }, role: 'member' });
      if (u.endsWith('/api/org/leave')) return enc(window.__leaveRefused || (window.__localOnly ? { ok: true, localOnly: true } : { ok: true }));
      if (u.endsWith('/api/org') && window.__orgFail) throw new Error('offline');
      if (u.endsWith('/api/org') && window.__orgState) return enc(window.__orgState);
      if (u.endsWith('/api/org')) return enc(window.__refused
        ? { enrolled: true, reporting: window.__notReporting !== true, stoppedFor: null, leaveRefused: window.__refused, leaveRefusedUndo: window.__refusedUndo === true, org: { name: 'Acme', slug: 'acme' }, role: 'admin', enrolledAt: '2026-10-07T00:00:00.000Z' }
        : { enrolled: false, stoppedFor: window.__stopped || null, leaveRefused: null, org: null, role: null, enrolledAt: null });
      if (u.endsWith('/api/remote') && !(init && init.method)) return enc({ enrolled: true, on: true });   // a connected computer
      if (u.includes('/api/history')) return enc({ readable: false });   // Settings' history row, in the shape the engine sends when it has none
      return enc({});
    };
  };
}
const shown = (pg, id) => pg.evaluate((i) => { const el = document.getElementById(i); return !!el && !el.hidden && el.getClientRects().length > 0; }, id);

(async () => {
  const browser = await chromium.launch();
  const errs = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    page.on('pageerror', (e) => errs.push(e.message));
    await page.addInitScript(harness(), [CONSENT]);
    await page.goto(PAGE);
    // The block lives in the connected Kosmos+ panel. Open Settings at Kosmos+ the page's own way and let its real paint
    // (a connected computer, from the stubbed /api/remote) show the block and fetch /api/org.
    if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }   // as sibling checks do
    await page.evaluate(() => { showTab('settings'); settingsGo('plus'); });
    // Wait for the paint itself (review 1): the page's first read of /api/org, then a frame.
    await page.waitForFunction(() => (window.__org || []).some((x) => x.path === '/api/org' && x.method === 'GET'), null, { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(200);
    // A person with no company sees ONE quiet line, not an Enterprise box (Splinter/Josh 10-08, before 0.7.29 ships).
    const o0 = { opener: await shown(page, 'plus-org-open'), heading: await shown(page, 'plus-org-title'), out: await shown(page, 'plus-org-out'), consent: await shown(page, 'plus-org-consent'), in: await shown(page, 'plus-org-in') };
    chk(o0.opener && !o0.heading && !o0.out && !o0.consent && !o0.in, 'O0 no company: only the one-line opener shows, no "Your company" box', JSON.stringify(o0));
    await page.click('#plus-org-open');
    await page.waitForFunction(() => { const el = document.getElementById('plus-org-out'); return el && !el.hidden && el.getClientRects().length > 0; }, null, { timeout: 10000 }).catch(() => {});
    const o1 = { out: await shown(page, 'plus-org-out'), consent: await shown(page, 'plus-org-consent'), in: await shown(page, 'plus-org-in'), heading: await shown(page, 'plus-org-title'), opener: await shown(page, 'plus-org-open') };
    chk(o1.out && o1.heading && !o1.opener && !o1.consent && !o1.in, 'O1 opened: the heading and code field show, and neither the consent nor the joined line', JSON.stringify(o1));

    await page.fill('#plus-org-code', 'ACME-JOIN-1234');
    await page.click('#plus-org-check');
    await page.waitForFunction(() => !document.getElementById('plus-org-consent').hidden);
    const o2 = await page.evaluate(() => ({
      ask: document.getElementById('plus-org-ask').textContent,
      reports: [...document.querySelectorAll('#plus-org-reports li')].map((li) => li.textContent),
      readers: [...document.querySelectorAll('#plus-org-readers li')].length,
      never: [...document.querySelectorAll('#plus-org-never li')].length,
      bold: document.querySelectorAll('#plus-org-reports b').length,
      local: (() => { const el = document.getElementById('plus-org-local'); return !!el && el.getClientRects().length > 0 && /other Kosmoses on this computer/.test(el.textContent); })(),
      focus: document.activeElement && document.activeElement.id,
      outHidden: document.getElementById('plus-org-out').hidden,
    }));
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'orgenroll-consent.png') });
    chk(/Acme invites you to join\. Joining makes this Kosmos your work Kosmos\. Here is what that means:/.test(o2.ask) && o2.reports.length === 2 && o2.reports[1].includes('<b>bold?</b>') && o2.bold === 0
        && o2.readers === 2 && o2.never === 2 && o2.focus === 'plus-org-join' && o2.outHidden && o2.local,
      'O2 Check code shows the company and the four lists as text (markup stays text), with focus on Join', JSON.stringify(o2));

    const before = await page.evaluate(() => window.__org.length);
    await page.click('#plus-org-notnow');
    const o3 = await page.evaluate((n) => ({ sent: window.__org.slice(n), msg: document.getElementById('plus-org-msg').textContent, consent: !document.getElementById('plus-org-consent').hidden }), before);
    chk(o3.sent.length === 0 && /none of this Kosmos's data was sent/.test(o3.msg) && !o3.consent,
      'O3 Not now sends nothing more and says so', JSON.stringify(o3));

    await page.click('#plus-org-check');
    await page.waitForFunction(() => !document.getElementById('plus-org-consent').hidden);
    await page.click('#plus-org-join');
    await page.waitForFunction(() => !document.getElementById('plus-org-in').hidden);
    const o4 = await page.evaluate(() => ({ enroll: window.__org.filter((r) => r.path === '/api/org/enroll'), say: document.getElementById('plus-org-say').textContent }));
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'orgenroll-joined.png') });
    chk(o4.enroll.length === 1 && o4.enroll[0].body.code === 'ACME-JOIN-1234' && o4.enroll[0].body.accepted === true && /^t-/.test(o4.enroll[0].body.ticket) && Object.keys(o4.enroll[0].body).length === 3
        && /work Kosmos for Acme/.test(o4.say),
      'O4 Join sends exactly { code, accepted: true, ticket }, and the block says this is the work Kosmos', JSON.stringify(o4));

    await page.click('#plus-org-leave');
    const asked = await shown(page, 'plus-org-leave-ask');
    const leftBefore = await page.evaluate(() => window.__org.filter((r) => r.path === '/api/org/leave').length);
    await page.click('#plus-org-leave-yes');
    await page.waitForFunction(() => !document.getElementById('plus-org-out').hidden);
    const o5 = await page.evaluate(() => ({ leave: window.__org.filter((r) => r.path === '/api/org/leave').length, msg: document.getElementById('plus-org-msg').textContent }));
    chk(asked && leftBefore === 0 && o5.leave === 1 && /You left/.test(o5.msg), 'O5 Leave asks first, then leaves, and the code field returns', JSON.stringify({ asked, leftBefore, ...o5 }));

    // O7: already a member of that company: the same consent, worded as a move, and Join sends no code.
    await page.evaluate(() => { window.__move = true; });
    await page.fill('#plus-org-code', 'ACME-JOIN-9999');
    await page.click('#plus-org-check');
    await page.waitForFunction(() => !document.getElementById('plus-org-consent').hidden);
    const askMove = await page.evaluate(() => document.getElementById('plus-org-ask').textContent);
    await page.click('#plus-org-join');
    await page.waitForFunction(() => !document.getElementById('plus-org-in').hidden);
    const lastEnroll = await page.evaluate(() => window.__org.filter((r) => r.path === '/api/org/enroll').at(-1));
    chk(/already in Acme\. Make this Kosmos your work Kosmos/.test(askMove) && lastEnroll.body.accepted === true && !('code' in lastEnroll.body) && /^t-/.test(lastEnroll.body.ticket),
      'O7 a member moving here sees the consent as a move, and Join sends no code', JSON.stringify({ askMove, lastEnroll }));

    // O9: the company enrolls another world or computer, so leave ends only here: the membership goes on.
    await page.evaluate(() => { window.__localOnly = true; });
    await page.click('#plus-org-leave');
    await page.click('#plus-org-leave-yes');
    await page.waitForFunction(() => !document.getElementById('plus-org-out').hidden);
    const o9 = await page.evaluate(() => document.getElementById('plus-org-msg').textContent);
    chk(o9 === 'This Kosmos has stopped reporting. You are still in Acme: your work Kosmos is elsewhere, so leave from there.' && !/You left/.test(o9),
      'O9 a leave that ends only on this computer says the membership goes on', JSON.stringify(o9));
    await page.evaluate(() => { window.__localOnly = false; });

    // O11: joined again, then each refusal that changed nothing: the joined view stays, and the message is the refusal.
    for (const [refusal, want] of [[{ ok: false, because: 'This Kosmos is not your work Kosmos. Leave from your work Kosmos.' }, 'This Kosmos is not your work Kosmos. Leave from your work Kosmos.'],
      [{ error: 'This screen could not be checked. Reload the page.' }, 'This screen could not be checked. Reload the page.']]) {
      await page.fill('#plus-org-code', 'ACME-JOIN-1234');
      await page.click('#plus-org-check');
      await page.waitForFunction(() => !document.getElementById('plus-org-consent').hidden);
      await page.click('#plus-org-join');
      await page.waitForFunction(() => !document.getElementById('plus-org-in').hidden);
      await page.evaluate((x) => { window.__leaveRefused = x; document.getElementById('plus-org-msg').textContent = ''; }, refusal);
      await page.click('#plus-org-leave');
      await page.click('#plus-org-leave-yes');
      await page.waitForFunction(() => document.getElementById('plus-org-msg').textContent !== '');
      const o11 = await page.evaluate(() => ({ msg: document.getElementById('plus-org-msg').textContent, joined: !document.getElementById('plus-org-in').hidden, out: !document.getElementById('plus-org-out').hidden }));
      chk(o11.msg === want && o11.joined && !o11.out && !/stopped reporting/.test(o11.msg),
        'O11 a leave refused before anything was done keeps the joined view and says why (' + Object.keys(refusal).join('+') + ')', JSON.stringify(o11));
      // Back to not joined for the checks below.
      await page.evaluate(() => { window.__leaveRefused = null; });
      await page.click('#plus-org-leave');
      await page.click('#plus-org-leave-yes');
      await page.waitForFunction(() => !document.getElementById('plus-org-out').hidden);
    }

    // O12: a leave retried later was refused as the last admin: the next read says so once, and the joined view is back.
    await page.evaluate(() => { window.__refused = 'Acme <b>Co</b>'; PLUS_ORG.at = 0; document.getElementById('plus-org-msg').textContent = 'an earlier line still on screen'; plusOrgMaybe(); });
    await page.waitForFunction(() => /was refused/.test(document.getElementById('plus-org-msg').textContent), null, { timeout: 5000 }).catch(() => {});
    const o12 = await page.evaluate(() => ({ msg: document.getElementById('plus-org-msg').textContent, bold: document.querySelectorAll('#plus-org-msg b').length, joined: !document.getElementById('plus-org-in').hidden }));
    chk(o12.msg === 'Your leave from Acme <b>Co</b> was refused: you are its last admin. This Kosmos is your work Kosmos again and reports to it.' && o12.bold === 0 && o12.joined,
      'O12 a retried leave refused as the last admin says so, as text, with the joined view back', JSON.stringify(o12));
    // O12b (review 31): an UNDO refused as the last admin says so in undo words, never "your leave was refused".
    await page.evaluate(() => { window.__refusedUndo = true; PLUS_ORG.at = 0; document.getElementById('plus-org-msg').textContent = 'an earlier line'; plusOrgMaybe(); });
    await page.waitForFunction(() => /could not undo/.test(document.getElementById('plus-org-msg').textContent), null, { timeout: 5000 }).catch(() => {});
    const o12b = await page.evaluate(() => document.getElementById('plus-org-msg').textContent);
    chk(o12b === 'Your company could not undo joining Acme <b>Co</b>: you are its last admin. This Kosmos is your work Kosmos and reports to it.',
      'O12 an undo refused as the last admin says so in undo words, not as a refused leave', JSON.stringify(o12b));
    // O12c (review 33): when this Kosmos may not report (no consent recorded here), the note never says it reports.
    await page.evaluate(() => { window.__notReporting = true; PLUS_ORG.at = 0; document.getElementById('plus-org-msg').textContent = 'an earlier line'; plusOrgMaybe(); });
    await page.waitForFunction(() => /sends your company nothing/.test(document.getElementById('plus-org-msg').textContent), null, { timeout: 5000 }).catch(() => {});
    const o12c = await page.evaluate(() => document.getElementById('plus-org-msg').textContent);
    const say12c = await page.evaluate(() => document.getElementById('plus-org-say').textContent);
    chk(/sends your company nothing: its words were not accepted on this computer\.$/.test(o12c) && !/reports to it/.test(o12c) && !/until you accept/.test(o12c)
      && /It sends your company nothing/.test(say12c),
      'O12 a Kosmos that may not report is never told it reports, and its joined view says it sends nothing', JSON.stringify({ o12c, say12c }));
    await page.evaluate(() => { window.__notReporting = false; window.__refused = null; window.__refusedUndo = false; PLUS_ORG.state = { enrolled: false, org: null, role: null }; plusOrgPaint(); });

    // O8: the company stopped naming this world. The next /api/org read carries stoppedFor; the block says so.
    await page.evaluate(() => { window.__stopped = 'Acme <i>Co</i>'; PLUS_ORG.at = 0; document.getElementById('plus-org-msg').textContent = 'an earlier line still on screen'; plusOrgMaybe(); });
    await page.waitForFunction(() => /no longer the work Kosmos/.test(document.getElementById('plus-org-msg').textContent), null, { timeout: 5000 }).catch(() => {});
    const o8 = await page.evaluate(() => ({ msg: document.getElementById('plus-org-msg').textContent, italics: document.querySelectorAll('#plus-org-msg i').length, out: !document.getElementById('plus-org-out').hidden }));
    chk(o8.msg === 'This Kosmos is no longer the work Kosmos for Acme <i>Co</i>, so it has stopped reporting.' && o8.italics === 0 && o8.out,
      'O8 a Kosmos the company stopped naming says so, as text, with the code field back', JSON.stringify(o8));

    // O10: the company sends no "never" lines; this Kosmos's own promise still shows under Never.
    await page.evaluate(() => { window.__noNever = true; document.getElementById('plus-org-msg').textContent = ''; });
    await page.fill('#plus-org-code', 'ACME-JOIN-5555');
    await page.click('#plus-org-check');
    await page.waitForFunction(() => !document.getElementById('plus-org-consent').hidden);
    const o10 = await page.evaluate(() => ({
      items: document.querySelectorAll('#plus-org-never li').length,
      local: (() => { const el = document.getElementById('plus-org-local'); return !!el && el.getClientRects().length > 0; })(),
    }));
    chk(o10.items === 0 && o10.local, 'O10 an empty never list still shows this Kosmos\'s own line', JSON.stringify(o10));
    await page.click('#plus-org-notnow');

    // O14: an unknown outcome and an undo still to send each go back to the code field, with the engine's sentence.
    for (const ans of [{ ok: false, unknown: true, code: 'org_join_unknown', because: 'It is not known yet whether joining went through. This Kosmos will ask your company again in a few minutes; if joining went through, this screen will show it.' },
      { ok: false, code: 'org_consent_changed', because: 'Your company changed what it would see since you checked. Nothing was joined. Check the code again to read the new words.' },
      { ok: false, code: 'org_undo_pending', because: 'Your company did not confirm this Kosmos, so it is not your work Kosmos. Joining could not be undone yet, so your company may still list this Kosmos. It is not reporting.' }]) {
      await page.evaluate((a) => { window.__enrollAnswer = a; document.getElementById('plus-org-msg').textContent = ''; }, ans);
      await page.fill('#plus-org-code', 'ACME-JOIN-8888');
      await page.click('#plus-org-check');
      await page.waitForFunction(() => !document.getElementById('plus-org-consent').hidden);
      await page.click('#plus-org-join');
      await page.waitForFunction(() => document.getElementById('plus-org-msg').textContent !== '');
      const o14 = await page.evaluate(() => ({ msg: document.getElementById('plus-org-msg').textContent, consent: !document.getElementById('plus-org-consent').hidden, out: !document.getElementById('plus-org-out').hidden }));
      chk(o14.msg === ans.because && !o14.consent && o14.out, 'O14 ' + ans.code + ' goes back to the code field and says so, with no consent (or Not now) left', JSON.stringify(o14));
    }
    await page.evaluate(() => { window.__enrollAnswer = null; });

    // O13: a stated empty backsUp says "Nothing is backed up." under its heading; an unstated empty one hides the group.
    // CONTROL: with the base consent's list, the list shows and the none line does not.
    const backup = () => page.evaluate(() => ({ shown: !document.getElementById('plus-org-backsup').parentElement.hidden,
      items: [...document.querySelectorAll('#plus-org-backsup li')].map((li) => li.textContent) }));
    await page.evaluate(() => { window.__noNever = false; window.__noBackup = 'said'; document.getElementById('plus-org-msg').textContent = ''; });
    await page.fill('#plus-org-code', 'ACME-JOIN-6666');
    await page.click('#plus-org-check');
    await page.waitForFunction(() => !document.getElementById('plus-org-consent').hidden);
    const none = await backup();
    const look = await page.evaluate(() => { const li = document.querySelector('#plus-org-backsup li.plus-org-none'); return li ? getComputedStyle(li).listStyleType : 'no line'; });
    await page.click('#plus-org-notnow');
    // Not stated (a missing field or lines cleaned to nothing reach the page as an empty list without the flag): hidden.
    await page.evaluate(() => { window.__noBackup = 'unsaid'; });
    await page.fill('#plus-org-code', 'ACME-JOIN-6667');
    await page.click('#plus-org-check');
    await page.waitForFunction(() => !document.getElementById('plus-org-consent').hidden);
    const unsaid = await backup();
    await page.click('#plus-org-notnow');
    await page.evaluate(() => { window.__noBackup = false; });
    await page.fill('#plus-org-code', 'ACME-JOIN-7777');
    await page.click('#plus-org-check');
    await page.waitForFunction(() => !document.getElementById('plus-org-consent').hidden);
    const some = await backup();
    await page.click('#plus-org-notnow');
    chk(none.shown && none.items.length === 1 && none.items[0] === 'Nothing is backed up.' && look === 'none'
      && !unsaid.shown && unsaid.items.length === 0
      && some.shown && some.items.length === 2 && !some.items.includes('Nothing is backed up.'),
      'O13 a stated empty backsUp says nothing is backed up (unbulleted); an unstated one hides; a list shows the list', JSON.stringify({ none, look, unsaid, some }));


    // O17 (review 1): on a FRESH page, before any click. (a) /api/org fails: still only the opener. (b) This Kosmos is
    // already its company's work Kosmos: the heading and the joined view show at once, no opener.
    for (const [label, init, want] of [
      ['a read that fails', () => { window.__orgFail = true; }, { opener: true, title: false, out: false, in: false }],
      ['already joined', () => { window.__orgState = { enrolled: true, reporting: true, stoppedFor: null, leaveRefused: null, org: { name: 'Acme', slug: 'acme' }, role: 'member', enrolledAt: '2026-10-07T00:00:00.000Z' }; }, { opener: false, title: true, out: false, in: true }],
      // (c) review 3: a company note opens the block on its own: the company stopped naming this Kosmos.
      ['a company note (stopped)', () => { window.__stopped = 'Acme'; }, { opener: false, title: true, out: true, in: false }]]) {
      const p2 = await browser.newPage({ viewport: { width: 1200, height: 900 } });
      p2.on('pageerror', (e) => errs.push('O17 ' + label + ': ' + e.message));   // into O6, below
      await p2.addInitScript(harness(), [CONSENT]);
      await p2.addInitScript(init);
      await p2.goto(PAGE);
      if (await p2.$('#firstrun:not([hidden])')) { await p2.keyboard.press('Escape'); await p2.waitForTimeout(400); }
      await p2.evaluate(() => { showTab('settings'); settingsGo('plus'); });
      await p2.waitForFunction(() => (window.__org || []).some((x) => x.path === '/api/org' && x.method === 'GET'), null, { timeout: 10000 }).catch(() => {});
      await p2.waitForTimeout(300);
      const got = { opener: await shown(p2, 'plus-org-open'), title: await shown(p2, 'plus-org-title'), out: await shown(p2, 'plus-org-out'), in: await shown(p2, 'plus-org-in') };
      chk(JSON.stringify(got) === JSON.stringify(want), 'O17 ' + label + ': ' + JSON.stringify(want), JSON.stringify(got));
      await p2.close();
    }
    // O15: a joined Kosmos that sends nothing (its words were not accepted here) offers "Review what your company sees":
    // the consent shows in place of the joined view, Accept sends no code, and Not now changes nothing.
    // CONTROL: a Kosmos that reports does not offer it.
    const joined = (reporting) => page.evaluate((rep) => { PLUS_ORG.at = Date.now(); PLUS_ORG.preview = null;
      PLUS_ORG.state = { enrolled: true, reporting: rep, org: { name: 'Acme', slug: 'acme' }, role: 'member' };
      document.getElementById('plus-org-msg').textContent = ''; plusOrgPaint(); }, reporting);
    await joined(true);
    const offeredWhenReporting = await shown(page, 'plus-org-review');
    await joined(false);
    const offered = await shown(page, 'plus-org-review');
    await page.evaluate(() => { window.__review = true; });
    await page.click('#plus-org-review');
    await page.waitForFunction(() => !document.getElementById('plus-org-consent').hidden);
    const rv = await page.evaluate(() => ({ ask: document.getElementById('plus-org-ask').textContent, join: document.getElementById('plus-org-join').textContent,
      inView: !document.getElementById('plus-org-in').hidden, codeField: !document.getElementById('plus-org-out').hidden,
      sent: window.__org.filter((x) => x.path === '/api/org/preview').pop() }));
    await page.click('#plus-org-notnow');
    const nn = await page.evaluate(() => ({ msg: document.getElementById('plus-org-msg').textContent, inView: !document.getElementById('plus-org-in').hidden,
      consent: !document.getElementById('plus-org-consent').hidden, enrolls: window.__org.filter((x) => x.path === '/api/org/enroll').length }));
    // An Accept refused because the words were open too long points at the Review button, never at a code.
    await page.evaluate(() => { window.__enrollAnswer = { ok: false, code: 'org_ticket', because: 'Check the code again first, so you can read what your company would see.' }; });
    await page.click('#plus-org-review');
    await page.waitForFunction(() => !document.getElementById('plus-org-consent').hidden);
    await page.click('#plus-org-join');
    await page.waitForFunction(() => document.getElementById('plus-org-consent').hidden);
    const late = await page.evaluate(() => ({ msg: document.getElementById('plus-org-msg').textContent,
      review: (() => { const el = document.getElementById('plus-org-review'); return !el.hidden && el.getClientRects().length > 0; })() }));
    // Any other refusal with a reason (one the page does not list) also brings back the joined view and its Review button.
    await page.evaluate(() => { window.__enrollAnswer = { ok: false, code: 'org_not_member', because: 'Your company did not take the acceptance. Nothing changed on this computer. Press Review what your company sees to try again.' };
      document.getElementById('plus-org-msg').textContent = ''; });
    await page.click('#plus-org-review');
    await page.waitForFunction(() => !document.getElementById('plus-org-consent').hidden);
    await page.click('#plus-org-join');
    await page.waitForFunction(() => document.getElementById('plus-org-msg').textContent !== '');
    const other = await page.evaluate(() => ({ consent: !document.getElementById('plus-org-consent').hidden,
      review: (() => { const el = document.getElementById('plus-org-review'); return !el.hidden && el.getClientRects().length > 0; })() }));
    await page.evaluate(() => { window.__enrollAnswer = null; PLUS_ORG.state = { enrolled: true, reporting: false, org: { name: 'Acme', slug: 'acme' }, role: 'member' }; plusOrgPaint(); });
    const enrollsBefore = await page.evaluate(() => window.__org.filter((x) => x.path === '/api/org/enroll').length);
    await page.click('#plus-org-review');
    await page.waitForFunction(() => !document.getElementById('plus-org-consent').hidden);
    await page.click('#plus-org-join');
    await page.waitForFunction(() => document.getElementById('plus-org-consent').hidden);
    const acc = await page.evaluate(() => ({ enroll: window.__org.filter((x) => x.path === '/api/org/enroll'), inView: !document.getElementById('plus-org-in').hidden,
      join: document.getElementById('plus-org-join').textContent }));
    const last = acc.enroll[acc.enroll.length - 1];
    chk(!offeredWhenReporting && offered && JSON.stringify(rv.sent.body) === '{"review":true}' && rv.join === 'Accept' && !rv.inView && !rv.codeField
      && /^This is what Acme asks of this Kosmos/.test(rv.ask)
      && nn.msg === 'Nothing changed.' && nn.inView && !nn.consent
      && late.msg === 'These words were open too long. Press Review what your company sees to read them again.' && late.review
      && !other.consent && other.review
      && acc.enroll.length === enrollsBefore + 1 && last.body.accepted === true && !('code' in last.body) && typeof last.body.ticket === 'string'
      && acc.inView && acc.join === 'Join with this Kosmos',
      'O15 a Kosmos that sends nothing reviews its company\'s words and accepts them with no code; Not now changes nothing; one that reports is not offered it',
      JSON.stringify({ offeredWhenReporting, offered, rv, nn, late, other, last, acc: { inView: acc.inView, join: acc.join } }));
    await page.evaluate(() => { window.__review = false; PLUS_ORG.state = { enrolled: false, org: null, role: null }; PLUS_ORG.preview = null; plusOrgPaint(); });

    chk(errs.length === 0, 'O6 no page errors', errs.join(' | '));
  } finally {
    await browser.close();
  }
  if (fail.length) { console.log('\n' + fail.length + ' failed'); process.exit(1); }
  console.log('\nall company-join checks passed');
})();
