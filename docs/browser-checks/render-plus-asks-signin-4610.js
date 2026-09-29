// Browser-check-surface: plus-asks askcard plus-ask-rows plus-state2 plus-si-done plus-flow
// (#2518) the tokens this check asserts: where Kosmos+ device requests render on the Plus screen right after sign-in.
/* #4610 (Josh, 2026-09-29 12:50, a brand-new Kosmos+ account in the Mac app): "these should have rendered in the same
 * spot as the login and not above everything". Right after sign-in the Plus screen shows the sign-in wizard's "You're
 * signed in to Kosmos+" step (#plus-state2, #plus-si-done), not the connected panel (#plus-flow). The request cards
 * went into the TOP card then, a full-width band above the sidebars, because they moved into the Plus section only
 * while #plus-flow showed.
 *
 * 🔑 WHAT ONLY A BROWSER CAN SAY: which box the cards land in and where it sits. The sign-in step is set the way the
 * wizard sets it (plusSiShow), with #plus-flow hidden as paintPlus leaves it during a sign-in, then the requests are
 * painted (paintAsk). CONTROL: on another view the top card is still the compact "N devices are asking" notice.
 *
 * Run: NODE_PATH=$HOME/work/pw-runtime/node_modules node docs/browser-checks/render-plus-asks-signin-4610.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-plusasks-4610-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-plusasks-workers-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-plusasks-projects-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-plusasks-launch-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-plusasks-config-'));
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';

let chromium;
try { ({ chromium } = require('playwright')); }
catch { console.log('render-plus-asks-signin-4610: playwright not on NODE_PATH - SKIPPED, not passed.'); process.exit(0); }
const fleet = require('../../test-support/fleet');
const srv = require('../../server.js');

const fail = [];
function chk(ok, label, extra) { console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : '')); if (!ok) fail.push(label); }
const now = () => Math.floor(Date.now() / 1000);
const REMOTE = { configured: true, on: true, ok: true, enrolled: true, email: 'you@example.com', status: { state: 'up', address: 'you0929.kosmosplus.com' } };
const PENDING = [{ device_id: 'd-safari', name: 'Mac · Safari', code: 'VR-D6', first_seen: now() - 14 * 60 }, { device_id: 'd-phone', name: 'iPhone', code: 'W6-M4', first_seen: now() - 60 }];

(async () => {
  fleet.install([fleet.agent('april', { state: 'idle', displayName: 'April', role: 'a researcher' })]);
  const server = await srv.start(0);
  const BASE = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    /* Desktop and phone widths (the settings column stacks on a phone). */
    for (const W of [1400, 390]) {
      const page = await browser.newPage({ viewport: { width: W, height: W > 800 ? 950 : 844 } });
      const errs = [];
      page.on('pageerror', (e) => errs.push(e.message));
      const json = (o) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
      await page.route('**/api/remote', (route, req) => route.fulfill(json(req.method() === 'GET' ? REMOTE : { ok: true })));
      await page.route('**/api/remote/pending', (route) => route.fulfill(json({ devices: PENDING, email: 'you@example.com', self_device_id: 'd-self' })));
      await page.route('**/api/remote/devices**', (route) => route.fulfill(json({ on: true, allowed: [] })));
      await page.goto(BASE, { waitUntil: 'networkidle' });
      if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
      await page.evaluate(() => showTab('settings'));
      await page.evaluate(() => { const b = document.querySelector('#s-nav button[data-go="plus"]'); if (b) b.click(); });
      await page.waitForSelector('#plus-flow', { state: 'visible', timeout: 5000 });

      /* The state right after a sign-in: the wizard on its done step, the connected panel not yet shown. */
      const where = await page.evaluate(async () => {
        document.getElementById('plus-state2').hidden = false;
        document.getElementById('plus-flow').hidden = true;
        plusSiShow('plus-si-done');
        if (typeof pollAsk === 'function') await pollAsk();
        paintAsk();
        const vis = (id) => { const e = document.getElementById(id); return !!(e && !e.hidden && e.getBoundingClientRect().height > 0); };
        const asks = document.getElementById('plus-asks'), sec = document.getElementById('s-sec-plus'), head = document.querySelector('.apphead');
        const a = asks.getBoundingClientRect(), s = sec.getBoundingClientRect();
        return {
          signedInShown: vis('plus-si-done'), flowShown: vis('plus-flow'),
          inSection: vis('plus-asks') && sec.contains(asks), topCard: vis('askcard'),
          rows: document.querySelectorAll('#plus-ask-rows .askreq').length,
          withinSection: a.left >= s.left - 1 && a.right <= s.right + 1,
          belowHeader: a.top >= Math.round(head.getBoundingClientRect().bottom),
        };
      });
      chk(where.signedInShown && !where.flowShown, '[' + W + '] precondition: the Plus screen shows "You\'re signed in" and not the connected panel', JSON.stringify(where));
      chk(where.inSection && where.rows === 2, '[' + W + '] #4610 right after sign-in both requests render in the Kosmos Plus section', JSON.stringify(where));
      chk(!where.topCard, '[' + W + '] #4610 and not in the top card, the band that spread above everything', JSON.stringify(where));
      chk(where.withinSection && where.belowHeader, '[' + W + '] #4610 they sit inside the settings column, below the header, not across the window', JSON.stringify(where));

      /* CONTROL: on any other view the top card is the compact notice, as before. */
      await page.evaluate(async () => { showTab('agents'); paintAsk(); });
      await page.waitForTimeout(200);
      const other = await page.evaluate(() => ({ shown: !document.getElementById('askcard').hidden, text: document.getElementById('askcard').innerText.replace(/\s+/g, ' ').trim(), cards: document.querySelectorAll('#askcard .askreq').length }));
      chk(other.shown && /2 devices are asking to use this Kosmos\./.test(other.text) && other.cards === 0, '[' + W + '] CONTROL: elsewhere the top card is the one-line notice, not the cards', JSON.stringify(other));
      chk(errs.length === 0, '[' + W + '] no page errors', errs.join(' | '));
      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  if (fail.length) { console.log('\n' + fail.length + ' FAILED'); process.exit(1); }
  console.log('\nall plus-asks-signin checks passed');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
