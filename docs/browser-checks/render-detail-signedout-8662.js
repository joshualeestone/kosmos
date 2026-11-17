// Browser-check-surface: d-signedout d-sec-model panel-detail
/**
 * kosmos#8662 (feedback 11-17): a tab is signed out when Kosmos restarts or updates. An agent page that was open then
 * kept its last reading and its Model controls with nothing saying why a model switch went nowhere (the board's grid
 * says "not signed in", #2023, but the agent page never did). Now, on the agent page, in both looks:
 *   - before the sign-out (control): no signed-out note, the Model section is not inert;
 *   - once every read is refused (403, the board's own body): the note shows and the Model section is inert;
 *   - once reads succeed again (signed back in): the note is gone and the Model section is live again.
 * Reads are intercepted (as render-board-signin-403-2023.js does), so no enforcing board or token is needed.
 *
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 \
 *     node docs/browser-checks/render-detail-signedout-8662.js http://127.0.0.1:PORT
 * against a sandboxed board with first-run completed and at least one agent (the driver's fleet fixture).
 */
'use strict';

const playwright = require('playwright');

const BASE = process.argv[2] || 'http://127.0.0.1:4399';
const HEADED = process.env.HEADED !== '0';
const AUTH_403 = { error: 'this board belongs to the account that started it; open it with `kosmos open`' };

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
}

const state = (page) => page.evaluate(() => {
  const note = document.getElementById('d-signedout');
  const model = document.getElementById('d-sec-model');
  return { note: !!note && !note.hidden && note.offsetParent !== null, text: note ? note.textContent : '', inert: !!model && model.inert === true };
});

(async () => {
  const browser = await playwright.chromium.launch({ headless: !HEADED });
  const errors = [];
  try {
    for (const look of ['old', 'new']) {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(look + ': ' + String(e && e.message || e)));
      if (look === 'new') await page.addInitScript(() => { try { localStorage.setItem('kosmos-look', 'new'); } catch { /* storage refused */ } });
      let refuse = false;
      await page.route('**/api/**', (r) => (refuse
        ? r.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify(AUTH_403) })
        : r.fallback()));
      await page.goto(BASE + '/', { waitUntil: 'load' });
      if (await page.$('#firstrun:not([hidden])')) await page.keyboard.press('Escape');
      // The first agent, from the board's own status read (made by the page, so it carries the page's credentials).
      const first = await page.evaluate(async () => {
        const r = await fetch('/api/status');
        const j = r.ok ? await r.json() : null;
        const a = j && Array.isArray(j.agents) && j.agents[0];
        return a ? (a.name || a.sessionName || null) : null;
      });
      check(`${look}: precondition: the board has an agent to open`, !!first, String(first));
      await page.goto(BASE + '/?agent=' + encodeURIComponent(first || ''), { waitUntil: 'load' });
      await page.waitForSelector('#panel-detail:not([hidden])', { timeout: 15000 });
      await page.waitForTimeout(1500);
      const before = await state(page);
      check(`${look}: control: signed in, no signed-out note and the Model section is live`, !before.note && !before.inert, JSON.stringify(before));

      refuse = true;
      await page.waitForFunction(() => { const n = document.getElementById('d-signedout'); return n && !n.hidden; }, null, { timeout: 20000 }).catch(() => {});
      const out = await state(page);
      check(`${look}: signed out: the agent page says so`, out.note && /signed out/i.test(out.text) && /Sign this tab in again/.test(out.text), JSON.stringify(out));
      check(`${look}: signed out: the Model section (the picker) is inert`, out.inert, JSON.stringify(out));

      refuse = false;
      await page.waitForFunction(() => { const n = document.getElementById('d-signedout'); return n && n.hidden; }, null, { timeout: 20000 }).catch(() => {});
      const back = await state(page);
      check(`${look}: signed in again: the note is gone and the Model section is live`, !back.note && !back.inert, JSON.stringify(back));
      await ctx.close();
    }
    check('no page errors', errors.length === 0, JSON.stringify(errors.slice(0, 3)));
  } finally {
    await browser.close();
  }
  const failed = results.filter((r) => !r.pass).length;
  console.log(failed ? `${failed} of ${results.length} checks FAILED` : `all ${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
})();
