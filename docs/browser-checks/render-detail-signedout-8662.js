// Browser-check-surface: d-signedout d-sec-model panel-detail d-runson
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
 * kosmos#8672 added: keyboard focus is on the note at the moment it shows, before its words are written (read in a
 * microtask; measured red with the focus moved into the frame that writes the words, which the earlier arm passed);
 * and while signed out the open page keeps its last Runs on reading, while an agent page opened then (from what the
 * board last read) says "Signed out: sign in to see its model" for an agent with no model read (red with modelLine's
 * signed-out line removed).
 * Measured against main's page (the first version of this check): the sign-out arms were red there.
 * Reads are intercepted (as render-board-signin-403-2023.js does), so no enforcing board or token is needed.
 *
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 \
 *     node docs/browser-checks/render-detail-signedout-8662.js http://127.0.0.1:PORT
 * against a sandboxed board with first-run completed and at least two Claude agents with no model read (the driver's
 * fleet fixture); the first one /api/status lists is the one whose page is opened.
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
// kosmos#8672 pin 1: the Model section's Runs on line, and whether the agent on the page has a model read.
const SIGNED_OUT_MODEL = 'Signed out: sign in to see its model';
const runsOn = (page) => page.evaluate(() => {
  const line = document.getElementById('d-runson');
  const c = typeof CURRENT !== 'undefined' ? CURRENT : null;
  // A Claude agent (no other runner or account provider: those keep their provider line, signed out or not) with no model.
  const claude = !!c && (!c.runner || c.runner === 'claude') && !(c.account && c.account.provider && c.account.provider !== 'anthropic');
  return { line: line ? line.textContent.trim() : null, agent: c ? c.sessionName : null, noModel: claude && !c.modelName && !c.plannedModelName };
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
      let statusReads = 0;  // every status read the page makes, answered or refused
      await page.route('**/api/**', (r) => {
        if (new URL(r.request().url()).pathname === '/api/status') statusReads += 1;
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
      const runsBefore = await runsOn(page);
      check(`${look}: control: signed in, Runs on does not say signed out`, !String(runsBefore.line).includes(SIGNED_OUT_MODEL), JSON.stringify(runsBefore));
      // Without this the kept-reading arm below cannot fail: an agent with a model shows its name either way.
      check(`${look}: precondition: the open agent is a Claude agent with no model read`, runsBefore.noModel, JSON.stringify(runsBefore));

      // Keyboard focus inside the Model section when it locks must move to the note's way out, not fall to the page.
      await page.evaluate(() => { const b = document.querySelector('#d-nav button[data-go="model"]'); if (b) b.click(); });
      await page.waitForTimeout(800);
      await page.evaluate(() => { const f = document.querySelector('#d-sec-model select, #d-sec-model button'); if (f) f.focus(); });
      const focusedIn = await page.evaluate(() => !!document.activeElement && !!document.getElementById('d-sec-model').contains(document.activeElement));
      /* kosmos#8672 pin 3: where focus is at the moment the note shows, read in a microtask (before the next frame writes
         its words), so a focus that only arrives with the words cannot pass. */
      await page.evaluate(() => {
        const n = document.getElementById('d-signedout');
        window.__atShow = null;
        const mo = new MutationObserver(() => {
          if (n.hidden || window.__atShow) return;
          window.__atShow = { inNote: n.contains(document.activeElement), words: n.textContent.length, pageHidden: document.hidden };
          mo.disconnect();
        });
        mo.observe(n, { attributes: true, attributeFilter: ['hidden'] });
      });
      refuse = '403';
      await page.waitForFunction(() => { const n = document.getElementById('d-signedout'); return n && !n.hidden; }, null, { timeout: 20000 }).catch(() => {});
      const out = await state(page);
      check(`${look}: signed out: the agent page says so`, out.note && /This page is signed out/.test(out.text) && /See how to sign in/.test(out.text), JSON.stringify(out));
      const atShow = await page.evaluate(() => window.__atShow);
      /* On screen, the words come a frame after the note shows, so "no words yet" proves focus did not wait for them. A
         page the browser reports hidden writes them at once and this arm cannot tell the two orders apart,
         so the precondition below fails there. */
      check(`${look}: precondition: the page was on screen when the note showed`, !!atShow && atShow.pageHidden === false, JSON.stringify(atShow));
      const where = !!atShow && atShow.inNote === true && atShow.words === 0;
      check(`${look}: signed out: the Model section (the picker) is inert`, out.inert, JSON.stringify(out));
      check(`${look}: precondition: focus was inside the Model section before the sign-out`, focusedIn, String(focusedIn));
      check(`${look}: focus inside the Model section moved to the note when it locked, before its words arrived`, where, JSON.stringify(atShow));

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
      /* kosmos#8672 pin 1. The open page keeps its last reading (the note says so), so the signed-out line reaches Runs
         on when an agent page is painted while signed out: opening another agent in-page (openDetail called
         directly, the painter rather than a click), from what the board last read. */
      // Two more status polls first, so a repaint driven by a refused poll would have landed before the read.
      const readsAt = statusReads;
      for (let i = 0; i < 100 && statusReads < readsAt + 2; i++) await page.waitForTimeout(200);
      check(`${look}: precondition: two more status polls ran while signed out`, statusReads >= readsAt + 2, String(statusReads - readsAt));
      const runsKept = await runsOn(page);
      check(`${look}: signed out: the open page keeps its last Runs on reading`, runsKept.line === runsBefore.line && !String(runsKept.line).includes(SIGNED_OUT_MODEL), JSON.stringify(runsKept));
      const other = await page.evaluate((cur) => {
        const b = (typeof LAST !== 'undefined' && Array.isArray(LAST)) ? LAST.find((x) => x.sessionName !== cur && !x.modelName && !x.plannedModelName && (!x.runner || x.runner === 'claude') && !(x.account && x.account.provider && x.account.provider !== 'anthropic')) : null;
        if (b && typeof openDetail === 'function') openDetail(b.sessionName);
        return b ? b.sessionName : null;
      }, runsBefore.agent);
      check(`${look}: precondition: another Claude agent with no model read to open`, !!other, String(other));
      await page.waitForFunction((want) => { const l = document.getElementById('d-runson'); return l && l.textContent.includes(want); }, SIGNED_OUT_MODEL, { timeout: 5000 }).catch(() => {});
      const runsOut = await runsOn(page);
      /* Runs on only: the sandbox's Claude agents have no model menu options (no account), so its selected option is not
         reachable here; modelLine is that menu's source too, and web.made-before.test.js pins modelLine itself. */
      check(`${look}: signed out: an agent with no model read, opened, says so on Runs on`, runsOut.agent === other && String(runsOut.line).includes(SIGNED_OUT_MODEL), JSON.stringify(runsOut));
      // Back to the first agent for the arms below, which read only the note and the section's lock.
      await page.evaluate((n) => openDetail(n), runsBefore.agent);
      const backOn = await page.evaluate(() => (typeof CURRENT !== 'undefined' && CURRENT ? CURRENT.sessionName : null));
      check(`${look}: precondition: the first agent's page is open again`, backOn === runsBefore.agent, String(backOn));
      refuse = false;
      await page.waitForFunction(() => { const n = document.getElementById('d-signedout'); return n && n.hidden; }, null, { timeout: 20000 }).catch(() => {});

      refuse = 'relay';
      await page.waitForFunction(() => { const n = document.getElementById('d-signedout'); return n && !n.hidden; }, null, { timeout: 20000 }).catch(() => {});
      const relay = await state(page);
      const button = await page.evaluate(() => !!document.querySelector('#d-signedout [data-device-signin]'));
      check(`${look}: relay sign-out: the board's own sentence and Sign in button, the Model section inert`,
        relay.note && /phone or computer was signed out/i.test(relay.text) && button && relay.inert, JSON.stringify({ ...relay, button }));

      // Precondition for the outage arm: the page is signed out (the relay arm above) (note shown, section inert), so the note going
      // away below is the outage clearing it, not a page that never showed it.
      await page.waitForFunction(() => { const n = document.getElementById('d-signedout'); const m = document.getElementById('d-sec-model'); return n && !n.hidden && m && m.inert; }, null, { timeout: 20000 }).catch(() => {});
      const pre = await state(page);
      check(`${look}: precondition: signed out before the outage`, pre.note && pre.inert, JSON.stringify(pre));

      refuse = 'down';
      await page.waitForFunction(() => { const n = document.getElementById('d-signedout'); return n && n.hidden; }, null, { timeout: 20000 }).catch(() => {});
      const down = await state(page);
      check(`${look}: an outage after a sign-out is not a sign-out: the note goes and the Model section is live`, !down.note && !down.inert, JSON.stringify(down));
      refuse = '403';
      // The note's link leads to the sign-in steps: following it while signed out lands on the board's not-signed-in box.
      await page.waitForFunction(() => { const n = document.getElementById('d-signedout'); return n && !n.hidden && n.querySelector('a'); }, null, { timeout: 20000 }).catch(() => {});
      await Promise.all([page.waitForNavigation({ waitUntil: 'load' }).catch(() => {}), page.click('#d-signedout a').catch(() => {})]);
      await page.waitForFunction(() => /not signed in/i.test(document.body.innerText) && /Sign this tab in again/.test(document.body.innerText), null, { timeout: 20000 }).catch(() => {});
      const landed = await page.evaluate(() => ({ box: /This board is not signed in/i.test(document.body.innerText), steps: /Sign this tab in again/.test(document.body.innerText) }));
      check(`${look}: the note's link lands on the board's sign-in box and its steps`, landed.box && landed.steps, JSON.stringify(landed));
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
