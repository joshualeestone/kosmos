// Browser-check-surface: orgchart-undo orgchart-undo-go orgchart-undo-keep orgchart-preview create-path-back team-orgchart-open cstep-team orgchartpick orgchart-read-stop orgchart-edit orgchart-file-btn orgchart-file orgchart-file-note orgchart-consent orgchart-consent-say orgchart-consent-go orgchart-consent-no orgchart-preview-box orgchart-count orgchart-list orgchart-create orgchart-msg orgchart-usenames
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
 *   NO READER the "Claude reads a picture or PDF ... ChatGPT also reads a PNG or JPG picture" answer is shown and nothing else happens (#5346: it leads with Claude).
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

    /* #4556: closing the panel after a create keeps the result and its Undo (only the file flow ends on close).
       #4688: reopening keeps them too, for ORGCHART_UNDO_KEEP_MS after the create. */
    {
      const pk = await page();
      await pk.route('**/api/agent/*/profile', (r) => r.fulfill({ status: 200, json: { ok: true } }));   // #4688: off the sandbox board
      // #4688: the Undo ask's plan reads, mocked (a later arm on this page adds its own removal route over this one).
      await pk.route('**/api/agent/*/removal', (r) => {
        const name = decodeURIComponent(new URL(r.request().url()).pathname.split('/')[3]);
        if (r.request().method() !== 'GET') return r.fulfill({ status: 200, json: { outcome: 'removed' } });
        r.fulfill({ status: 200, json: { ok: true, name, label: name, loses: ['Its place on the board'], keeps: ['Its folder'] } });
      });
      await pk.route('**/api/team', (r) => {
        const body = JSON.parse(r.request().postData() || '{}');
        r.fulfill({ status: 200, json: { outcome: 'created', created: body.members.map((m) => ({ name: m.name, shownAs: m.label })), refused: [] } });
      });
      await openPanel(pk);
      if (await pk.$('#orgchart-file-btn')) {
        await pk.setInputFiles('#orgchart-file', path.join(FIX, 'people.csv'));
        await pk.waitForSelector('#orgchart-preview-box:not([hidden])', { timeout: 10000 });
        await pk.click('#orgchart-create');
        await pk.waitForFunction(() => /Created 7 agents/.test(document.getElementById('orgchart-count').textContent), null, { timeout: 8000 });
        /* #4688 review CONTROL: the 15-minute window is for a result brought back by a reopen. A result the person never
           left keeps its Undo (as before #4688): aged 16 minutes, Undo still asks. */
        await pk.evaluate(() => { ORGCHART_CREATED_AT = Date.now() - 16 * 60 * 1000; });
        await pk.click('#orgchart-undo');
        await pk.waitForSelector('#orgchart-undo-go:not([hidden])', { timeout: 5000 }).catch(() => {});
        const neverLeft = await pk.evaluate(() => ({ asking: !document.getElementById('orgchart-undo-go').hidden, created: ORGCHART_CREATED.length }));
        check('#4688 CONTROL: a result never left still offers Undo past 15 minutes', neverLeft.asking && neverLeft.created === 7, JSON.stringify(neverLeft));
        if (neverLeft.asking) await pk.click('#orgchart-undo-keep');
        await pk.evaluate(() => { ORGCHART_CREATED_AT = Date.now(); });
        await pk.click('#team-orgchart-open');   // close the panel
        await pk.waitForSelector('#orgchartpick', { state: 'hidden', timeout: 5000 });
        const kept = await pk.evaluate(() => ({ created: ORGCHART_CREATED.length, undoShown: !document.getElementById('orgchart-undo').hidden, count: document.getElementById('orgchart-count').textContent }));
        check('CLOSE AFTER CREATE: closing the panel keeps the created team and its Undo', kept.created === 7 && kept.undoShown && /Created 7 agents/.test(kept.count), JSON.stringify(kept));
        // #4688: and reopening it still offers that Undo (the reopen used to clear it).
        await pk.click('#team-orgchart-open');
        await pk.waitForSelector('#orgchartpick', { state: 'visible', timeout: 5000 });
        const re = await pk.evaluate(() => ({ created: ORGCHART_CREATED.length, undoShown: !document.getElementById('orgchart-undo').hidden, box: !document.getElementById('orgchart-preview-box').hidden }));
        check('#4688 CLOSE, REOPEN AFTER CREATE: reopening the panel still offers the team\'s Undo', re.created === 7 && re.undoShown && re.box, JSON.stringify(re));
        /* #4688 review: the kept Undo lasts ORGCHART_UNDO_KEEP_MS (15 minutes) from the create. The create's age is
           set from the page rather than waited out. */
        const reopenAged = async (ageMs) => {
          await pk.evaluate((a) => { ORGCHART_CREATED_AT = Date.now() - a; }, ageMs);
          await pk.click('#team-orgchart-open');   // close
          await pk.waitForSelector('#orgchartpick', { state: 'hidden', timeout: 5000 });
          await pk.click('#team-orgchart-open');   // reopen
          await pk.waitForSelector('#orgchartpick', { state: 'visible', timeout: 5000 });
          return pk.evaluate(() => ({ created: ORGCHART_CREATED.length, undoShown: !document.getElementById('orgchart-undo').hidden,
            box: !document.getElementById('orgchart-preview-box').hidden }));
        };
        const inside = await reopenAged(14 * 60 * 1000);
        check('#4688 CONTROL: a reopen 14 minutes after the create still offers the Undo', inside.created === 7 && inside.undoShown && inside.box, JSON.stringify(inside));
        await pk.evaluate(() => { window.__keptList = ORGCHART_CREATED.slice(); window.__keptResult = ORGCHART_RESULT; });
        const past = await reopenAged(16 * 60 * 1000);
        check('#4688 EXPIRED ON REOPEN: a reopen 16 minutes after the create drops the Undo', past.created === 0 && !past.undoShown && !past.box, JSON.stringify(past));
        // The same list back with a fresh create time, shown on screen, then aged past the window before Undo is pressed.
        await pk.evaluate(() => { ORGCHART_CREATED = window.__keptList; ORGCHART_RESULT = window.__keptResult; ORGCHART_CREATED_AT = Date.now(); });
        const shownAgain = await reopenAged(0);
        await pk.evaluate(() => { ORGCHART_CREATED_AT = Date.now() - 16 * 60 * 1000; });
        // Guarded: where the reopen brings nothing back (main), this is one FAIL line, not a thrown click ending the check.
        if (shownAgain.undoShown) await pk.click('#orgchart-undo');
        const onScreen = await pk.evaluate(() => ({ created: ORGCHART_CREATED.length, undoShown: !document.getElementById('orgchart-undo').hidden,
          asking: !document.getElementById('orgchart-undo-go').hidden, msg: document.getElementById('orgchart-msg').textContent }));
        check('#4688 EXPIRED ON SCREEN: Undo pressed 16 minutes after the create says it is no longer offered and asks nothing',
          shownAgain.created === 7 && shownAgain.undoShown && onScreen.created === 0 && !onScreen.undoShown && !onScreen.asking
          && /Undo is no longer offered/.test(onScreen.msg), JSON.stringify([shownAgain, onScreen]));
        // And past the window between the ask and Remove: nothing is removed and the result, not the ask, is back.
        await pk.evaluate(() => { ORGCHART_CREATED = window.__keptList; ORGCHART_RESULT = window.__keptResult; ORGCHART_CREATED_AT = Date.now(); });
        const shownForRemove = await reopenAged(0);
        await pk.route('**/api/agent/*/removal', (r) => {
          const name = decodeURIComponent(new URL(r.request().url()).pathname.split('/')[3]);
          r.fulfill({ status: 200, json: { ok: true, name, label: name, loses: ['Its place on the board'], keeps: ['Its folder'] } });
        });
        let pkDeletes = 0;
        pk.on('request', (q) => { if (q.method() === 'DELETE') pkDeletes += 1; });
        if (shownForRemove.undoShown) {
          await pk.click('#orgchart-undo');
          await pk.waitForSelector('#orgchart-undo-go:not([hidden])', { timeout: 5000 }).catch(() => {});
          await pk.evaluate(() => { ORGCHART_CREATED_AT = Date.now() - 16 * 60 * 1000; });
          if (await pk.isVisible('#orgchart-undo-go')) await pk.click('#orgchart-undo-go');
        }
        const atRemove = await pk.evaluate(() => ({ created: ORGCHART_CREATED.length, asking: !document.getElementById('orgchart-undo-go').hidden,
          count: document.getElementById('orgchart-count').textContent, msg: document.getElementById('orgchart-msg').textContent }));
        check('#4688 EXPIRED AT REMOVE: Remove pressed past the window removes nothing and shows the result again, not the ask',
          pkDeletes === 0 && atRemove.created === 0 && !atRemove.asking && /Created 7 agents/.test(atRemove.count)
          && /Undo is no longer offered/.test(atRemove.msg), JSON.stringify([pkDeletes, atRemove]));
      } else check('CLOSE AFTER CREATE: the panel offers a file', false);
      await pk.close();
    }

    /* #4556: leaving the Team screen (Back) or closing the org chart panel while a picture is being read ends the
       read, so its model call stops too; reopening shows no consent box left armed. */
    for (const how of ['back', 'close']) {
      const pl2 = await page();
      let leftAborted = false;
      await pl2.route('**/api/orgchart/read*', async (r) => {
        const consent = new URL(r.request().url()).searchParams.get('consent') === '1';
        if (!consent) return r.fulfill({ status: 200, json: { needsConsent: true, provider: 'Anthropic (Claude)' } });
        await new Promise((ok) => setTimeout(ok, 3000));   // a read that takes a while
        await r.fulfill({ status: 200, json: { source: 'model', provider: 'Anthropic (Claude)', rows: PICTURE_ROWS, problems: [] } }).catch(() => {});
      });
      // An aborted fetch is reported by Playwright as a failed request (a fulfill after the abort does not throw).
      pl2.on('requestfailed', (q) => { if (/\/api\/orgchart\/read/.test(q.url()) && /consent=1/.test(q.url())) leftAborted = true; });
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

    // NO READER (no Claude and no key-connected provider)
    const p4 = await page();
    const { NO_MODEL } = require('../../engine/orgchartfile');   // the route's own sentence, not a copy
    await p4.route('**/api/orgchart/read*', (r) => r.fulfill({ status: 200, json: { unavailable: true, problems: [NO_MODEL] } }));
    await openPanel(p4);
    if (await p4.$('#orgchart-file-btn')) {
      await p4.setInputFiles('#orgchart-file', path.join(FIX, 'chart.pdf'));
      await p4.waitForTimeout(500);
      const u = await readPreview(p4);
      check('NO READER: leads with Claude, names ChatGPT for a picture, offers CSV, Excel or typing, never says API key; no consent box, no preview', (process.platform === 'win32' ? /Claude reads a picture or PDF, connected in Settings, AI Models\. OpenAI or Grok connected with a key/ : /Claude reads a picture or PDF, connected in Settings, AI Models\. ChatGPT also reads a PNG or JPG picture/).test(u.msg) && !/API key/i.test(u.msg) && !u.consent && !u.shown, JSON.stringify(u));
    } else check('NO READER: the panel offers a file', false);
    await p4.close();

    // KEY PROVIDER (#4560): with a key-connected provider instead of Claude, the consent names that provider and
    // account, and a kind it cannot read (Grok and a PDF) is said at once, with no consent box.
    const pk = await page();
    const okeys = require('../../engine/orgchartkeys');   // the engine's own sentences, not copies
    const grokPdf = okeys.cannotRead('xai', 'application/pdf');
    const grokKeeps = okeys.keeps({ provider: 'xai' });
    let sentReader = null;
    let changed = false;
    // The first consented read is held until the page's reading message has been read (#4560 continuation round 3:
    // nothing pinned that a key read says "up to two minutes", not Claude's "about ten seconds").
    let releaseFirst = () => {};
    const firstHeld = new Promise((res) => { releaseFirst = res; });
    let heldOnce = false;
    await pk.route('**/api/orgchart/read*', async (r) => {
      const u = new URL(r.request().url());
      const n = decodeURIComponent(r.request().headers()['x-orgchart-name'] || '');
      if (/\.pdf$/.test(n)) return r.fulfill({ status: 200, json: { unavailable: true, problems: [grokPdf] } });
      if (u.searchParams.get('consent') === '1') {
        sentReader = u.searchParams.get('reader');
        // The board's answer when the reader changed while the box was open: its sentence must reach the person.
        if (changed) return r.fulfill({ status: 409, json: { error: 'Who reads this file changed since you were asked. Choose the file again to see who reads it now.' } });
        if (!heldOnce) { heldOnce = true; await firstHeld; }
        return r.fulfill({ status: 200, json: { source: 'model', provider: 'xAI Grok (work)', rows: PICTURE_ROWS, problems: [] } });
      }
      return r.fulfill({ status: 200, json: { needsConsent: true, provider: 'xAI Grok (work)', reader: 'xai:0123456789ab', uses: 'billed to your xAI Grok key', keeps: grokKeeps } });
    });
    await openPanel(pk);
    if (await pk.$('#orgchart-file-btn')) {
      await pk.setInputFiles('#orgchart-file', path.join(FIX, 'chart.png'));
      await pk.waitForSelector('#orgchart-consent:not([hidden])', { timeout: 8000 }).catch(() => {});
      const k1 = await readPreview(pk);
      await pk.click('#orgchart-consent-go').catch(() => {});
      await pk.waitForFunction(() => /Reading your chart/.test(document.getElementById('orgchart-msg').textContent), null, { timeout: 5000 }).catch(() => {});
      // The page says "Reading your chart" as Read it is pressed, before its request reaches the stubbed route, so wait
      // (bounded) for the request to arrive and be held there; read the message only once the read is in flight.
      for (let i = 0; i < 50 && !heldOnce; i++) await pk.waitForTimeout(100);
      const reading = await pk.$eval('#orgchart-msg', (e) => (e.hidden || e.closest('[hidden]') ? '(hidden) ' : '') + e.textContent).catch(() => '');
      const heldReached = heldOnce;   // the consented read reached the route and is waiting there
      releaseFirst();
      await pk.waitForSelector('#orgchart-preview-box:not([hidden])', { timeout: 8000 }).catch(() => {});
      await pk.setInputFiles('#orgchart-file', path.join(FIX, 'chart.pdf'));
      await pk.waitForTimeout(500);
      const k2 = await readPreview(pk);
      check('KEY PROVIDER: the consent names the key provider and account, says which key it is billed to, and says what the provider keeps',
        /xAI Grok \(work\), billed to your xAI Grok key\./.test(k1.consent) && k1.consent.includes(grokKeeps), JSON.stringify(k1.consent));
      check('KEY PROVIDER: Read it sends back the reader the consent named (the board refuses any other)', sentReader === 'xai:0123456789ab', JSON.stringify(sentReader));
      check('KEY PROVIDER: while a key provider reads, the page shows that it can take up to two minutes, not Claude\'s ten seconds', heldReached && /^Reading your chart/.test(reading) && /up to two minutes/.test(reading) && !/ten seconds/.test(reading), JSON.stringify([heldReached, reading]));
      // The board's refusal itself (Grok and a PDF, before any consent) is guarded in server.orgchart-read-4559.test.js;
      // this route is stubbed, so the page can only show the board's sentence (round 5: a 'no consent box' half could not fail).
      check('KEY PROVIDER: the page shows the board\'s sentence for a kind the key provider cannot read (Grok and a PDF)', k2.msg.includes(grokPdf), JSON.stringify(k2.msg));
      changed = true;
      await pk.setInputFiles('#orgchart-file', path.join(FIX, 'chart.png'));
      await pk.waitForSelector('#orgchart-consent:not([hidden])', { timeout: 8000 }).catch(() => {});
      await pk.click('#orgchart-consent-go').catch(() => {});
      await pk.waitForFunction(() => /Who reads this file changed/.test(document.getElementById('orgchart-msg').textContent), null, { timeout: 5000 }).catch(() => {});
      const k3 = await readPreview(pk);
      check('KEY PROVIDER: a 409 (the reader changed while the box was open) tells the person to choose the file again', /Who reads this file changed since you were asked\. Choose the file again/.test(k3.msg), JSON.stringify(k3.msg));
    } else check('KEY PROVIDER: the panel offers a file', false);
    await pk.close();

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
      /* #4688: the team made after they left comes back with the panel, with its Undo, not a blank panel and 4
         agents to remove one by one. FOUR: this arm's read is mocked with PICTURE_ROWS (4 people), not the CSV's 7. */
      await plc.click('#cstep-kind [data-path="team"]');
      await plc.waitForSelector('#team-orgchart-open', { state: 'visible', timeout: 8000 });
      await plc.click('#team-orgchart-open');
      await plc.waitForSelector('#orgchartpick', { state: 'visible', timeout: 8000 });
      // The held create has answered and recorded (the 2.5 s above is a margin, this is the order).
      await plc.waitForFunction(() => ORGCHART_CREATING === false && ORGCHART_CREATED.length > 0, null, { timeout: 8000 }).catch(() => {});
      const back = await plc.evaluate(() => ({ created: ORGCHART_CREATED.length, box: !document.getElementById('orgchart-preview-box').hidden,
        undo: !document.getElementById('orgchart-undo').hidden ? document.getElementById('orgchart-undo').textContent : null,
        count: document.getElementById('orgchart-count').textContent, create: document.getElementById('orgchart-create').disabled }));
      check('#4688 LEAVE DURING CREATE, REOPENED: the team made after the person left comes back with its result and Undo',
        back.created === 4 && back.box && /remove these 4 agents/.test(back.undo || '') && /Created 4 agents/.test(back.count) && back.create, JSON.stringify(back));
      // CONTROL: a new batch still replaces it (a fresh Preview), so the kept Undo is not sticky forever.
      await plc.fill('#orgchart-text', 'Chief Executive Officer');
      await plc.click('#orgchart-preview');
      const fresh = await plc.evaluate(() => ({ created: ORGCHART_CREATED.length, undo: !document.getElementById('orgchart-undo').hidden }));
      check('#4688 CONTROL: a fresh Preview after the reopen is a new batch and drops the old Undo', fresh.created === 0 && !fresh.undo, JSON.stringify(fresh));
    } else check('LEAVE DURING CREATE: the panel offers a file', false);
    await plc.close();

    /* #4688: the person leaves while the team is being made and is BACK in the panel before the answer lands. The
       late answer shows its result and Undo in the idle panel, rather than recording it for a reopen that already
       happened. The create is held until released, so the order is certain. */
    const prb = await page();
    await prb.route('**/api/agent/*/profile', (r) => r.fulfill({ status: 200, json: { ok: true } }));   // #4688: the fix-ups stay off the sandbox board
    let releaseTeam;
    const teamHeld = new Promise((ok) => { releaseTeam = ok; });
    await prb.route('**/api/team', async (r) => {
      const body = JSON.parse(r.request().postData() || '{}');
      await teamHeld;
      r.fulfill({ status: 200, json: { outcome: 'created', created: body.members.map((m) => ({ name: m.name, shownAs: m.label })), refused: [] } });
    });
    await openPanel(prb);
    if (await prb.$('#orgchart-file-btn')) {
      await prb.setInputFiles('#orgchart-file', path.join(FIX, 'people.csv'));
      await prb.waitForSelector('#orgchart-preview-box:not([hidden])', { timeout: 8000 });
      await prb.click('#orgchart-create');
      await prb.waitForFunction(() => ORGCHART_CREATING === true, null, { timeout: 5000 });   // the held create is in flight
      await prb.click('#create-path-back');
      await prb.click('#cstep-kind [data-path="team"]');
      await prb.waitForSelector('#team-orgchart-open', { state: 'visible', timeout: 8000 });
      await prb.click('#team-orgchart-open');
      await prb.waitForSelector('#orgchartpick', { state: 'visible', timeout: 8000 });
      const before = await prb.evaluate(() => ({ box: !document.getElementById('orgchart-preview-box').hidden, undo: !document.getElementById('orgchart-undo').hidden,
        msg: document.getElementById('orgchart-msg').hidden ? '' : document.getElementById('orgchart-msg').textContent }));
      releaseTeam();
      await prb.waitForFunction(() => !document.getElementById('orgchart-undo').hidden, null, { timeout: 5000 }).catch(() => {});
      const after = await prb.evaluate(() => ({ created: ORGCHART_CREATED.length, undo: !document.getElementById('orgchart-undo').hidden ? document.getElementById('orgchart-undo').textContent : null,
        count: document.getElementById('orgchart-count').textContent }));
      check('#4688 REOPEN BEFORE THE ANSWER: the panel is idle while it waits, then the late create shows its result and Undo',
        !before.box && !before.undo && /Your team is still being created/.test(before.msg) && after.created === 7 && /remove these 7 agents/.test(after.undo || '') && /Created 7 agents/.test(after.count), JSON.stringify([before, after]));
    } else check('#4688 REOPEN BEFORE THE ANSWER: the panel offers a file', false);
    await prb.close();

    /* #4688 review: an Undo the person leaves mid-run. The first 3 removals answer at once, the 4th is held while
       they press Back and lands after; on reopen the kept Undo must offer the 3 still on the board, not all 7. */
    const pud = await page();
    await pud.route('**/api/agent/*/profile', (r) => r.fulfill({ status: 200, json: { ok: true } }));   // #4688: the fix-ups stay off the sandbox board
    let deletes = 0;
    let releaseDel;
    const delHeld = new Promise((ok) => { releaseDel = ok; });
    await pud.route('**/api/team', (r) => {
      const body = JSON.parse(r.request().postData() || '{}');
      r.fulfill({ status: 200, json: { outcome: 'created', created: body.members.map((m) => ({ name: m.name, shownAs: m.label })), refused: [] } });
    });
    await pud.route('**/api/agent/*/removal', async (r) => {
      const name = decodeURIComponent(new URL(r.request().url()).pathname.split('/')[3]);
      if (r.request().method() === 'GET') return r.fulfill({ status: 200, json: { ok: true, name, label: name, loses: ['Its place on the board'], keeps: ['Its folder'] } });
      deletes += 1;
      if (deletes === 4) await delHeld;
      r.fulfill({ status: 200, json: { outcome: 'removed', because: name + ' has been removed.' } });
    });
    await pud.route('**/api/removed', (r) => r.fulfill({ status: 200, json: { agents: [] } }));
    await openPanel(pud);
    if (await pud.$('#orgchart-file-btn')) {
      await pud.setInputFiles('#orgchart-file', path.join(FIX, 'people.csv'));
      await pud.waitForSelector('#orgchart-preview-box:not([hidden])', { timeout: 8000 });
      await pud.click('#orgchart-create');
      await pud.waitForFunction(() => /Created 7 agents/.test(document.getElementById('orgchart-count').textContent), null, { timeout: 8000 });
      await pud.click('#orgchart-undo');
      await pud.waitForSelector('#orgchart-undo-go:not([hidden])', { timeout: 5000 });
      await pud.click('#orgchart-undo-go');
      for (let i = 0; i < 50 && deletes < 4; i++) await pud.waitForTimeout(100);   // the 4th removal is now held
      await pud.click('#create-path-back');
      releaseDel();
      await pud.waitForFunction(() => ORGCHART_CREATED.length === 3, null, { timeout: 5000 }).catch(() => {});   // the held answer lands after the person left
      await pud.click('#cstep-kind [data-path="team"]');
      await pud.waitForSelector('#team-orgchart-open', { state: 'visible', timeout: 8000 });
      await pud.click('#team-orgchart-open');
      await pud.waitForSelector('#orgchartpick', { state: 'visible', timeout: 8000 });
      const ud = await pud.evaluate(() => ({ created: ORGCHART_CREATED.length, undo: !document.getElementById('orgchart-undo').hidden ? document.getElementById('orgchart-undo').textContent : null,
        count: document.getElementById('orgchart-count').textContent }));
      check('#4688 UNDO LEFT MID-RUN, REOPENED: the kept Undo offers only the agents still on the board',
        deletes === 4 && ud.created === 3 && /remove these 3 agents/.test(ud.undo || '') && /Removed 4 of 7 before you left/.test(ud.count), JSON.stringify([deletes, ud]));
    } else check('#4688 UNDO LEFT MID-RUN: the panel offers a file', false);
    await pud.close();

    /* #4688 review: the same, but the person is BACK in the panel before the held removal answers. The reopen shows
       the kept list as it stood (7); the late answer must repaint it to the 3 still on the board. */
    const pur = await page();
    await pur.route('**/api/agent/*/profile', (r) => r.fulfill({ status: 200, json: { ok: true } }));   // #4688: the fix-ups stay off the sandbox board
    let deletesR = 0;
    let releaseDelR;
    const delHeldR = new Promise((ok) => { releaseDelR = ok; });
    await pur.route('**/api/team', (r) => {
      const body = JSON.parse(r.request().postData() || '{}');
      r.fulfill({ status: 200, json: { outcome: 'created', created: body.members.map((m) => ({ name: m.name, shownAs: m.label })), refused: [] } });
    });
    await pur.route('**/api/agent/*/removal', async (r) => {
      const name = decodeURIComponent(new URL(r.request().url()).pathname.split('/')[3]);
      if (r.request().method() === 'GET') return r.fulfill({ status: 200, json: { ok: true, name, label: name, loses: ['Its place on the board'], keeps: ['Its folder'] } });
      deletesR += 1;
      if (deletesR === 4) await delHeldR;
      r.fulfill({ status: 200, json: { outcome: 'removed', because: name + ' has been removed.' } });
    });
    await pur.route('**/api/removed', (r) => r.fulfill({ status: 200, json: { agents: [] } }));
    await openPanel(pur);
    if (await pur.$('#orgchart-file-btn')) {
      await pur.setInputFiles('#orgchart-file', path.join(FIX, 'people.csv'));
      await pur.waitForSelector('#orgchart-preview-box:not([hidden])', { timeout: 8000 });
      await pur.click('#orgchart-create');
      await pur.waitForFunction(() => /Created 7 agents/.test(document.getElementById('orgchart-count').textContent), null, { timeout: 8000 });
      await pur.click('#orgchart-undo');
      await pur.waitForSelector('#orgchart-undo-go:not([hidden])', { timeout: 5000 });
      await pur.click('#orgchart-undo-go');
      for (let i = 0; i < 50 && deletesR < 4; i++) await pur.waitForTimeout(100);   // the 4th removal is now held
      await pur.click('#create-path-back');
      await pur.click('#cstep-kind [data-path="team"]');
      await pur.waitForSelector('#team-orgchart-open', { state: 'visible', timeout: 8000 });
      await pur.click('#team-orgchart-open');
      await pur.waitForSelector('#orgchartpick', { state: 'visible', timeout: 8000 });
      const readUd = () => pur.evaluate(() => ({ created: ORGCHART_CREATED.length, undo: !document.getElementById('orgchart-undo').hidden ? document.getElementById('orgchart-undo').textContent : null,
        count: document.getElementById('orgchart-count').textContent }));
      const beforeR = await readUd();
      releaseDelR();
      await pur.waitForFunction(() => /remove these 3 agents/.test(document.getElementById('orgchart-undo').textContent), null, { timeout: 5000 }).catch(() => {});
      const afterR = await readUd();
      check('#4688 UNDO LEFT MID-RUN, BACK BEFORE THE ANSWER: the open panel is repainted to the agents still on the board',
        deletesR === 4 && /remove these 7 agents/.test(beforeR.undo || '') && afterR.created === 3 && /remove these 3 agents/.test(afterR.undo || '')
        && /Removed 4 of 7 before you left/.test(afterR.count), JSON.stringify([deletesR, beforeR, afterR]));
    } else check('#4688 UNDO LEFT MID-RUN, BACK BEFORE THE ANSWER: the panel offers a file', false);
    await pur.close();

    /* #4688 review: back in the panel, the person presses Undo again before the old run's held removal answers. The
       answer takes the removed agents off the kept list and ends the open ask, showing what is still on the board
       with an Undo that asks afresh. Run twice: the held answer is the 4th of 7 (3 left) and the 7th (none left). */
    const undoAgain = async (heldAt) => {
      const pua = await page();
      await pua.route('**/api/agent/*/profile', (r) => r.fulfill({ status: 200, json: { ok: true } }));   // #4688: the fix-ups stay off the sandbox board
      let deletesA = 0;
      let releaseDelA;
      const delHeldA = new Promise((ok) => { releaseDelA = ok; });
      await pua.route('**/api/team', (r) => {
        const body = JSON.parse(r.request().postData() || '{}');
        r.fulfill({ status: 200, json: { outcome: 'created', created: body.members.map((m) => ({ name: m.name, shownAs: m.label })), refused: [] } });
      });
      await pua.route('**/api/agent/*/removal', async (r) => {
        const name = decodeURIComponent(new URL(r.request().url()).pathname.split('/')[3]);
        if (r.request().method() === 'GET') return r.fulfill({ status: 200, json: { ok: true, name, label: name, loses: ['Its place on the board'], keeps: ['Its folder'] } });
        deletesA += 1;
        if (deletesA === heldAt) await delHeldA;
        r.fulfill({ status: 200, json: { outcome: 'removed', because: name + ' has been removed.' } });
      });
      await pua.route('**/api/removed', (r) => r.fulfill({ status: 200, json: { agents: [] } }));
      await openPanel(pua);
      let out = null;
      if (await pua.$('#orgchart-file-btn')) {
        await pua.setInputFiles('#orgchart-file', path.join(FIX, 'people.csv'));
        await pua.waitForSelector('#orgchart-preview-box:not([hidden])', { timeout: 8000 });
        await pua.click('#orgchart-create');
        await pua.waitForFunction(() => /Created 7 agents/.test(document.getElementById('orgchart-count').textContent), null, { timeout: 8000 });
        await pua.click('#orgchart-undo');
        await pua.waitForSelector('#orgchart-undo-go:not([hidden])', { timeout: 5000 });
        await pua.click('#orgchart-undo-go');
        for (let i = 0; i < 50 && deletesA < heldAt; i++) await pua.waitForTimeout(100);   // the held removal is in flight
        await pua.click('#create-path-back');
        await pua.click('#cstep-kind [data-path="team"]');
        await pua.waitForSelector('#team-orgchart-open', { state: 'visible', timeout: 8000 });
        await pua.click('#team-orgchart-open');
        await pua.waitForSelector('#orgchartpick', { state: 'visible', timeout: 8000 });
        // Guarded, as above: no Undo after the reopen is a FAIL line, not a thrown click.
        if (await pua.isVisible('#orgchart-undo')) {
          await pua.click('#orgchart-undo');
          await pua.waitForSelector('#orgchart-undo-go:not([hidden])', { timeout: 5000 }).catch(() => {});
        }
        const asking = await pua.evaluate(() => document.getElementById('orgchart-undo-go').textContent);
        releaseDelA();
        // A swallowed timeout still fails: the check asserts the same state.
        await pua.waitForFunction(() => document.getElementById('orgchart-undo-go').hidden, null, { timeout: 5000 }).catch(() => {});
        out = await pua.evaluate(() => ({ created: ORGCHART_CREATED.length, asking: !document.getElementById('orgchart-undo-go').hidden,
          undo: !document.getElementById('orgchart-undo').hidden ? document.getElementById('orgchart-undo').textContent : null,
          back: !document.getElementById('orgchart-edit').hidden, preview: !document.getElementById('orgchart-preview').disabled,
          count: document.getElementById('orgchart-count').textContent, msg: document.getElementById('orgchart-msg').textContent }));
        out.firstAsk = asking;
        out.deletes = deletesA;
      }
      await pua.close();
      return out;
    };
    const ua3 = await undoAgain(4);
    check('#4688 UNDO AGAIN BEFORE THE OLD ANSWER (3 left): the open ask ends and the panel offers the 3 still on the board',
      !!ua3 && ua3.deletes === 4 && /Remove these 7 agents/.test(ua3.firstAsk) && !ua3.asking && ua3.created === 3 && /remove these 3 agents/.test(ua3.undo || '')
      && /Removed 4 of 7 before you left/.test(ua3.count) && /The Undo you left removed some of these first\. Press Undo again/.test(ua3.msg) && ua3.back && ua3.preview, JSON.stringify(ua3));
    const ua0 = await undoAgain(7);
    check('#4688 UNDO AGAIN BEFORE THE OLD ANSWER (none left): the open ask ends with nothing left to offer, and the panel is usable',
      !!ua0 && ua0.deletes === 7 && !ua0.asking && ua0.created === 0 && ua0.undo === null && /Removed 7 agents\./.test(ua0.count)
      && /The Undo you left removed all of these first\.$/.test(ua0.msg) && ua0.back && ua0.preview, JSON.stringify(ua0));

    /* #4688 review: a late create that made NOTHING (every row refused) replaces nothing: the reopened, idle panel stays
       empty rather than showing a result with no Undo. */
    const pnz = await page();
    await pnz.route('**/api/agent/*/profile', (r) => r.fulfill({ status: 200, json: { ok: true } }));   // #4688: the fix-ups stay off the sandbox board
    let releaseNone;
    const noneHeld = new Promise((ok) => { releaseNone = ok; });
    await pnz.route('**/api/team', async (r) => {
      const body = JSON.parse(r.request().postData() || '{}');
      await noneHeld;
      r.fulfill({ status: 200, json: { outcome: 'created', created: [], refused: body.members.map((m) => ({ name: m.name, because: 'taken' })) } });
    });
    await openPanel(pnz);
    if (await pnz.$('#orgchart-file-btn')) {
      await pnz.setInputFiles('#orgchart-file', path.join(FIX, 'people.csv'));
      await pnz.waitForSelector('#orgchart-preview-box:not([hidden])', { timeout: 8000 });
      await pnz.click('#orgchart-create');
      await pnz.waitForFunction(() => ORGCHART_CREATING === true, null, { timeout: 5000 });
      await pnz.click('#create-path-back');
      await pnz.click('#cstep-kind [data-path="team"]');
      await pnz.waitForSelector('#team-orgchart-open', { state: 'visible', timeout: 8000 });
      await pnz.click('#team-orgchart-open');
      await pnz.waitForSelector('#orgchartpick', { state: 'visible', timeout: 8000 });
      releaseNone();
      await pnz.waitForFunction(() => ORGCHART_CREATING === false, null, { timeout: 5000 }).catch(() => {});
      await pnz.waitForTimeout(300);   // an ABSENCE check: let anything the answer would paint land first
      const nz = await pnz.evaluate(() => ({ creating: ORGCHART_CREATING, created: ORGCHART_CREATED.length,
        box: !document.getElementById('orgchart-preview-box').hidden, undo: !document.getElementById('orgchart-undo').hidden,
        msg: document.getElementById('orgchart-msg').hidden ? '' : document.getElementById('orgchart-msg').textContent }));
      check('#4688 LATE CREATE THAT MADE NOTHING: the reopened panel shows no result and no Undo, and says nothing was created',
        !nz.creating && nz.created === 0 && !nz.box && !nz.undo && /No agents were created/.test(nz.msg) && !/still being created/.test(nz.msg), JSON.stringify(nz));
    } else check('#4688 LATE CREATE THAT MADE NOTHING: the panel offers a file', false);
    await pnz.close();

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
