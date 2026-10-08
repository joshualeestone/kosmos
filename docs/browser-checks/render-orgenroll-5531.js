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
 *   O4  Join sends exactly { code, accepted: true } to /api/org/enroll, and the block then says this is the work Kosmos.
 *   O5  Leave asks first; Leave then posts /api/org/leave and the code field returns.
 *   O6  no page errors.
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
      if (u.endsWith('/api/org/preview')) return enc(Object.assign({ ok: true, org: { id: 'org_1', name: 'Acme', slug: 'acme' }, role: 'member', consent }, window.__move ? { move: true } : {}));
      if (u.endsWith('/api/org/enroll')) return enc({ ok: true, org: { id: 'org_1', name: 'Acme', slug: 'acme' }, role: 'member' });
      if (u.endsWith('/api/org/leave')) return enc({ ok: true });
      if (u.endsWith('/api/org')) return enc({ enrolled: false, org: null, role: null, enrolledAt: null });
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
      focus: document.activeElement && document.activeElement.id,
      outHidden: document.getElementById('plus-org-out').hidden,
    }));
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'orgenroll-consent.png') });
    chk(/Acme invites you to join/.test(o2.ask) && o2.reports.length === 2 && o2.reports[1].includes('<b>bold?</b>') && o2.bold === 0
        && o2.readers === 2 && o2.never === 2 && o2.focus === 'plus-org-join' && o2.outHidden,
      'O2 Check code shows the company and the four lists as text (markup stays text), with focus on Join', JSON.stringify(o2));

    const before = await page.evaluate(() => window.__org.length);
    await page.click('#plus-org-notnow');
    const o3 = await page.evaluate((n) => ({ sent: window.__org.slice(n), msg: document.getElementById('plus-org-msg').textContent, consent: !document.getElementById('plus-org-consent').hidden }), before);
    chk(o3.sent.length === 0 && /Nothing about this Kosmos was sent/.test(o3.msg) && !o3.consent,
      'O3 Not now sends nothing more and says so', JSON.stringify(o3));

    await page.click('#plus-org-check');
    await page.waitForFunction(() => !document.getElementById('plus-org-consent').hidden);
    await page.click('#plus-org-join');
    await page.waitForFunction(() => !document.getElementById('plus-org-in').hidden);
    const o4 = await page.evaluate(() => ({ enroll: window.__org.filter((r) => r.path === '/api/org/enroll'), say: document.getElementById('plus-org-say').textContent }));
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'orgenroll-joined.png') });
    chk(o4.enroll.length === 1 && JSON.stringify(o4.enroll[0].body) === JSON.stringify({ code: 'ACME-JOIN-1234', accepted: true })
        && /work Kosmos for Acme/.test(o4.say),
      'O4 Join sends exactly { code, accepted: true }, and the block says this is the work Kosmos', JSON.stringify(o4));

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
    chk(/already in Acme\. Make this Kosmos your work Kosmos/.test(askMove) && JSON.stringify(lastEnroll.body) === JSON.stringify({ accepted: true }),
      'O7 a member moving here sees the consent as a move, and Join sends no code', JSON.stringify({ askMove, lastEnroll }));

    chk(errs.length === 0, 'O6 no page errors', errs.join(' | '));
  } finally {
    await browser.close();
  }
  if (fail.length) { console.log('\n' + fail.length + ' failed'); process.exit(1); }
  console.log('\nall company-join checks passed');
})();
