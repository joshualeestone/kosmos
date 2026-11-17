// Browser-check-surface: d-signedout d-sec-model panel-detail
/**
 * kosmos#8662 (feedback 11-17): a tab is signed out when Kosmos restarts or updates. An agent page that was open then
 * kept its last reading and its Model controls with nothing saying why a model switch went nowhere (the board's grid
 * says "not signed in", #2023, but the agent page never did). Now, on the agent page, in both looks:
 *   - before the sign-out (control): no signed-out note, the Model section is not inert;
 *   - once every read is refused (403, the board's own body): the note shows and the Model section is inert;
 *   - once reads succeed again (signed back in): the note is gone and the Model section is live again;
 *   - a phone or computer whose relay sign-in lapsed (#718: 401 with {"signed_out":true}) gets the board's own
 *     sentence and Sign in button, not this computer's tab wording;
 *   - a genuine outage after a sign-out (nothing answers) is not a sign-out (#268): the note goes.
 * Red on main: every arm that needs the note (sign-out, inert, focus moved to the note, focus back on sign-in, second
 * sign-out, relay) in each look; the control, the signed-in-again arm and the outage arm pass on main because the note
 * is absent everywhere.
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
      let refuse = false;   // false | '403' | 'relay' | 'down'
      await page.route('**/api/**', (r) => {
        if (refuse === '403') return r.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify(AUTH_403) });
        if (refuse === 'relay') return r.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ signed_out: true }) });
        if (refuse === 'down') return r.abort('connectionrefused');
        return r.fallback();
      });
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

      // Keyboard focus inside the Model section when it locks must move to the note's way out, not fall to the page.
      await page.evaluate(() => { const b = document.querySelector('#d-nav button[data-go="model"]'); if (b) b.click(); });
      await page.waitForTimeout(800);
      await page.evaluate(() => { const f = document.querySelector('#d-sec-model select, #d-sec-model button'); if (f) f.focus(); });
      const focusedIn = await page.evaluate(() => !!document.activeElement && !!document.getElementById('d-sec-model').contains(document.activeElement));
      refuse = '403';
      await page.waitForFunction(() => { const n = document.getElementById('d-signedout'); return n && !n.hidden; }, null, { timeout: 20000 }).catch(() => {});
      const out = await state(page);
      check(`${look}: signed out: the agent page says so`, out.note && /This page is signed out/.test(out.text) && /See how to sign in/.test(out.text), JSON.stringify(out));
      check(`${look}: signed out: the Model section (the picker) is inert`, out.inert, JSON.stringify(out));
      await page.waitForFunction(() => { const n = document.getElementById('d-signedout'); return n && n.querySelector('a, button'); }, null, { timeout: 5000 }).catch(() => {});
      const where = await page.evaluate(() => { const n = document.getElementById('d-signedout'); return !!n && n.contains(document.activeElement); });
      check(`${look}: precondition: focus was inside the Model section before the sign-out`, focusedIn, String(focusedIn));
      check(`${look}: focus inside the Model section moved to the note when it locked`, where, String(where));

      refuse = false;
      await page.waitForFunction(() => { const n = document.getElementById('d-signedout'); return n && n.hidden; }, null, { timeout: 20000 }).catch(() => {});
      const back = await state(page);
      check(`${look}: signed in again: the note is gone and the Model section is live`, !back.note && !back.inert, JSON.stringify(back));
      const backFocus = await page.evaluate(() => { const m = document.getElementById('d-sec-model'); return !!m && (m === document.activeElement || m.contains(document.activeElement)); });
      check(`${look}: signed in again: focus held on the note returned to the Model section, not the page`, backFocus, String(backFocus));
      // A second sign-out of the same kind is written again after it shows (announced), not only unhidden.
      refuse = '403';
      await page.waitForFunction(() => { const n = document.getElementById('d-signedout'); return n && !n.hidden && /See how to sign in/.test(n.textContent); }, null, { timeout: 20000 }).catch(() => {});
      const again = await state(page);
      check(`${look}: a second sign-out shows the note with its words again`, again.note && /This page is signed out/.test(again.text), JSON.stringify(again));
      refuse = false;
      await page.waitForFunction(() => { const n = document.getElementById('d-signedout'); return n && n.hidden; }, null, { timeout: 20000 }).catch(() => {});

      refuse = 'relay';
      await page.waitForFunction(() => { const n = document.getElementById('d-signedout'); return n && !n.hidden; }, null, { timeout: 20000 }).catch(() => {});
      const relay = await state(page);
      const button = await page.evaluate(() => !!document.querySelector('#d-signedout [data-device-signin]'));
      check(`${look}: relay sign-out: the board's own sentence and Sign in button, the Model section inert`,
        relay.note && /phone or computer was signed out/i.test(relay.text) && button && relay.inert, JSON.stringify({ ...relay, button }));

      refuse = 'down';
      await page.waitForFunction(() => { const n = document.getElementById('d-signedout'); return n && n.hidden; }, null, { timeout: 20000 }).catch(() => {});
      const down = await state(page);
      check(`${look}: an outage after a sign-out is not a sign-out: the note goes and the Model section is live`, !down.note && !down.inert, JSON.stringify(down));
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
