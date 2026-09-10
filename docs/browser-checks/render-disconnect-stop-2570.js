// Browser-check-surface: data-forget acct-box
'use strict';

/**
 * kosmos#2570: the Settings row's SECOND confirm, in a real DOM.
 *
 * ⚠️ WHY A BROWSER. `web.disconnect-stop-2570.test.js` reads the handler's SOURCE
 * and can prove the flag sits inside a `stopFor` ternary. It cannot prove that
 * three presses actually produce arm -> refusal-with-names -> stop, or that the
 * request the third press sends carries the flag. That is the #1720 gap exactly:
 * a source pin green while the page does nothing.
 *
 * The load-bearing assertion is the ORDER. A page that sent `stopAgents` on the
 * FIRST disconnect would satisfy any check that merely looked for a request
 * carrying it, and would be a page that stops your agents without asking.
 *
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-disconnect-stop-2570.js
 *
 * ⚠️ HEADED by default, like its siblings. HEADED=0 on a machine with no console
 * session; this asserts text and request bodies, not pixels, so the verdict is
 * the same either way.
 */

const nodePath = require('node:path');

let chromium;
try { ({ chromium } = require('playwright')); }
catch {
  console.log('render-disconnect-stop-2570: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}

const PAGE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');

const ROW = {
  provider: 'anthropic', providerName: 'Anthropic / Claude',
  email: 'busy@example.com', label: 'busy@example.com', dir: '/home/.claude-busy',
  organization: null, isDefault: false, keyTail: null,
  memoryShared: true, offerable: true,
  connection: {
    state: 'connected', badge: 'working', plan: null, checkedLive: true,
    because: 'because working', observedAt: Date.now() - 12000, observedAgeMs: 12000,
  },
};

(async () => {
  let browser;
  try { browser = await chromium.launch({ headless: process.env.HEADED === '0' }); }
  catch (err) {
    console.error('FAIL  render-disconnect-stop-2570: could not start a browser'
      + (process.env.HEADED === '0' ? '.' : ' (headed; try HEADED=0).'));
    console.error('  ' + (err && err.message ? err.message.split('\n')[0] : err));
    process.exit(1);
  }
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  await page.goto('file://' + PAGE);

  const r = await page.evaluate(async (account) => {
    const sent = [];
    const realFetch = window.fetch;
    /* The board is stubbed, not running: /api/accounts paints the row, and the
       DELETE answers the way the route does -- refusing and NAMING the agent
       until the request carries the flag. */
    window.fetch = (u, opts) => {
      const url = String(u);
      if (url.indexOf('/api/accounts/claude') !== -1 && opts && opts.method === 'DELETE') {
        let body = null;
        try { body = JSON.parse(opts.body || 'null'); } catch { body = null; }
        sent.push(body);
        if (body && body.stopAgents === true) {
          return Promise.resolve({ ok: true, json: async () => ({
            forgotten: true,
            because: 'That account is off the list. marlowe was stopped first. You can restore it from the removed list if you sign back in.',
            stopped: ['marlowe'],
          }) });
        }
        return Promise.resolve({ ok: false, json: async () => ({
          error: 'marlowe is set up to run on this account. Move it to another account or remove it first.',
          usedBy: ['marlowe'],
        }) });
      }
      if (url.indexOf('/api/accounts') !== -1) {
        return Promise.resolve({ ok: true, json: async () => ({ accounts: [account] }) });
      }
      return realFetch(u, opts);
    };
    if (typeof paintAccounts !== 'function') return { error: 'paintAccounts is not a function' };
    await paintAccounts();

    const btn = document.querySelector('#set-accounts [data-forget]');
    if (!btn) return { error: 'no Disconnect button rendered' };
    const settle = () => new Promise((done) => setTimeout(done, 40));

    const resting = (btn.textContent || '').trim();
    btn.click();                       // 1: arm
    await settle();
    const armed = (btn.textContent || '').trim();
    btn.click();                       // 2: send, and be refused by name
    await settle();
    await settle();
    const offered = (btn.textContent || '').trim();
    const offeredLabel = btn.getAttribute('aria-label') || '';
    const said = ((document.getElementById('set-accounts-msg') || {}).textContent || '').trim();
    btn.click();                       // 3: accept the offer
    await settle();
    await settle();

    return { resting, armed, offered, offeredLabel, said, sent };
  }, ROW);

  await browser.close();

  const fails = [];
  const ok = (cond, why) => { if (!cond) fails.push(why); };

  if (r.error) { console.error('FAIL  render-disconnect-stop-2570: ' + r.error); process.exit(1); }

  ok(/^Disconnect$/.test(r.resting), 'the resting button does not read "Disconnect": ' + JSON.stringify(r.resting));
  ok(/^Disconnect\?$/.test(r.armed), 'the first press does not arm the ordinary confirm: ' + JSON.stringify(r.armed));

  /* 🛑 THE ORDER, WHICH IS THE WHOLE POINT. The first request must NOT carry the
     flag: a page that always sent it would stop agents nobody agreed to stop. */
  ok(r.sent.length === 2, 'expected exactly two DELETEs (one refused, one accepted); got ' + r.sent.length);
  ok(r.sent[0] && r.sent[0].stopAgents === undefined,
    'the FIRST disconnect carried stopAgents, so agents are stopped without being offered: ' + JSON.stringify(r.sent[0]));
  ok(r.sent[1] && r.sent[1].stopAgents === true,
    'the second press did not carry stopAgents, so the offer does nothing: ' + JSON.stringify(r.sent[1]));

  ok(/Disconnect and stop marlowe\?/.test(r.offered),
    'the refusal did not turn into the second confirm, naming the agent: ' + JSON.stringify(r.offered));
  /* WCAG 2.5.3: the accessible name must start with the visible words, or speech
     input cannot operate the button it can see. */
  ok(r.offeredLabel.indexOf(r.offered) === 0,
    'the armed accessible name does not start with the visible text: ' + JSON.stringify(r.offeredLabel));
  ok(/restore/i.test(r.said),
    'the offer sentence does not say the agents can be restored: ' + JSON.stringify(r.said));

  if (fails.length) {
    console.error('FAIL  render-disconnect-stop-2570');
    /* Each finding carries FAIL, so the runner can QUOTE the reason beside a red
       rather than reporting '(no FAIL or error line in its output)'. The shape is
       the siblings' and browser-checks-reason-grep.test.js holds it. */
    for (const f of fails) console.error('  FAIL  ' + f);
    process.exit(1);
  }
  console.log('ok    render-disconnect-stop-2570: arm, refusal-by-name, then a stop the person agreed to');
})();
