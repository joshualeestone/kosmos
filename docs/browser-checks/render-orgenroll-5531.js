#!/usr/bin/env node
/*
 * #5531 (Enterprise E0.2, umbrella #5529), reshaped by #5791: Settings > Kosmos+, the block where a person joins this
 * Kosmos to a company. Runs the real page (web/index.html, file://) with fetch answered by a stand-in for the board's
 * /api/org routes, so nothing reaches a board or a coordinator, and drives the block directly.
 *
 * #5791 (Josh 10-10): the company decided, so there is no consent preview. "Join Corporate Account" opens a code field
 * with an X Cancel; Connect Account joins at once.
 *
 *   O0  no company: only the "Join Corporate Account" button shows; no heading, code field or joined line.
 *   O1  opened: the X Cancel, the copy and the code field show, with no "Your company" heading and no opener.
 *   O16 Cancel (and Escape) closes it, clears the code, sends nothing, and puts focus back on the button; an empty code
 *       sends nothing and says what to do.
 *   O2  Connect Account sends /api/org/preview { code } and then, with nothing shown between, exactly
 *       { code, accepted: true, ticket } to /api/org/enroll; the block then says this is the work Kosmos, and never
 *       mentions "other Kosmoses on this computer".
 *   O3  a code the company refuses at the preview shows the refusal under the field, and nothing is enrolled.
 *   O4  Enter in the code field connects too.
 *   O5  Leave asks first; Leave then posts /api/org/leave and the code field returns.
 *   O6  no page errors.
 *   O7  a member moving here joins with no code.
 *   O8  a Kosmos the company stopped naming says so (stoppedFor from /api/org), as text; Cancel closes it for good.
 *   O9  a leave that ends only on this computer (localOnly) says the membership goes on, never "You left".
 *   O11 a leave refused before anything was done keeps the joined view and says why, never "stopped reporting".
 *   O12 a retried leave the company refused as the last admin says so, as text, with the joined view back; an undo says
 *       so in undo words; a Kosmos that does not report yet is never told it reports.
 *   O14 an enroll whose outcome is not known yet, whose terms changed just then, or whose undo is still to send, says
 *       so under the code field, which stays.
 *   O15 a joined Kosmos that does not report yet offers no button (the board takes the terms on itself) and says
 *       which wait it is in.
 *   O17 on a fresh page: a failed /api/org read still shows only the button; an already joined Kosmos shows its joined
 *       view and heading at once; a company note opens the block.
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
  reports: ['agent names, the AI provider and model each uses', 'project names'],
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
      if (u.includes('/api/org')) window.__org.push({ path: u.replace(/^.*?(\/api\/org[^?]*).*$/, '$1'), method: (init && init.method) || 'GET', body, at: performance.now() });
      if (u.endsWith('/api/org/preview') && window.__previewAnswer) return enc(window.__previewAnswer);
      if (u.endsWith('/api/org/preview')) return enc(Object.assign({ ok: true, org: { id: 'org_1', name: 'Acme', slug: 'acme' }, role: 'member', consent, ticket: 't-' + Date.now() }, window.__move ? { move: true } : {}));
      // The stand-in remembers a join and a leave, so the page's read-back after either answers as the engine would.
      if (u.endsWith('/api/org/enroll')) { const a = window.__enrollAnswer || { ok: true, org: { id: 'org_1', name: 'Acme', slug: 'acme' }, role: 'member' }; if (a.ok) window.__joined = true; return enc(a); }
      if (u.endsWith('/api/org/leave')) { const a = window.__leaveRefused || (window.__localOnly ? { ok: true, localOnly: true } : { ok: true }); if (a.ok) window.__joined = false; return enc(a); }
      if (u.endsWith('/api/org') && window.__orgFail) throw new Error('offline');
      if (u.endsWith('/api/org') && window.__orgState) return enc(window.__orgState);
      if (u.endsWith('/api/org') && window.__joined && !window.__refused) return enc({ enrolled: true, reporting: true, stoppedFor: null, leaveRefused: null, org: { name: 'Acme', slug: 'acme' }, role: 'member', enrolledAt: '2026-10-10T00:00:00.000Z' });
      if (u.endsWith('/api/org')) return enc(window.__refused
        ? { enrolled: true, reporting: window.__notReporting !== true && window.__printWait !== true, reportingWait: window.__printWait === true ? 'print' : null, stoppedFor: null, leaveRefused: window.__refused, leaveRefusedUndo: window.__refusedUndo === true, org: { name: 'Acme', slug: 'acme' }, role: 'admin', enrolledAt: '2026-10-07T00:00:00.000Z' }
        : { enrolled: false, stoppedFor: window.__stopped || null, leaveRefused: null, org: null, role: null, enrolledAt: null });
      if (u.endsWith('/api/remote') && !(init && init.method)) return enc({ enrolled: true, on: true });   // a connected computer
      if (u.includes('/api/history')) return enc({ readable: false });   // Settings' history row, in the shape the engine sends when it has none
      return enc({});
    };
  };
}
const shown = (pg, id) => pg.evaluate((i) => { const el = document.getElementById(i); return !!el && !el.hidden && el.getClientRects().length > 0; }, id);
const text = (pg, id) => pg.evaluate((i) => document.getElementById(i).textContent, id);

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
    const sentSince = (n) => page.evaluate((k) => window.__org.slice(k).filter((x) => x.method === 'POST'), n);
    const mark = () => page.evaluate(() => window.__org.length);
    // Connect with a code and wait until the press settles: joined, or a line under the field.
    const connect = async (code) => {
      await page.evaluate(() => { document.getElementById('plus-org-msg').textContent = ''; });
      await page.fill('#plus-org-code', code);
      await page.click('#plus-org-check');
      await page.waitForFunction(() => !document.getElementById('plus-org-in').hidden || document.getElementById('plus-org-msg').textContent !== '', null, { timeout: 5000 }).catch(() => {});
    };
    const leave = async () => {   // settles on the leave's own answer: a line still on screen from before must not count
      await page.evaluate(() => { document.getElementById('plus-org-msg').textContent = ''; });
      await page.click('#plus-org-leave');
      await page.click('#plus-org-leave-yes');
      await page.waitForFunction(() => !document.getElementById('plus-org-out').hidden || document.getElementById('plus-org-msg').textContent !== '', null, { timeout: 5000 }).catch(() => {});
    };

    // O0: a person with no company sees ONE button (Josh 10-10: outlined, with a tiny icon), not an Enterprise box.
    const o0 = { opener: await shown(page, 'plus-org-open'), label: (await text(page, 'plus-org-open')).trim(), icon: await page.evaluate(() => !!document.querySelector('#plus-org-open svg')),
      outlined: await page.evaluate(() => { const cs = getComputedStyle(document.getElementById('plus-org-open')); return cs.borderStyle !== 'none' && parseFloat(cs.borderWidth) > 0; }),
      heading: await shown(page, 'plus-org-title'), out: await shown(page, 'plus-org-out'), in: await shown(page, 'plus-org-in') };
    chk(o0.opener && o0.label === 'Join Corporate Account' && o0.icon && o0.outlined && !o0.heading && !o0.out && !o0.in,
      'O0 no company: only the outlined "Join Corporate Account" button, with its icon', JSON.stringify(o0));
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'orgenroll-opener.png') });

    await page.click('#plus-org-open');
    await page.waitForFunction(() => { const el = document.getElementById('plus-org-out'); return el && !el.hidden && el.getClientRects().length > 0; }, null, { timeout: 10000 }).catch(() => {});
    const o1 = { out: await shown(page, 'plus-org-out'), cancel: await shown(page, 'plus-org-cancel'), cancelText: (await text(page, 'plus-org-cancel')).replace(/\s+/g, ' ').trim(),
      copy: await page.evaluate(() => document.getElementById('plus-org-out').textContent.replace(/\s+/g, ' ')), button: (await text(page, 'plus-org-check')).trim(),
      placeholder: await page.getAttribute('#plus-org-code', 'placeholder'), focus: await page.evaluate(() => document.activeElement && document.activeElement.id),
      in: await shown(page, 'plus-org-in'), heading: await shown(page, 'plus-org-title'), opener: await shown(page, 'plus-org-open') };
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'orgenroll-connect.png') });
    chk(o1.out && o1.cancel && o1.cancelText === '✕ Cancel' && o1.copy.includes("Enter your company's code to connect your Kosmos to your corporate enterprise account.")
        && o1.button === 'Connect Account' && o1.placeholder === 'Company code' && o1.focus === 'plus-org-code' && !o1.heading && !o1.opener && !o1.in,
      'O1 opened: X Cancel, the copy, the code field (focused) and Connect Account; no heading, no button, no joined line', JSON.stringify(o1));

    // O16: Cancel closes and clears; Escape in the field does the same; an empty code says what to do. Nothing is posted.
    const m16 = await mark();
    await page.fill('#plus-org-code', 'HALF-TYPED');
    await page.click('#plus-org-cancel');
    const c1 = { out: await shown(page, 'plus-org-out'), opener: await shown(page, 'plus-org-open'), code: await page.inputValue('#plus-org-code'), focus: await page.evaluate(() => document.activeElement && document.activeElement.id) };
    await page.click('#plus-org-open');
    await page.fill('#plus-org-code', 'HALF-TYPED');
    await page.press('#plus-org-code', 'Escape');
    const c2 = { out: await shown(page, 'plus-org-out'), opener: await shown(page, 'plus-org-open'), code: await page.inputValue('#plus-org-code') };
    await page.click('#plus-org-open');
    await page.click('#plus-org-check');
    const empty = await text(page, 'plus-org-msg');
    const posted16 = await sentSince(m16);
    chk(!c1.out && c1.opener && c1.code === '' && c1.focus === 'plus-org-open' && !c2.out && c2.opener && c2.code === ''
        && empty === 'Type or paste the code your company sent you.' && posted16.length === 0,
      'O16 Cancel and Escape close and clear, focus returns to the button; an empty code says what to do; nothing is posted', JSON.stringify({ c1, c2, empty, posted16 }));

    // O3: the company refuses the code at the preview: its sentence under the field, and no enroll.
    await page.evaluate(() => { window.__previewAnswer = { ok: false, because: 'That code has expired. Ask your company for a new one.' }; });
    const m3 = await mark();
    await connect('ACME-OLD-0001');
    const o3 = { msg: await text(page, 'plus-org-msg'), sent: (await sentSince(m3)).map((x) => x.path), out: await shown(page, 'plus-org-out'), in: await shown(page, 'plus-org-in') };
    chk(o3.msg === 'That code has expired. Ask your company for a new one.' && JSON.stringify(o3.sent) === '["/api/org/preview"]' && o3.out && !o3.in,
      'O3 a code refused at the preview says why under the field, and nothing is enrolled', JSON.stringify(o3));
    await page.evaluate(() => { window.__previewAnswer = null; });

    // O2: Connect Account: preview, then enroll with exactly { code, accepted: true, ticket }, nothing shown between.
    const m2 = await mark();
    const between = page.evaluate(() => new Promise((res) => {   // anything the page shows while the two calls run
      const seen = []; const ob = new MutationObserver(() => { const o = document.getElementById('plus-org');
        seen.push([...o.querySelectorAll('ul, li, [id*="consent"]')].filter((e) => e.getClientRects().length > 0).length); });
      ob.observe(document.getElementById('plus-org'), { subtree: true, childList: true, attributes: true, characterData: true });
      setTimeout(() => { ob.disconnect(); res(seen); }, 1500);
    }));
    await connect('ACME-JOIN-1234');
    const shownBetween = await between;
    const o2 = { sent: await sentSince(m2), say: await text(page, 'plus-org-say'), block: await page.evaluate(() => document.getElementById('plus-org').textContent),
      heading: await shown(page, 'plus-org-title'), out: await shown(page, 'plus-org-out'), code: await page.inputValue('#plus-org-code') };
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'orgenroll-joined.png') });
    const [pv, en] = o2.sent;
    chk(o2.sent.length === 2 && pv.path === '/api/org/preview' && JSON.stringify(pv.body) === '{"code":"ACME-JOIN-1234"}'
        && en.path === '/api/org/enroll' && en.body.code === 'ACME-JOIN-1234' && en.body.accepted === true && /^t-/.test(en.body.ticket) && Object.keys(en.body).length === 3
        && shownBetween.every((n) => n === 0) && /work Kosmos for Acme/.test(o2.say) && !/other Kosmoses/.test(o2.block) && o2.heading && !o2.out && o2.code === '',
      'O2 Connect Account previews, then enrolls with exactly { code, accepted: true, ticket }, shows nothing between, and says this is the work Kosmos',
      JSON.stringify({ sent: o2.sent.map((x) => [x.path, x.body]), shownBetween, say: o2.say }));

    // O2b (review 3): after the join the page reads the engine's own answer (whether it reports yet) at once.
    await page.waitForFunction((k) => window.__org.slice(k).some((x) => x.path === '/api/org' && x.method === 'GET'), m2, { timeout: 3000 }).catch(() => {});
    const reads2 = await page.evaluate((k) => window.__org.slice(k).filter((x) => x.path === '/api/org' && x.method === 'GET').length, m2);
    chk(reads2 >= 1, 'O2 after joining, the page reads the engine\'s answer at once (no 5-second repaint here: setInterval is stubbed)', JSON.stringify({ reads2 }));

    await page.click('#plus-org-leave');
    const asked = await shown(page, 'plus-org-leave-ask');
    const m5 = await mark();
    await page.click('#plus-org-leave-yes');
    await page.waitForFunction(() => !document.getElementById('plus-org-out').hidden);
    const o5 = { leave: (await sentSince(m5)).filter((r) => r.path === '/api/org/leave').length, msg: await text(page, 'plus-org-msg') };
    chk(asked && o5.leave === 1 && /You left/.test(o5.msg), 'O5 Leave asks first, then leaves, and the code field returns', JSON.stringify({ asked, ...o5 }));

    // O4: Enter in the code field connects, the same two calls.
    const m4 = await mark();
    await page.evaluate(() => { document.getElementById('plus-org-msg').textContent = ''; });
    await page.fill('#plus-org-code', 'ACME-JOIN-4444');
    await page.press('#plus-org-code', 'Enter');
    await page.waitForFunction(() => !document.getElementById('plus-org-in').hidden, null, { timeout: 5000 }).catch(() => {});
    const o4 = (await sentSince(m4)).map((x) => x.path);
    chk(JSON.stringify(o4) === '["/api/org/preview","/api/org/enroll"]' && await shown(page, 'plus-org-in'), 'O4 Enter in the code field connects', JSON.stringify(o4));
    await leave();

    // O7: already a member of that company: the join is a move, and the enroll carries no code.
    await page.evaluate(() => { window.__move = true; });
    const m7 = await mark();
    await connect('ACME-JOIN-9999');
    const e7 = (await sentSince(m7)).find((r) => r.path === '/api/org/enroll');
    chk(!!e7 && e7.body.accepted === true && !('code' in e7.body) && /^t-/.test(e7.body.ticket) && await shown(page, 'plus-org-in'),
      'O7 a member moving here joins with no code', JSON.stringify(e7));
    await page.evaluate(() => { window.__move = false; });

    // O9: the company enrolls another world or computer, so leave ends only here: the membership goes on.
    await page.evaluate(() => { window.__localOnly = true; });
    await leave();
    const o9 = await text(page, 'plus-org-msg');
    chk(o9 === 'This Kosmos has stopped reporting. You are still in Acme: your work Kosmos is elsewhere, so leave from there.' && !/You left/.test(o9),
      'O9 a leave that ends only on this computer says the membership goes on', JSON.stringify(o9));
    await page.evaluate(() => { window.__localOnly = false; });

    // O11: joined again, then each refusal that changed nothing: the joined view stays, and the message is the refusal.
    for (const refusal of [{ ok: false, because: 'This Kosmos is not your work Kosmos. Leave from your work Kosmos.' }, { error: 'This screen could not be checked. Reload the page.' }]) {
      await connect('ACME-JOIN-1234');
      await page.evaluate((x) => { window.__leaveRefused = x; document.getElementById('plus-org-msg').textContent = ''; }, refusal);
      await leave();
      const o11 = { msg: await text(page, 'plus-org-msg'), joined: await shown(page, 'plus-org-in'), out: await shown(page, 'plus-org-out') };
      chk(o11.msg === (refusal.because || refusal.error) && o11.joined && !o11.out && !/stopped reporting/.test(o11.msg),
        'O11 a leave refused before anything was done keeps the joined view and says why (' + Object.keys(refusal).join('+') + ')', JSON.stringify(o11));
      await page.evaluate(() => { window.__leaveRefused = null; });
      await leave();
    }

    // O12: a leave retried later was refused as the last admin: the next read says so once, and the joined view is back.
    await page.evaluate(() => { window.__refused = 'Acme <b>Co</b>'; PLUS_ORG.at = 0; document.getElementById('plus-org-msg').textContent = 'an earlier line still on screen'; plusOrgMaybe(); });
    await page.waitForFunction(() => /was refused/.test(document.getElementById('plus-org-msg').textContent), null, { timeout: 5000 }).catch(() => {});
    const o12 = await page.evaluate(() => ({ msg: document.getElementById('plus-org-msg').textContent, bold: document.querySelectorAll('#plus-org-msg b').length, joined: !document.getElementById('plus-org-in').hidden }));
    chk(o12.msg === 'Your leave from Acme <b>Co</b> was refused: you are its last admin. This Kosmos is your work Kosmos again and reports to it.' && o12.bold === 0 && o12.joined,
      'O12 a retried leave refused as the last admin says so, as text, with the joined view back', JSON.stringify(o12));
    // An UNDO refused as the last admin says so in undo words, never "your leave was refused" (review 31).
    await page.evaluate(() => { window.__refusedUndo = true; PLUS_ORG.at = 0; document.getElementById('plus-org-msg').textContent = 'an earlier line'; plusOrgMaybe(); });
    await page.waitForFunction(() => /could not undo/.test(document.getElementById('plus-org-msg').textContent), null, { timeout: 5000 }).catch(() => {});
    const o12b = await text(page, 'plus-org-msg');
    chk(o12b === 'Your company could not undo joining Acme <b>Co</b>: you are its last admin. This Kosmos is your work Kosmos and reports to it.',
      'O12 an undo refused as the last admin says so in undo words, not as a refused leave', JSON.stringify(o12b));
    // A Kosmos that does not report yet is never told it reports (review 33); #5791: it waits for the company's terms.
    await page.evaluate(() => { window.__notReporting = true; PLUS_ORG.at = 0; document.getElementById('plus-org-msg').textContent = 'an earlier line'; plusOrgMaybe(); });
    await page.waitForFunction(() => /current terms/.test(document.getElementById('plus-org-msg').textContent), null, { timeout: 5000 }).catch(() => {});
    const o12c = { msg: await text(page, 'plus-org-msg'), say: await text(page, 'plus-org-say') };
    chk(/It reports to your company once Kosmos has your company's current terms\.$/.test(o12c.msg) && !/reports to it\./.test(o12c.msg)
        && /It reports to your company once Kosmos has your company's current terms\./.test(o12c.say) && !/not accepted|Review/.test(o12c.msg + o12c.say),
      'O12 a Kosmos that does not report yet is never told it reports, and is told it waits for the company\'s terms', JSON.stringify(o12c));
    // CONTROL (rollup review 29): one waiting for this computer's identity is told that, not that it waits for terms.
    await page.evaluate(() => { window.__notReporting = false; window.__printWait = true; PLUS_ORG.at = 0; document.getElementById('plus-org-msg').textContent = 'an earlier line'; plusOrgMaybe(); });
    await page.waitForFunction(() => /identity/.test(document.getElementById('plus-org-msg').textContent), null, { timeout: 5000 }).catch(() => {});
    const o12d = { msg: await text(page, 'plus-org-msg'), say: await text(page, 'plus-org-say') };
    chk(/It reports to your company once it has read this computer's identity\.$/.test(o12d.msg) && !/current terms/.test(o12d.msg)
        && /once it has read this computer's identity/.test(o12d.say) && !/current terms/.test(o12d.say),
      'O12 a Kosmos waiting for the computer\'s identity is told that, never that it waits for terms', JSON.stringify(o12d));
    await page.evaluate(() => { window.__printWait = false; window.__notReporting = false; window.__refused = null; window.__refusedUndo = false; PLUS_ORG.state = { enrolled: false, org: null, role: null }; plusOrgPaint(); });

    // O8: the company stopped naming this world. The next /api/org read carries stoppedFor; the block says so.
    await page.evaluate(() => { window.__stopped = 'Acme <i>Co</i>'; PLUS_ORG.at = 0; document.getElementById('plus-org-msg').textContent = 'an earlier line still on screen'; plusOrgMaybe(); });
    await page.waitForFunction(() => /no longer the work Kosmos/.test(document.getElementById('plus-org-msg').textContent), null, { timeout: 5000 }).catch(() => {});
    const o8 = await page.evaluate(() => ({ msg: document.getElementById('plus-org-msg').textContent, italics: document.querySelectorAll('#plus-org-msg i').length, out: !document.getElementById('plus-org-out').hidden }));
    chk(o8.msg === 'This Kosmos is no longer the work Kosmos for Acme <i>Co</i>, so it has stopped reporting.' && o8.italics === 0 && o8.out,
      'O8 a Kosmos the company stopped naming says so, as text, with the code field back', JSON.stringify(o8));
    // O8b (#5791 review 1): Cancel closes the pane a company note opened, and the next read does not open it again.
    await page.click('#plus-org-cancel');
    await page.evaluate(() => { PLUS_ORG.at = 0; plusOrgMaybe(); });
    await page.waitForFunction(() => (window.__org || []).filter((x) => x.path === '/api/org' && x.method === 'GET').length > 0, null, { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(300);
    const o8b = { out: await shown(page, 'plus-org-out'), opener: await shown(page, 'plus-org-open'), msg: await text(page, 'plus-org-msg') };
    chk(!o8b.out && o8b.opener && o8b.msg === '', 'O8 Cancel closes a pane a company note opened, and the next read leaves it closed', JSON.stringify(o8b));
    // Review 2: once the engine no longer carries that note, a later stop by the same company shows again.
    await page.evaluate(() => { window.__stopped = null; PLUS_ORG.at = 0; plusOrgMaybe(); });
    await page.waitForTimeout(300);
    await page.evaluate(() => { window.__stopped = 'Acme <i>Co</i>'; PLUS_ORG.at = 0; plusOrgMaybe(); });
    await page.waitForFunction(() => /no longer the work Kosmos/.test(document.getElementById('plus-org-msg').textContent), null, { timeout: 3000 }).catch(() => {});
    const o8c = { out: await shown(page, 'plus-org-out'), msg: await text(page, 'plus-org-msg') };
    chk(o8c.out && /no longer the work Kosmos for Acme/.test(o8c.msg), 'O8 a later stop by the same company shows again after the first note was closed', JSON.stringify(o8c));
    await page.click('#plus-org-cancel');
    await page.evaluate(() => { window.__stopped = null; PLUS_ORG.at = 0; plusOrgMaybe(); });
    await page.waitForTimeout(300);
    await page.click('#plus-org-open');

    // O14: an enroll that did not join says why under the field, which stays, and the joined view does not show.
    for (const ans of [{ ok: false, unknown: true, code: 'org_join_unknown', because: 'It is not known yet whether joining went through. This Kosmos will ask your company again in a few minutes; if joining went through, this screen will show it.' },
      { ok: false, code: 'org_consent_changed', because: 'Your company changed its terms just now. Nothing was joined. Press Connect Account again.' },
      { ok: false, code: 'org_undo_pending', because: 'Your company did not confirm this Kosmos, so it is not your work Kosmos. Joining could not be undone yet, so your company may still list this Kosmos. It is not reporting.' }]) {
      await page.evaluate((a) => { window.__enrollAnswer = a; }, ans);
      await connect('ACME-JOIN-8888');
      const o14 = { msg: await text(page, 'plus-org-msg'), out: await shown(page, 'plus-org-out'), in: await shown(page, 'plus-org-in'), code: await page.inputValue('#plus-org-code') };
      // Review 5: a spent code (outcome unknown, undo pending) leaves the field; a refusal that joined nothing keeps it.
      const spent = ans.code === 'org_join_unknown' || ans.code === 'org_undo_pending';
      chk(o14.msg === ans.because && o14.out && !o14.in && o14.code === (spent ? '' : 'ACME-JOIN-8888'),
        'O14 ' + ans.code + ' says so under the code field, nothing shows as joined, and the field ' + (spent ? 'is cleared' : 'keeps the code'), JSON.stringify(o14));
    }
    await page.evaluate(() => { window.__enrollAnswer = null; });

    // O15: a joined Kosmos that does not report yet has no button to press (the board takes the terms on itself), and
    // says which wait it is in. CONTROL: one that reports says nothing more.
    const joinedAs = (st) => page.evaluate((s) => { PLUS_ORG.at = Date.now(); PLUS_ORG.state = Object.assign({ enrolled: true, org: { name: 'Acme', slug: 'acme' }, role: 'member' }, s);
      document.getElementById('plus-org-msg').textContent = ''; plusOrgPaint();
      return { say: document.getElementById('plus-org-say').textContent,
        buttons: [...document.querySelectorAll('#plus-org-in button')].filter((b) => b.getClientRects().length > 0).map((b) => b.textContent.trim()) }; }, st);
    const o15 = { reporting: await joinedAs({ reporting: true }), terms: await joinedAs({ reporting: false, reportingWait: null }), print: await joinedAs({ reporting: false, reportingWait: 'print' }),
      printError: await joinedAs({ reporting: false, reportingWait: 'printError' }), noReports: await joinedAs({ reporting: false, reportingWait: 'noReports' }) };
    chk(o15.reporting.say === 'This Kosmos is your work Kosmos for Acme.'
        && /once Kosmos has your company's current terms\.$/.test(o15.terms.say)
        && /once it has read this computer's identity\.$/.test(o15.print.say)
        && /cannot report to your company yet: Kosmos could not check this computer\.$/.test(o15.printError.say)
        && /Your company asks it to report nothing\.$/.test(o15.noReports.say)
        && Object.values(o15).every((v) => JSON.stringify(v.buttons) === '["Leave company"]'),
      'O15 a joined Kosmos says which wait it is in, and offers only Leave company', JSON.stringify(o15));
    await page.evaluate(() => { PLUS_ORG.state = { enrolled: false, org: null, role: null }; plusOrgPaint(); });

    // O17 (review 1): on a FRESH page, before any click. (a) /api/org fails: still only the button. (b) This Kosmos is
    // already its company's work Kosmos: the heading and the joined view show at once, no button. (c) A company note
    // opens the block on its own (review 3).
    for (const [label, init, want] of [
      ['a read that fails', () => { window.__orgFail = true; }, { opener: true, title: false, out: false, in: false }],
      ['already joined', () => { window.__orgState = { enrolled: true, reporting: true, stoppedFor: null, leaveRefused: null, org: { name: 'Acme', slug: 'acme' }, role: 'member', enrolledAt: '2026-10-07T00:00:00.000Z' }; }, { opener: false, title: true, out: false, in: true }],
      ['a company note (stopped)', () => { window.__stopped = 'Acme'; }, { opener: false, title: false, out: true, in: false }]]) {
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

    chk(errs.length === 0, 'O6 no page errors', errs.join(' | '));
  } finally {
    await browser.close();
  }
  if (fail.length) { console.log('\n' + fail.length + ' failed'); process.exit(1); }
  console.log('\nall company-join checks passed');
})();
