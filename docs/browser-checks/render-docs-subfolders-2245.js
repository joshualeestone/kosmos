'use strict';
// Browser-check-surface: pj-docs pj-docs-msg pj-doc pj-doc-n refgo
/* #2245: "Files in this project" lists files in SUBFOLDERS by their relative path, says so
 * when the bounded walk was cut short, and a citation of a subfolder file chips to THAT file.
 * Measured in the real page against the SHIPPED functions (pjLoadDocs, pjLinkPaths), with
 * /api/project/<id>/documents stubbed, so no board is needed.
 *
 * Run: NODE_PATH=$HOME/work/pw-runtime/node_modules node docs/browser-checks/render-docs-subfolders-2245.js
 *      (HEADED=0 on a machine with no console session)
 *
 * Dangerous-answer controls: the same page with truncated absent must show NO partial-list
 * note, and a bare name must still chip to the top-level file, so neither passing assertion
 * can be the renderer doing one thing regardless of input.
 */
const path = require('node:path');
const { chromium } = require('playwright');

const PAGE = 'file://' + path.join(path.resolve(__dirname, '..', '..'), 'web', 'index.html');
const PARTIAL = 'stopped looking partway';

const problems = [];
let pass = 0;
function ok(name, cond, detail) {
  if (cond) { pass += 1; } else { problems.push(name + (detail ? ' -- ' + detail : '')); }
}

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  for (const truncated of [true, false]) {
    const t = truncated ? '[truncated]' : '[complete]';
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    page.on('pageerror', (e) => problems.push(`${t} pageerror: ${e.message}`));
    await page.addInitScript((trunc) => {
      const enc = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
      window.setInterval = () => 0; // refuse the app's tick
      const files = [
        { name: 'weather-forecast-test/forecast.pdf', size: 2048, modified: '2026-09-24T10:00:00.000Z' },
        { name: 'report.pdf', size: 1024, modified: '2026-09-24T09:00:00.000Z' },
        { name: 'sub/report.pdf', size: 512, modified: '2026-09-24T08:00:00.000Z' },
      ];
      const body = { ok: true, total: 3, files, names: files.map((f) => f.name), stamp: 'x' };
      if (trunc) body.truncated = true;
      window.fetch = async (url) => {
        const u = String(url);
        if (u.includes('/documents')) return enc(body);
        if (u.includes('/api/status')) return enc({ agents: [], version: '0.2.0' });
        return enc({});
      };
    }, truncated);
    await page.goto(PAGE);

    const r = await page.evaluate(async () => {
      PJ_CURRENT = 'p1';
      await pjLoadDocs('p1');
      const rows = [...document.querySelectorAll('#pj-docs .pj-doc')];
      const names = new Set(['report.pdf', 'sub/report.pdf', 'weather-forecast-test/forecast.pdf']);
      return {
        rowText: rows.map((b) => (b.querySelector('.pj-doc-n') || {}).textContent),
        rowRefs: rows.map((b) => b.dataset.doc),
        note: document.getElementById('pj-docs-msg').textContent,
        chipSub: pjLinkPaths('saved it at sub/report.pdf', names),
        chipAbs: pjLinkPaths('see /Users/a/Kosmos/Projects/P/weather-forecast-test/forecast.pdf', names),
        chipBare: pjLinkPaths('see report.pdf', names),
      };
    });

    ok(`${t} a subfolder file is listed by its relative path`, r.rowText.includes('weather-forecast-test/forecast.pdf'), JSON.stringify(r.rowText));
    ok(`${t} the row opens by that relative path`, r.rowRefs.includes('weather-forecast-test/forecast.pdf'), JSON.stringify(r.rowRefs));
    ok(`${t} two files named report.pdf stay distinct rows`, r.rowRefs.includes('report.pdf') && r.rowRefs.includes('sub/report.pdf'), JSON.stringify(r.rowRefs));
    if (truncated) ok(`${t} a cut-short list says so`, r.note.includes(PARTIAL), JSON.stringify(r.note));
    else ok(`${t} CONTROL: a complete list shows no partial note`, !r.note.includes(PARTIAL), JSON.stringify(r.note));
    ok(`${t} a cited subfolder file chips to itself, not the top-level twin`, /data-ref="sub\/report\.pdf"/.test(r.chipSub), r.chipSub);
    ok(`${t} an absolute cite finds the subfolder file`, /data-ref="weather-forecast-test\/forecast\.pdf"/.test(r.chipAbs), r.chipAbs);
    ok(`${t} CONTROL: a bare name still chips to the top-level file`, /data-ref="report\.pdf"/.test(r.chipBare), r.chipBare);
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
