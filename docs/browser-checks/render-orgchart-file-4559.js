// Browser-check-surface: team-orgchart-open cstep-team orgchartpick orgchart-read-stop orgchart-edit orgchart-file-btn orgchart-file orgchart-file-note orgchart-consent orgchart-consent-say orgchart-consent-go orgchart-consent-no orgchart-preview-box orgchart-count orgchart-list orgchart-create orgchart-msg orgchart-usenames
'use strict';

/*
 * #4559: New Agent > Upload an org chart takes the chart FILE (Josh: "upload an actual org chart file or
 * something and have it capture people roles and reporting structures"). Every name here is synthetic.
 *
 *   CSV       unmocked: test-support/orgchart-4559/people.csv goes through the real /api/orgchart/read. The
 *             preview lists the seven people with each "reports to" already set from the file, agents named
 *             for their titles (names off). Create sends managers first, each with its manager's agent name.
 *             RED on main: there is no file button.
 *   XLSX      unmocked, the same seven from people.xlsx.
 *   PICTURE   /api/orgchart/read answered at the browser (a check cannot sign in to a provider):
 *             - the first answer names the provider and the consent box says so; Cancel sends nothing more;
 *             - Read it sends the file again with consent=1; an unsure line shows "Check this: <why>" and
 *               Create stays disabled until Looks right (or a new manager is chosen);
 *             - making a reporting loop by hand names it and disables Create again.
 *   NO CLAUDE the "needs a Claude connection" answer is shown and nothing else happens.
 *   ORPHAN    a manager the team create refuses: the person under them is put under you (PUT profile
 *             reportsTo '') and the result says so.
 * Light and dark screenshots of the picture preview with its Check this line (SHOT_DIR).
 *
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-orgchart-file-4559.js http://127.0.0.1:PORT
 */

const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const BASE = process.argv[2] || process.env.KOSMOS_URL || 'http://127.0.0.1:17461';
const SHOTS = process.env.SHOT_DIR || '';
const FIX = path.join(__dirname, '..', '..', 'test-support', 'orgchart-4559');

const fails = [];
function check(name, pass, detail) {
  console.log((pass ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  ' + detail : ''));
  if (!pass) fails.push(name);
}

async function openPanel(pg) {
  /* #4556: New Agent opens on the three-way choice, and the org chart lives on the Team screen, behind its own
     "Upload an org chart" button. */
  await pg.goto(BASE + '/?tab=create', { waitUntil: 'networkidle' });
  await pg.click('#cstep-kind [data-path="team"]');
  await pg.waitForSelector('#team-orgchart-open', { state: 'visible', timeout: 10000 });
  await pg.click('#team-orgchart-open');
  await pg.waitForSelector('#orgchartpick', { state: 'visible', timeout: 8000 });
}

function readPreview(pg) {
  return pg.evaluate(() => {
    const box = document.getElementById('orgchart-preview-box');
    const rows = [...document.querySelectorAll('#orgchart-list li')].map((li) => {
      const sel = li.querySelector('.oc-reports-to');
      const chosen = sel && sel.selectedOptions[0] ? sel.selectedOptions[0].textContent : null;
      const check = li.querySelector('.oc-check');
      return { text: li.textContent, reports: chosen, check: check ? check.textContent : '', ok: Boolean(li.querySelector('.oc-ok')) };
    });
    return {
      shown: Boolean(box && !box.hidden),
      count: document.getElementById('orgchart-count').textContent,
      rows,
      createDisabled: document.getElementById('orgchart-create').disabled,
      msg: document.getElementById('orgchart-msg').hidden ? '' : document.getElementById('orgchart-msg').textContent,
      consent: document.getElementById('orgchart-consent').hidden ? '' : document.getElementById('orgchart-consent-say').textContent,
    };
  });
}

/* The seven synthetic people, and who each reports to as the preview should show it. */
const EXPECT_REPORTS = [
  'You (top of the chart)',
  'Chief Executive (Avery Quill)', 'Chief Executive (Avery Quill)', 'Chief Executive (Avery Quill)',
  'Head of Sales (Bo Linden)', 'Head of Sales (Bo Linden)', 'Head of Operations (Dev Mariner)',
];

const PICTURE_ROWS = [
  { person: 'Avery Quill', title: 'Chief Executive', reportsTo: null, why: null },
  { person: 'Bo Linden', title: 'Head of Sales', reportsTo: 0, why: null },
  { person: 'Eli Tamsin', title: 'Account Executive', reportsTo: 1, why: null },
  { person: 'Fen Ashby', title: 'Sales Engineer', reportsTo: 1, why: 'Fen could report to Eli instead of Bo; the line is unclear' },
];

async function run() {
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  const page = (opts = {}) => browser.newContext({ viewport: { width: 1280, height: 1000 }, ...opts }).then((c) => c.newPage());
  try {
    // CSV (unmocked read; the team create is answered at the browser and recorded)
    const p1 = await page();
    const teams = [];
    await p1.route('**/api/team', (r) => {
      const body = JSON.parse(r.request().postData() || '{}');
      teams.push(body);
      r.fulfill({ status: 200, json: { outcome: 'created', created: body.members.map((m) => ({ name: m.name, shownAs: m.label })), refused: [] } });
    });
    await openPanel(p1);
    const hasButton = await p1.$('#orgchart-file-btn');
    check('CSV: the panel offers a file', Boolean(hasButton));
    if (hasButton) {
      await p1.setInputFiles('#orgchart-file', path.join(FIX, 'people.csv'));
      await p1.waitForSelector('#orgchart-preview-box:not([hidden])', { timeout: 10000 });
      const c = await readPreview(p1);
      check('CSV: seven people, counted', c.rows.length === 7 && /This will create 7 agents:/.test(c.count), JSON.stringify(c.count));
      check('CSV: each reports to whom the file says', JSON.stringify(c.rows.map((x) => x.reports)) === JSON.stringify(EXPECT_REPORTS), JSON.stringify(c.rows.map((x) => x.reports)));
      check('CSV: agents are named for their titles, the person shown only as "from"', /from Avery Quill/.test(c.rows[0].text) && /→ chief-executive$/.test(c.rows[0].text) && !c.rows.some((x) => /named /.test(x.text)), c.rows[0].text);
      check('CSV: nothing needs a look, so Create is ready', !c.createDisabled && c.rows.every((x) => !x.check), JSON.stringify(c.rows.map((x) => x.check)));
      await p1.click('#orgchart-create');
      await p1.waitForFunction(() => /Created 7 agents/.test(document.getElementById('orgchart-count').textContent), null, { timeout: 8000 });
      const m = teams[0] ? teams[0].members : [];
      const idx = (n) => m.findIndex((x) => x.name === n);
      check('CSV: Create sends every manager before the people under them', m.length === 7 && idx('chief-executive') < idx('head-of-sales') && idx('head-of-sales') < idx('account-executive') && idx('head-of-operations') < idx('office-manager'), JSON.stringify(m.map((x) => x.name)));
      check('CSV: seven people are within the usual team size, so Create asks nothing and sends no raise', teams[0] && !('cap' in teams[0]), JSON.stringify(teams[0] && teams[0].cap));
      check('CSV: each member carries its manager\'s agent name, the top none', !('reportsTo' in m[idx('chief-executive')]) && m[idx('account-executive')].reportsTo === 'head-of-sales' && m[idx('office-manager')].reportsTo === 'head-of-operations', JSON.stringify(m));
    }
    await p1.close();

    // XLSX (unmocked)
    const p2 = await page();
    await openPanel(p2);
    if (await p2.$('#orgchart-file-btn')) {
      await p2.setInputFiles('#orgchart-file', path.join(FIX, 'people.xlsx'));
      await p2.waitForSelector('#orgchart-preview-box:not([hidden])', { timeout: 10000 });
      const x = await readPreview(p2);
      check('XLSX: the same seven and the same reporting lines', x.rows.length === 7 && JSON.stringify(x.rows.map((r) => r.reports)) === JSON.stringify(EXPECT_REPORTS), JSON.stringify(x.rows.map((r) => r.reports)));
    } else check('XLSX: the panel offers a file', false);
    await p2.close();

    // PICTURE (read route answered at the browser), light then dark
    for (const scheme of ['light', 'dark']) {
      const p3 = await page({ colorScheme: scheme });
      const reads = [];
      await p3.route('**/api/orgchart/read*', (r) => {
        const consent = new URL(r.request().url()).searchParams.get('consent') === '1';
        reads.push({ consent, name: decodeURIComponent(r.request().headers()['x-orgchart-name'] || ''), bytes: (r.request().postDataBuffer() || Buffer.alloc(0)).length });
        r.fulfill({ status: 200, json: consent ? { source: 'model', provider: 'Anthropic (Claude)', rows: PICTURE_ROWS, problems: [] } : { needsConsent: true, provider: 'Anthropic (Claude)' } });
      });
      await openPanel(p3);
      if (!(await p3.$('#orgchart-file-btn'))) { check('PICTURE: the panel offers a file', false); await p3.close(); continue; }
      const png = fs.readFileSync(path.join(FIX, 'chart.png'));
      await p3.setInputFiles('#orgchart-file', path.join(FIX, 'chart.png'));
      await p3.waitForSelector('#orgchart-consent:not([hidden])', { timeout: 8000 });
      const a = await readPreview(p3);
      if (scheme === 'light') {
        check('PICTURE: before anything is read, the box names the provider and says why it asks', /read by your own AI provider, Anthropic \(Claude\)/.test(a.consent) && /names the people on your chart/.test(a.consent), a.consent);
        check('PICTURE: the first request carried no consent and no file (it only asks who would read it)', reads.length === 1 && reads[0].consent === false && reads[0].bytes === 0, JSON.stringify(reads));
        check('PICTURE: Read it has focus', await p3.evaluate(() => document.activeElement && document.activeElement.id) === 'orgchart-consent-go');
        await p3.click('#orgchart-consent-no');
        await p3.waitForTimeout(200);
        const n = await readPreview(p3);
        check('PICTURE: Cancel sends nothing more and says what else works', reads.length === 1 && /Nothing was sent/.test(n.msg) && !n.consent, JSON.stringify([reads.length, n.msg]));
        await p3.setInputFiles('#orgchart-file', path.join(FIX, 'chart.png'));
        await p3.waitForSelector('#orgchart-consent:not([hidden])', { timeout: 8000 });
      }
      await p3.click('#orgchart-consent-go');
      await p3.waitForSelector('#orgchart-preview-box:not([hidden])', { timeout: 8000 });
      const b = await readPreview(p3);
      if (scheme === 'light') {
        const sent = reads[reads.length - 1];
        check('PICTURE: Read it sends the picture itself, with consent', sent.consent === true && sent.name === 'chart.png' && sent.bytes === png.length, JSON.stringify(sent));
        check('PICTURE: the unsure line says Check this and why, with Looks right', /Check this: Fen could report to Eli/.test(b.rows[3].check) && b.rows[3].ok, b.rows[3].check);
        check('PICTURE: Create waits for the look', b.createDisabled && /1 line needs a look first/.test(b.count), b.count);
      }
      if (SHOTS) {
        fs.mkdirSync(SHOTS, { recursive: true });
        const box = p3.locator('#orgchartpick');
        await box.scrollIntoViewIfNeeded();
        await box.screenshot({ path: path.join(SHOTS, 'orgchart-file-4559-' + scheme + '.png') });
      }
      if (scheme === 'light') {
        await p3.click('#orgchart-list li[data-i="3"] .oc-ok');
        const c = await readPreview(p3);
        check('PICTURE: Looks right clears the line and allows Create', !c.createDisabled && !c.rows[3].check && /This will create 4 agents:/.test(c.count), JSON.stringify(c));
        // Put the Chief Executive under the Head of Sales: a loop.
        await p3.selectOption('#orgchart-list li[data-i="0"] .oc-reports-to', '1');
        const l = await readPreview(p3);
        check('PICTURE: a loop made by hand is named and blocks Create', l.createDisabled && /reporting loop/.test(l.rows[0].check) && /reporting loop/.test(l.rows[1].check), JSON.stringify(l.rows.map((r) => r.check)));
        await p3.selectOption('#orgchart-list li[data-i="0"] .oc-reports-to', '');
        const f = await readPreview(p3);
        check('PICTURE: undoing the loop frees Create again', !f.createDisabled, f.count);
      }
      await p3.close();
    }

    // STOP: while a picture is being read, Stop reading ends the request (the board then stops the model call).
    const pst = await page();
    let aborted = false;
    await pst.route('**/api/orgchart/read*', async (r) => {
      const consent = new URL(r.request().url()).searchParams.get('consent') === '1';
      if (!consent) return r.fulfill({ status: 200, json: { needsConsent: true, provider: 'Anthropic (Claude)' } });
      await new Promise((ok) => setTimeout(ok, 3000));   // a read that takes a while
      try { await r.fulfill({ status: 200, json: { source: 'model', provider: 'Anthropic (Claude)', rows: PICTURE_ROWS, problems: [] } }); } catch { aborted = true; }
    });
    await openPanel(pst);
    if (await pst.$('#orgchart-file-btn')) {
      await pst.setInputFiles('#orgchart-file', path.join(FIX, 'chart.png'));
      await pst.waitForSelector('#orgchart-consent:not([hidden])', { timeout: 8000 });
      await pst.click('#orgchart-consent-go');
      await pst.waitForSelector('#orgchart-read-stop:not([hidden])', { timeout: 5000 }).catch(() => {});
      const shown = await pst.isVisible('#orgchart-read-stop');
      await pst.click('#orgchart-read-stop').catch(() => {});
      await pst.waitForFunction(() => /Stopped/.test(document.getElementById('orgchart-msg').textContent), null, { timeout: 5000 }).catch(() => {});
      const st = await readPreview(pst);
      await pst.waitForTimeout(3500);   // past the read's own answer: it must not paint over the stop
      const after = await readPreview(pst);
      check('STOP: Stop reading shows during a read and ends it; its late answer paints nothing',
        shown && /Stopped\. Nothing more was read\./.test(st.msg) && !after.shown && await pst.evaluate(() => document.getElementById('orgchart-read-stop').hidden), JSON.stringify([shown, st.msg, after.shown, aborted]));
    } else check('STOP: the panel offers a file', false);
    await pst.close();

    /* #4556: leaving the Team screen (Back) or closing the org chart panel while a picture is being read ends the
       read, so its model call stops too; reopening shows no consent box left armed. */
    for (const how of ['back', 'close']) {
      const pl2 = await page();
      let leftAborted = false;
      await pl2.route('**/api/orgchart/read*', async (r) => {
        const consent = new URL(r.request().url()).searchParams.get('consent') === '1';
        if (!consent) return r.fulfill({ status: 200, json: { needsConsent: true, provider: 'Anthropic (Claude)' } });
        await new Promise((ok) => setTimeout(ok, 3000));   // a read that takes a while
        try { await r.fulfill({ status: 200, json: { source: 'model', provider: 'Anthropic (Claude)', rows: PICTURE_ROWS, problems: [] } }); } catch { leftAborted = true; }
      });
      await openPanel(pl2);
      if (await pl2.$('#orgchart-file-btn')) {
        await pl2.setInputFiles('#orgchart-file', path.join(FIX, 'chart.png'));
        await pl2.waitForSelector('#orgchart-consent:not([hidden])', { timeout: 8000 });
        await pl2.click('#orgchart-consent-go');
        await pl2.waitForSelector('#orgchart-read-stop:not([hidden])', { timeout: 5000 }).catch(() => {});
        if (how === 'back') await pl2.click('#create-path-back');
        else await pl2.click('#team-orgchart-open');
        await pl2.waitForTimeout(3500);   // past the held read's own answer
        let consentOnReopen = null;
        if (how === 'back') {
          await pl2.click('#cstep-kind [data-path="team"]');
          await pl2.click('#team-orgchart-open');
        } else await pl2.click('#team-orgchart-open');
        await pl2.waitForSelector('#orgchartpick', { state: 'visible', timeout: 8000 });
        consentOnReopen = await pl2.evaluate(() => !document.getElementById('orgchart-consent').hidden);
        check('LEAVE MID-READ (' + how + '): leaving ends the picture read in flight, and reopening shows no consent box',
          leftAborted && !consentOnReopen, JSON.stringify({ leftAborted, consentOnReopen }));
      } else check('LEAVE MID-READ (' + how + '): the panel offers a file', false);
      await pl2.close();
    }

    // PREVIEW: pressing Preview while a picture is being read ends that read too, and its late answer paints nothing.
    const ppv = await page();
    let pvAborted = false;
    await ppv.route('**/api/orgchart/read*', async (r) => {
      const consent = new URL(r.request().url()).searchParams.get('consent') === '1';
      if (!consent) return r.fulfill({ status: 200, json: { needsConsent: true, provider: 'Anthropic (Claude)' } });
      await new Promise((ok) => setTimeout(ok, 3000));
      try { await r.fulfill({ status: 200, json: { source: 'model', provider: 'Anthropic (Claude)', rows: PICTURE_ROWS, problems: [] } }); } catch { /* aborted */ }
    });
    // The page aborting its fetch is what closes the request at the board (and so stops the model call there).
    ppv.on('requestfailed', (q) => { if (/\/api\/orgchart\/read\?consent=1/.test(q.url())) pvAborted = true; });
    await openPanel(ppv);
    if (await ppv.$('#orgchart-file-btn')) {
      await ppv.setInputFiles('#orgchart-file', path.join(FIX, 'chart.png'));
      await ppv.waitForSelector('#orgchart-consent:not([hidden])', { timeout: 8000 });
      await ppv.click('#orgchart-consent-go');
      await ppv.waitForSelector('#orgchart-read-stop:not([hidden])', { timeout: 5000 }).catch(() => {});
      await ppv.fill('#orgchart-text', 'Office Manager');
      await ppv.click('#orgchart-preview');
      const stopGone = await ppv.waitForFunction(() => document.getElementById('orgchart-read-stop').hidden, null, { timeout: 2000 }).then(() => true, () => false);
      await ppv.waitForTimeout(3500);   // past the read's own answer
      const pv = await readPreview(ppv);
      check('PREVIEW: Preview during a read ends it (Stop reading goes) and the box\'s list stays',
        stopGone && pvAborted && pv.rows.length === 1 && /Office Manager/.test(pv.rows[0].text), JSON.stringify([stopGone, pvAborted, pv.rows.map((x) => x.text)]));
    } else check('PREVIEW: the panel offers a file', false);
    await ppv.close();

    // CREATE DURING A READ: Create on the list already previewed ends a picture read still under way, so the read's
    // late answer cannot repaint over the create (and take its result and Undo with it).
    const pcr = await page();
    let crAborted = false;
    await pcr.route('**/api/team', (r) => { const body = JSON.parse(r.request().postData() || '{}'); r.fulfill({ status: 200, json: { outcome: 'created', created: body.members.map((m) => ({ name: m.name, shownAs: m.label })), refused: [] } }); });
    await pcr.route('**/api/orgchart/read*', async (r) => {
      const consent = new URL(r.request().url()).searchParams.get('consent') === '1';
      if (!consent) return r.fulfill({ status: 200, json: { needsConsent: true, provider: 'Anthropic (Claude)' } });
      await new Promise((ok) => setTimeout(ok, 3000));
      try { await r.fulfill({ status: 200, json: { source: 'model', provider: 'Anthropic (Claude)', rows: PICTURE_ROWS, problems: [] } }); } catch { /* aborted */ }
    });
    pcr.on('requestfailed', (q) => { if (/\/api\/orgchart\/read\?consent=1/.test(q.url())) crAborted = true; });
    await openPanel(pcr);
    if (await pcr.$('#orgchart-file-btn')) {
      await pcr.fill('#orgchart-text', 'Office Manager');
      await pcr.click('#orgchart-preview');
      await pcr.waitForSelector('#orgchart-preview-box:not([hidden])', { timeout: 5000 });
      await pcr.setInputFiles('#orgchart-file', path.join(FIX, 'chart.png'));
      await pcr.waitForSelector('#orgchart-consent:not([hidden])', { timeout: 8000 });
      await pcr.click('#orgchart-consent-go');
      await pcr.waitForSelector('#orgchart-read-stop:not([hidden])', { timeout: 5000 }).catch(() => {});
      await pcr.click('#orgchart-create');
      await pcr.waitForFunction(() => /Created 1 agent/.test(document.getElementById('orgchart-count').textContent), null, { timeout: 8000 }).catch(() => {});
      await pcr.waitForTimeout(3500);   // past the read's own answer
      const cr = await pcr.evaluate(() => ({ count: document.getElementById('orgchart-count').textContent, undo: !document.getElementById('orgchart-undo').hidden, stop: !document.getElementById('orgchart-read-stop').hidden }));
      check('CREATE DURING A READ: the create ends the read, and its result and Undo stay on screen',
        crAborted && /Created 1 agent/.test(cr.count) && cr.undo && !cr.stop, JSON.stringify([crAborted, cr]));
    } else check('CREATE DURING A READ: the panel offers a file', false);
    await pcr.close();

    // UNPAIRED: an answer that does not account for every member moves no line, and says the lines were not checked.
    const pu = await page();
    const putsU = [];
    await pu.route('**/api/team', (r) => { const body = JSON.parse(r.request().postData() || '{}'); r.fulfill({ status: 200, json: { outcome: 'partial', created: body.members.slice(1).map((m) => ({ name: m.name, shownAs: m.label })), refused: [] } }); });
    await pu.route('**/api/agent/*/profile', (r) => { putsU.push(r.request().url()); r.fulfill({ status: 200, json: { ok: true } }); });
    await openPanel(pu);
    if (await pu.$('#orgchart-file-btn')) {
      await pu.setInputFiles('#orgchart-file', path.join(FIX, 'people.csv'));
      await pu.waitForSelector('#orgchart-preview-box:not([hidden])', { timeout: 8000 });
      await pu.click('#orgchart-create');
      await pu.waitForFunction(() => /could not check who each new agent reports to/.test(document.getElementById('orgchart-msg').textContent), null, { timeout: 8000 }).catch(() => {});
      const un = await readPreview(pu);
      check('UNPAIRED: an answer missing a member moves no reporting line and says they were not checked', putsU.length === 0 && /could not check who each new agent reports to/.test(un.msg), JSON.stringify([putsU.length, un.msg]));
    } else check('UNPAIRED: the panel offers a file', false);
    await pu.close();

    // LOOP FROM A FILE: a file whose two people report to each other (read for real, not mocked) blocks Create; the
    // person breaks the loop on one row and Create is ready, with no stale note left on the other row.
    const plp = await page();
    await openPanel(plp);
    if (await plp.$('#orgchart-file-btn')) {
      await plp.setInputFiles('#orgchart-file', { name: 'loop.csv', mimeType: 'text/csv', buffer: Buffer.from('Name,Title,Manager\nAvery Quill,Chief Executive,Bo Linden\nBo Linden,Head of Sales,Avery Quill\n') });
      await plp.waitForSelector('#orgchart-preview-box:not([hidden])', { timeout: 8000 });
      const before = await readPreview(plp);
      await plp.selectOption('#orgchart-list li[data-i="0"] .oc-reports-to', '');
      await plp.waitForTimeout(200);
      const after = await readPreview(plp);
      check('LOOP FROM A FILE: a loop in the file blocks Create; breaking it on one row leaves no stale note and Create is ready',
        before.createDisabled && !after.createDisabled && after.rows.every((x) => !x.check), JSON.stringify([before.createDisabled, after.createDisabled, after.rows.map((x) => x.check)]));
    } else check('LOOP FROM A FILE: the panel offers a file', false);
    await plp.close();

    // MANY: past the usual team size (12), Create asks in words about the load and the bill; Not now sends nothing,
    // and only Start all sends #2972's raise, set to the chart's size (Liu Kang m3436).
    const pm = await page();
    const teamsM = [];
    await pm.route('**/api/team', (r) => { const body = JSON.parse(r.request().postData() || '{}'); teamsM.push(body); r.fulfill({ status: 200, json: { outcome: 'created', created: body.members.map((m) => ({ name: m.name, shownAs: m.label })), refused: [] } }); });
    await openPanel(pm);
    if (await pm.$('#orgchart-file-btn')) {
      const thirteen = 'Name,Title\n' + Array.from({ length: 13 }, (_, i) => 'Person ' + (i + 1) + ',Role ' + (i + 1)).join('\n');
      await pm.setInputFiles('#orgchart-file', { name: 'thirteen.csv', mimeType: 'text/csv', buffer: Buffer.from(thirteen) });
      await pm.waitForSelector('#orgchart-preview-box:not([hidden])', { timeout: 8000 });
      await pm.click('#orgchart-create');
      await pm.waitForSelector('#orgchart-many:not([hidden])', { timeout: 3000 }).catch(() => {});
      const ask = await pm.evaluate(() => ({ shown: !document.getElementById('orgchart-many').hidden, say: document.getElementById('orgchart-many-say').textContent, go: document.getElementById('orgchart-many-go').textContent }));
      check('MANY: Create on 13 people asks first, naming the subscription and the memory, and sends nothing yet',
        ask.shown && ask.say === 'This starts 13 agents at once. Each one runs on your AI subscription and uses this computer\'s memory. Start all 13?' && ask.go === 'Start all 13' && teamsM.length === 0, JSON.stringify([ask, teamsM.length]));
      await pm.click('#orgchart-many-no');
      await pm.waitForTimeout(300);
      const no = await readPreview(pm);
      check('MANY: Not now creates nothing and, for a file, says to shorten the file (the paste box does not hold its people)', teamsM.length === 0 && /Nothing was created\. To make fewer, remove people from the file and upload it again/.test(no.msg) && !no.createDisabled, JSON.stringify([teamsM.length, no.msg]));
      await pm.click('#orgchart-create');
      await pm.waitForSelector('#orgchart-many:not([hidden])', { timeout: 3000 }).catch(() => {});
      await pm.click('#orgchart-many-go');
      await pm.waitForFunction(() => /Created 13 agents/.test(document.getElementById('orgchart-count').textContent), null, { timeout: 8000 }).catch(() => {});
      check('MANY: Start all sends the raise set to the chart\'s size, once', teamsM.length === 1 && teamsM[0].cap === 13 && teamsM[0].members.length === 13, JSON.stringify(teamsM.map((t) => [t.cap, t.members.length])));
    } else check('MANY: the panel offers a file', false);
    await pm.close();

    // LEAVE: leaving the panel with a picture waiting for Read it disarms it; coming back shows no consent box.
    const pl = await page();
    await pl.route('**/api/orgchart/read*', (r) => r.fulfill({ status: 200, json: { needsConsent: true, provider: 'Anthropic (Claude)' } }));
    await openPanel(pl);
    if (await pl.$('#orgchart-file-btn')) {
      await pl.setInputFiles('#orgchart-file', path.join(FIX, 'chart.png'));
      await pl.waitForSelector('#orgchart-consent:not([hidden])', { timeout: 8000 });
      // #4556: the panel is closed and reopened with the Team screen's own "Upload an org chart" button.
      await pl.click('#team-orgchart-open');
      await pl.waitForSelector('#orgchartpick', { state: 'hidden', timeout: 8000 });
      await pl.click('#team-orgchart-open');
      await pl.waitForSelector('#orgchartpick', { state: 'visible', timeout: 8000 });
      const lv = await readPreview(pl);
      check('LEAVE: leaving the panel disarms a picture waiting for Read it', !lv.consent, JSON.stringify(lv.consent));
    } else check('LEAVE: the panel offers a file', false);
    await pl.close();

    // NO CLAUDE
    const p4 = await page();
    const { NO_MODEL } = require('../../engine/orgchartfile');   // the route's own sentence, not a copy
    await p4.route('**/api/orgchart/read*', (r) => r.fulfill({ status: 200, json: { unavailable: true, problems: [NO_MODEL] } }));
    await openPanel(p4);
    if (await p4.$('#orgchart-file-btn')) {
      await p4.setInputFiles('#orgchart-file', path.join(FIX, 'chart.pdf'));
      await p4.waitForTimeout(500);
      const u = await readPreview(p4);
      check('NO CLAUDE: says a Claude connection is needed and offers CSV, Excel or typing; no consent box, no preview', /needs a Claude connection right now/.test(u.msg) && !u.consent && !u.shown, JSON.stringify(u));
    } else check('NO CLAUDE: the panel offers a file', false);
    await p4.close();

    // ORPHAN: the manager is refused, the person under them is put under you
    const p5 = await page();
    const puts = [];
    await p5.route('**/api/team', (r) => {
      const body = JSON.parse(r.request().postData() || '{}');
      r.fulfill({ status: 200, json: { outcome: 'partial',
        created: body.members.filter((m) => m.name !== 'head-of-sales').map((m) => ({ name: m.name, shownAs: m.label })),
        refused: [{ name: 'head-of-sales', because: 'that name is taken' }] } });
    });
    await p5.route('**/api/agent/*/profile', (r) => { puts.push({ name: decodeURIComponent(new URL(r.request().url()).pathname.split('/')[3]), body: r.request().postData() }); r.fulfill({ status: 200, json: { ok: true } }); });
    await p5.route('**/api/orgchart/read*', (r) => r.fulfill({ status: 200, json: { source: 'file', rows: PICTURE_ROWS.slice(0, 3), problems: [] } }));
    await openPanel(p5);
    if (await p5.$('#orgchart-file-btn')) {
      await p5.setInputFiles('#orgchart-file', path.join(FIX, 'people.csv'));
      await p5.waitForSelector('#orgchart-preview-box:not([hidden])', { timeout: 8000 });
      await p5.click('#orgchart-create');
      await p5.waitForFunction(() => /Created 2 of 3/.test(document.getElementById('orgchart-count').textContent), null, { timeout: 8000 });
      const t = await p5.evaluate(() => document.getElementById('orgchart-msg').textContent);
      check('ORPHAN: the person under a manager who was not created is put under you', puts.length === 1 && puts[0].name === 'account-executive' && puts[0].body === JSON.stringify({ reportsTo: '' }), JSON.stringify(puts));
      check('ORPHAN: and the result says so', /1 agent now reports to you, because their manager was not created\./.test(t), t);
    } else check('ORPHAN: the panel offers a file', false);
    await p5.close();

    // AFTER CREATE + TOO BIG: toggling names after a create leaves the result (and its Undo) alone; a file over the
    // board's limit is refused in the page, in words, before any upload.
    const pa = await page();
    await pa.route('**/api/team', (r) => { const body = JSON.parse(r.request().postData() || '{}'); r.fulfill({ status: 200, json: { outcome: 'created', created: body.members.map((m) => ({ name: m.name, shownAs: m.label })), refused: [] } }); });
    let reads = 0;
    await pa.route('**/api/orgchart/read*', (r) => { reads += 1; r.fulfill({ status: 200, json: { source: 'file', rows: PICTURE_ROWS.map((x) => ({ ...x, why: null })), problems: [] } }); });
    await openPanel(pa);
    if (await pa.$('#orgchart-file-btn')) {
      await pa.setInputFiles('#orgchart-file', path.join(FIX, 'people.csv'));
      await pa.waitForSelector('#orgchart-preview-box:not([hidden])', { timeout: 8000 });
      await pa.click('#orgchart-create');
      await pa.waitForFunction(() => /Created 4 agents/.test(document.getElementById('orgchart-count').textContent), null, { timeout: 8000 });
      await pa.click('#orgchart-usenames');
      await pa.waitForTimeout(300);
      const ac = await pa.evaluate(() => ({ count: document.getElementById('orgchart-count').textContent, create: document.getElementById('orgchart-create').disabled, undo: !document.getElementById('orgchart-undo').hidden }));
      check('AFTER CREATE: toggling names leaves the result, keeps Create disabled and keeps Undo', /Created 4 agents/.test(ac.count) && ac.create && ac.undo, JSON.stringify(ac));
      await pa.click('#orgchart-usenames');
      const before = reads;
      await pa.setInputFiles('#orgchart-file', { name: 'huge.csv', mimeType: 'text/csv', buffer: Buffer.alloc(10 * 1024 * 1024 + 1, 0x41) });
      await pa.waitForTimeout(300);
      const big = await readPreview(pa);
      check('TOO BIG: a file over the limit is refused in the page, before any upload', reads === before && /larger than 10 MB/.test(big.msg), JSON.stringify([reads - before, big.msg]));
      // TOO MANY: past the most one create can make, the preview says so, paints no list and Create stays off.
      await pa.unroute('**/api/orgchart/read*');
      const many = 'Name,Title\n' + Array.from({ length: 51 }, (_, i) => 'Person ' + (i + 1) + ',Role ' + (i + 1)).join('\n');
      await pa.setInputFiles('#orgchart-file', { name: 'many.csv', mimeType: 'text/csv', buffer: Buffer.from(many) });
      await pa.waitForFunction(() => /This list has 51 people/.test(document.getElementById('orgchart-count').textContent), null, { timeout: 8000 }).catch(() => {});
      const mn = await readPreview(pa);
      // BIG PICTURE: a picture over what the model takes is refused before the consent box, so a yes cannot end in a refusal.
      await pa.route('**/api/orgchart/read*', (r) => { reads += 1; r.fulfill({ status: 200, json: { needsConsent: true, provider: 'Anthropic (Claude)' } }); });
      const beforePic = reads;
      await pa.setInputFiles('#orgchart-file', { name: 'big.png', mimeType: 'image/png', buffer: Buffer.alloc(6 * 1024 * 1024, 0x41) });
      await pa.waitForTimeout(300);
      const bp = await pa.evaluate(() => ({ msg: document.getElementById('orgchart-msg').textContent, consent: !document.getElementById('orgchart-consent').hidden }));
      check('BIG PICTURE: a 6 MB picture is refused in the page, before the consent box and any request', reads === beforePic && !bp.consent && /picture is larger than 5 MB/.test(bp.msg), JSON.stringify([reads - beforePic, bp]));
      await pa.unroute('**/api/orgchart/read*');
      check('TOO MANY: a 51-person file is refused in the preview, with no list and Create off', /This list has 51 people\. Kosmos makes at most 50 agents at a time/.test(mn.count) && mn.rows.length === 0 && mn.createDisabled, JSON.stringify([mn.count, mn.rows.length, mn.createDisabled]));
    } else check('AFTER CREATE: the panel offers a file', false);
    await pa.close();

    // LEAVE DURING CREATE: the person leaves the panel while the team is being made. The screen is left alone, but the
    // reporting-line fix-up (a manager created under another name) still lands, since it corrects data, not the screen.
    const plc = await page();
    const putsL = [];
    await plc.route('**/api/team', async (r) => {
      const body = JSON.parse(r.request().postData() || '{}');
      await new Promise((ok) => setTimeout(ok, 1500));   // a create that takes a moment
      r.fulfill({ status: 200, json: { outcome: 'created',
        created: body.members.map((m) => ({ name: m.name === 'head-of-sales' ? 'head-of-sales-2' : m.name, shownAs: m.label })), refused: [] } });
    });
    await plc.route('**/api/agent/*/profile', (r) => { putsL.push(decodeURIComponent(new URL(r.request().url()).pathname.split('/')[3]) + '=' + r.request().postData()); r.fulfill({ status: 200, json: { ok: true } }); });
    await plc.route('**/api/orgchart/read*', (r) => r.fulfill({ status: 200, json: { source: 'file', rows: PICTURE_ROWS.map((x) => ({ ...x, why: null })), problems: [] } }));
    await openPanel(plc);
    if (await plc.$('#orgchart-file-btn')) {
      await plc.setInputFiles('#orgchart-file', path.join(FIX, 'people.csv'));
      await plc.waitForSelector('#orgchart-preview-box:not([hidden])', { timeout: 8000 });
      await plc.click('#orgchart-create');
      await plc.waitForTimeout(300);
      await plc.click('#create-path-back');   // leave the panel mid-create (#4556: Back to the three-way choice)
      await plc.waitForTimeout(2500);   // past the create's answer
      const sortedL = putsL.slice().sort();
      check('LEAVE DURING CREATE: the reporting-line fix-up still lands after the person left the panel',
        JSON.stringify(sortedL) === JSON.stringify(['account-executive={"reportsTo":"head-of-sales-2"}', 'sales-engineer={"reportsTo":"head-of-sales-2"}']), JSON.stringify(sortedL));
    } else check('LEAVE DURING CREATE: the panel offers a file', false);
    await plc.close();

    // RENAMED + FAILED: create canonicalises a manager's name (head-of-sales -> head-of-sales-2), so the person
    // under it is re-pointed to the name it was created under; and a profile update that fails is named, not counted.
    const p6 = await page();
    const puts6 = [];
    await p6.route('**/api/team', (r) => {
      const body = JSON.parse(r.request().postData() || '{}');
      r.fulfill({ status: 200, json: { outcome: 'created',
        created: body.members.map((m) => ({ name: m.name === 'head-of-sales' ? 'head-of-sales-2' : m.name, shownAs: m.label })), refused: [] } });
    });
    await p6.route('**/api/agent/*/profile', (r) => {
      const name = decodeURIComponent(new URL(r.request().url()).pathname.split('/')[3]);
      puts6.push({ name, body: r.request().postData() });
      r.fulfill(name === 'sales-engineer' ? { status: 404, json: { error: 'no agent by that name' } } : { status: 200, json: { ok: true } });
    });
    await p6.route('**/api/orgchart/read*', (r) => r.fulfill({ status: 200, json: { source: 'file', rows: PICTURE_ROWS.map((x) => ({ ...x, why: null })), problems: [] } }));
    await openPanel(p6);
    if (await p6.$('#orgchart-file-btn')) {
      await p6.setInputFiles('#orgchart-file', path.join(FIX, 'people.csv'));
      await p6.waitForSelector('#orgchart-preview-box:not([hidden])', { timeout: 8000 });
      await p6.click('#orgchart-create');
      await p6.waitForFunction(() => /Created 4 agents/.test(document.getElementById('orgchart-count').textContent), null, { timeout: 8000 });
      await p6.waitForFunction(() => !document.getElementById('orgchart-msg').hidden, null, { timeout: 5000 }).catch(() => {});
      const m6 = await p6.evaluate(() => document.getElementById('orgchart-msg').textContent);
      const sorted = puts6.map((x) => x.name + '=' + x.body).sort();
      check('RENAMED: the reports of a manager created under another name are re-pointed to that name',
        JSON.stringify(sorted) === JSON.stringify(['account-executive={"reportsTo":"head-of-sales-2"}', 'sales-engineer={"reportsTo":"head-of-sales-2"}']), JSON.stringify(sorted));
      check('FAILED: an update that failed is named, and nothing is claimed for it', /We could not update who sales-engineer reports to/.test(m6) && !/now reports to you/.test(m6), m6);
    } else check('RENAMED: the panel offers a file', false);
    await p6.close();
  } finally {
    await browser.close();
  }
  if (fails.length) { console.log('\n' + fails.length + ' FAILED'); process.exit(1); }
  console.log('\nall passed');
}

run().catch((e) => { console.error(e); process.exit(1); });
