#!/usr/bin/env node
/*
 * #5531 (Enterprise E0.2, umbrella #5529): Settings > Kosmos+ > Your company, the block where a person joins this
 * Kosmos to a company. Runs the real page (web/index.html, file://) with fetch answered by a stand-in for the board's
 * /api/org routes, so nothing reaches a board or a coordinator, and drives the block directly.
 *
 *   O1  not joined: the code field shows; the consent and the joined line do not.
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
 *   O12 a retried leave the company refused as the last admin (leaveRefused from /api/org) says so, as text, with the
 *       joined view back: the person was told it had stopped (#5531 review 21).
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
      if (u.endsWith('/api/org/preview')) return enc(Object.assign({ ok: true, org: { id: 'org_1', name: 'Acme', slug: 'acme' }, role: 'member', consent: window.__noNever ? Object.assign({}, consent, { never: [] }) : consent, ticket: 't-' + Date.now() }, window.__move ? { move: true } : {}));
      if (u.endsWith('/api/org/enroll')) return enc({ ok: true, org: { id: 'org_1', name: 'Acme', slug: 'acme' }, role: 'member' });
      if (u.endsWith('/api/org/leave')) return enc(window.__leaveRefused || (window.__localOnly ? { ok: true, localOnly: true } : { ok: true }));
      if (u.endsWith('/api/org')) return enc(window.__refused
        ? { enrolled: true, stoppedFor: null, leaveRefused: window.__refused, org: { name: 'Acme', slug: 'acme' }, role: 'admin', enrolledAt: '2026-10-07T00:00:00.000Z' }
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
    await page.waitForFunction(() => { const el = document.getElementById('plus-org-out'); return el && !el.hidden && el.getClientRects().length > 0; }, null, { timeout: 10000 }).catch(() => {});
    const o1 = { out: await shown(page, 'plus-org-out'), consent: await shown(page, 'plus-org-consent'), in: await shown(page, 'plus-org-in') };
    chk(o1.out && !o1.consent && !o1.in, 'O1 not joined: the code field shows, and neither the consent nor the joined line', JSON.stringify(o1));

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
    await page.evaluate(() => { window.__refused = null; PLUS_ORG.state = { enrolled: false, org: null, role: null }; plusOrgPaint(); });

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

    chk(errs.length === 0, 'O6 no page errors', errs.join(' | '));
  } finally {
    await browser.close();
  }
  if (fail.length) { console.log('\n' + fail.length + ' failed'); process.exit(1); }
  console.log('\nall company-join checks passed');
})();
