'use strict';
// Browser-check-surface: pj-records pj-records-h pj-records-note pj-records-rows pj-rec pj-rec-row pj-rec-name pj-rec-status pj-rec-age pj-rec-src pj-rec-stale pjLoadRecords
/* #6994: a project's records, under the Files list. Measured in the real page against the SHIPPED function
 * (pjLoadRecords), with /api/project/<id>/records stubbed, so no board is needed.
 *
 * Run: NODE_PATH=$HOME/work/pw-runtime/node_modules node docs/browser-checks/render-records-6994.js
 *      (HEADED=0 on a machine with no console session)
 *
 * Dangerous-answer controls: the same page with no rows must keep the table HIDDEN, and a fresh row must carry no
 * stale mark, so neither passing assertion can be the renderer doing one thing regardless of input. A name that
 * looks like markup must arrive as text.
 */
const path = require('node:path');
const { chromium } = require('playwright');

const PAGE = 'file://' + path.join(path.resolve(__dirname, '..', '..'), 'web', 'index.html');

const problems = [];
let pass = 0;
function ok(name, cond, detail) {
  if (cond) { pass += 1; } else { problems.push(name + (detail ? ' -- ' + detail : '')); }
}

const ROWS = [
  { name: 'Acme', status: 'active', confirmed: '2026-10-23', source: 'https://crm.example/acme', by: 'mara', byPerson: false, ageDays: 0, stale: false },
  { name: 'Globex', status: 'lead', confirmed: '2026-09-01', source: 'notes/globex.md', by: null, byPerson: true, ageDays: 52, stale: true },
  { name: '<img src=x onerror="window.__xss=1">', status: '', confirmed: '2026-10-22', source: 'javascript:alert(1)', by: 'ana', byPerson: false, ageDays: 1, stale: false },
];

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  for (const empty of [false, true]) {
    const t = empty ? '[no rows]' : '[rows]';
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    page.on('pageerror', (e) => problems.push(`${t} pageerror: ${e.message}`));
    await page.addInitScript(({ rows }) => {
      const enc = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
      window.setInterval = () => 0; // refuse the app's tick
      const body = { label: 'accounts', staleDays: 30, rows, stale: rows.filter((r) => r.stale).length };
      window.fetch = async (url) => {
        const u = String(url);
        if (u.includes('/records')) return enc(body);
        if (u.includes('/api/status')) return enc({ agents: [], version: '0.2.0' });
        return enc({});
      };
    }, { rows: empty ? [] : ROWS });
    await page.goto(PAGE);

    const r = await page.evaluate(async () => {
      PJ_CURRENT = 'p1';
      await pjLoadRecords('p1');
      const box = document.getElementById('pj-records');
      const trs = [...document.querySelectorAll('#pj-records-rows li')];
      return {
        hidden: box.hidden,
        heading: document.getElementById('pj-records-h').textContent,
        cells: trs.map((li) => ['.pj-rec-name', '.pj-rec-status', '.pj-rec-age', '.pj-rec-src'].map((s) => (li.querySelector(s) || {}).textContent || '')),
        stale: trs.map((tr) => tr.classList.contains('stale')),
        marks: trs.map((tr) => (tr.querySelector('.pj-rec-stale') || {}).textContent || null),
        links: trs.map((tr) => { const a = tr.querySelector('a'); return a ? a.getAttribute('href') : null; }),
        imgs: document.querySelectorAll('#pj-records-rows img').length,
        xss: window.__xss === 1,
      };
    });

    if (empty) {
      ok(`${t} CONTROL: a project with no records shows no table`, r.hidden === true, JSON.stringify(r));
    } else {
      ok(`${t} the records are shown`, r.hidden === false);
      ok(`${t} the heading names the rows (CSS raises its first letter), the count and the stale count`, r.heading === 'accounts (3, 1 stale)', JSON.stringify(r.heading));
      ok(`${t} one list item per record`, r.cells.length === 3, JSON.stringify(r.cells));
      ok(`${t} a row reads name, status, the confirmed line with its age and writer, source`,
        JSON.stringify(r.cells[0]) === JSON.stringify(['Acme', 'active', 'Confirmed today, by mara', 'https://crm.example/acme']), JSON.stringify(r.cells[0]));
      ok(`${t} a stale row is marked, in words`, r.stale[1] === true && r.marks[1] === 'stale', JSON.stringify([r.stale, r.marks]));
      ok(`${t} CONTROL: a fresh row carries no stale mark`, r.stale[0] === false && r.marks[0] === null, JSON.stringify([r.stale, r.marks]));
      ok(`${t} a row the person wrote says so`, /by you/.test(r.cells[1][2]), JSON.stringify(r.cells[1]));
      ok(`${t} an http source is a link; a file path is text`, r.links[0] === 'https://crm.example/acme' && r.links[1] === null, JSON.stringify(r.links));
      ok(`${t} a javascript: source is never a link`, r.links[2] === null, JSON.stringify(r.links));
      ok(`${t} a name that looks like markup arrives as text`, r.imgs === 0 && !r.xss && r.cells[2][0].startsWith('<img'), JSON.stringify(r.cells[2]));
    }
    await page.close();
  }

  /* The guards, with a fetch whose answers the check gives one at a time and in any order: an answer that arrives
     after the person opened another project paints nothing; an older read that lands after a newer one is dropped; a
     failed read keeps the table; an empty answer hides it; an unchanged answer does not redraw it. */
  {
    const t = '[guards]';
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    page.on('pageerror', (e) => problems.push(`${t} pageerror: ${e.message}`));
    await page.addInitScript(() => {
      const enc = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
      window.setInterval = () => 0;
      window.__pending = [];
      window.fetch = (url) => {
        const u = String(url);
        if (u.includes('/records')) return new Promise((res, rej) => window.__pending.push({ res, rej }));
        if (u.includes('/api/status')) return Promise.resolve(enc({ agents: [], version: '0.2.0' }));
        return Promise.resolve(enc({}));
      };
      const one = (name, stale) => ({ name, status: '', confirmed: '2026-10-23', source: '', by: null, byPerson: false, ageDays: stale ? 40 : 0, stale });
      window.__body = (names) => ({ label: 'records', staleDays: 30, rows: names.map((n) => one(n, false)), stale: 0 });
      window.__answer = (i, body) => {
        const p = window.__pending[i];
        if (body === null) p.rej(new Error('offline'));
        else p.res(enc(body));
      };
      window.__names = () => [...document.querySelectorAll('#pj-records-rows li')].map((li) => li.querySelector('.pj-rec-name').textContent);
    });
    await page.goto(PAGE);
    const g = await page.evaluate(async () => {
      const out = {};
      const tick = () => new Promise((r) => setTimeout(r, 30));
      // A switch while the read is out: the answer is p1's, the page is p2's.
      PJ_CURRENT = 'p1';
      const a = pjLoadRecords('p1');
      PJ_CURRENT = 'p2';
      window.__answer(0, window.__body(['From p1']));
      await a;
      out.switchHidden = document.getElementById('pj-records').hidden;
      // Two reads of one project out at once: the newer answers first, the older lands last.
      PJ_CURRENT = 'p1';
      const older = pjLoadRecords('p1');
      const newer = pjLoadRecords('p1');
      window.__answer(2, window.__body(['Newer']));
      await newer;
      window.__answer(1, window.__body(['Older']));
      await older;
      out.afterOrder = window.__names();
      // An unchanged answer leaves the very same rows in place (no redraw); a failed read keeps them.
      const row = document.querySelector('#pj-records-rows li');
      const same = pjLoadRecords('p1');
      window.__answer(3, window.__body(['Newer']));
      await same;
      out.sameNode = document.querySelector('#pj-records-rows li') === row;
      const failed = pjLoadRecords('p1');
      window.__answer(4, null);
      await failed; await tick();
      out.afterFail = [document.getElementById('pj-records').hidden, window.__names()];
      // An empty answer hides the table.
      const empty = pjLoadRecords('p1');
      window.__answer(5, window.__body([]));
      await empty;
      out.emptyHidden = document.getElementById('pj-records').hidden;
      return out;
    });
    ok(`${t} an answer that arrives after a project switch paints nothing`, g.switchHidden === true, JSON.stringify(g));
    ok(`${t} an older read that lands after a newer one is dropped`, JSON.stringify(g.afterOrder) === '["Newer"]', JSON.stringify(g.afterOrder));
    ok(`${t} an unchanged answer does not redraw the rows`, g.sameNode === true);
    ok(`${t} a failed read keeps the table as it was`, JSON.stringify(g.afterFail) === '[false,["Newer"]]', JSON.stringify(g.afterFail));
    ok(`${t} CONTROL: an empty answer does hide it`, g.emptyHidden === true);
    await page.close();
  }
  await browser.close();
  if (problems.length) {
    console.log('problems:\n  ' + problems.join('\n  '));
    console.log('\n' + pass + ' passed, ' + problems.length + ' FAILED');
    process.exit(1);
  }
  console.log(pass + ' passed, problems: none');
})().catch((e) => { console.error(e); process.exit(1); });
