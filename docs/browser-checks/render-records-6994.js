'use strict';
// Browser-check-surface: pj-records pj-records-h pj-records-rows pj-rec pj-rec-age pj-rec-stale pjLoadRecords
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
      const trs = [...document.querySelectorAll('#pj-records-rows tr')];
      return {
        hidden: box.hidden,
        heading: document.getElementById('pj-records-h').textContent,
        cells: trs.map((tr) => [...tr.children].map((td) => td.textContent)),
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
      ok(`${t} the heading names the rows, the count and the stale count`, r.heading === 'Accounts (3, 1 stale)', JSON.stringify(r.heading));
      ok(`${t} one table row per record`, r.cells.length === 3, JSON.stringify(r.cells));
      ok(`${t} a row reads name, status, confirmed date with its age and writer, source`,
        JSON.stringify(r.cells[0]) === JSON.stringify(['Acme', 'active', '2026-10-23today, by mara', 'https://crm.example/acme']), JSON.stringify(r.cells[0]));
      ok(`${t} a stale row is marked, in words`, r.stale[1] === true && r.marks[1] === 'stale', JSON.stringify([r.stale, r.marks]));
      ok(`${t} CONTROL: a fresh row carries no stale mark`, r.stale[0] === false && r.marks[0] === null, JSON.stringify([r.stale, r.marks]));
      ok(`${t} a row the person wrote says so`, /by you/.test(r.cells[1][2]), JSON.stringify(r.cells[1]));
      ok(`${t} an http source is a link; a file path is text`, r.links[0] === 'https://crm.example/acme' && r.links[1] === null, JSON.stringify(r.links));
      ok(`${t} a javascript: source is never a link`, r.links[2] === null, JSON.stringify(r.links));
      ok(`${t} a name that looks like markup arrives as text`, r.imgs === 0 && !r.xss && r.cells[2][0].startsWith('<img'), JSON.stringify(r.cells[2]));
    }
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
