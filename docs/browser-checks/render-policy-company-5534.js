'use strict';

/*
 * #5534 slice 4: Settings > AI Policies shows the company's AI policy (from its applied Kosmos policy) first, read-only,
 * above the person's own, so the screen says what every agent is handed.
 *
 * TWO ARMS, and the control is what makes the company arm mean something:
 *   COMPANY  /api/policy answered (page.route) with a company entry and one policy of the person's: the company card
 *            is first, carries its own line, and offers no button; the person's card keeps its Remove.
 *   CONTROL  the same answer without a company entry: no company card, the person's card as before.
 *
 * Runs HEADLESS-safe (DOM-state assertions only) against any board it can reach; it never writes (the reads are
 * intercepted at the browser). SHOT=<file.png> also saves a screenshot of the section in the company arm.
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 \
 *     node docs/browser-checks/render-policy-company-5534.js http://127.0.0.1:PORT
 */

const { chromium } = require('playwright');

const BASE = process.argv[2] || process.env.KOSMOS_URL || 'http://127.0.0.1:17461';
const MINE = { id: 'p1', name: 'Branding', source: 'pasted', savedAt: '2026-10-01T12:00:00.000Z', chars: 20, opening: 'Use the brand voice.' };
const COMPANY = { name: 'Acme legal', chars: 39, opening: 'Never paste client names into a prompt.' };

const problems = [];
function check(name, pass, detail) {
  console.log((pass ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  ' + detail : ''));
  if (!pass) problems.push(name);
}

async function openPolicies(pg, answer) {
  await pg.route('**/api/policy', (route) => (route.request().method() === 'GET'
    ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(answer) })
    : route.continue()));
  await pg.goto(BASE, { waitUntil: 'networkidle' });
  if (!(await pg.$('#firstrun[hidden]'))) { await pg.keyboard.press('Escape'); await pg.waitForTimeout(400); }
  await pg.waitForTimeout(600);
  await pg.evaluate(() => showTab('settings'));
  await pg.waitForTimeout(400);
  await pg.click('#s-nav button[data-go="policy"]');
  await pg.waitForSelector('#pol-state .polcard', { timeout: 5000 });
}

function readCards(pg) {
  return pg.$$eval('#pol-state .polcard', (cards) => cards.map((c) => ({
    company: c.classList.contains('polcompany'),
    name: (c.querySelector('.polname') || {}).textContent || '',
    from: (c.querySelector('.polfrom') || {}).textContent || '',
    buttons: c.querySelectorAll('button').length,
    visible: !!(c.offsetWidth || c.offsetHeight),
  })));
}

async function run() {
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    const p1 = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
    await openPolicies(p1, { state: 'saved', policies: [MINE], because: null, company: COMPANY });
    const cards = await readCards(p1);
    check('company arm: two cards', cards.length === 2, JSON.stringify(cards));
    check('company arm: the company card is first and visible', !!cards[0] && cards[0].company && cards[0].visible && cards[0].name === 'Acme legal', JSON.stringify(cards[0]));
    check('company arm: it says only the company can change it', !!cards[0] && /Only your company can change or remove it\./.test(cards[0].from), cards[0] && cards[0].from);
    check('company arm: the company card offers no button', !!cards[0] && cards[0].buttons === 0, cards[0] && String(cards[0].buttons));
    check('company arm: the person\'s card keeps its buttons', !!cards[1] && !cards[1].company && cards[1].buttons >= 3, cards[1] && String(cards[1].buttons));
    if (process.env.SHOT) await (await p1.$('#s-sec-policy')).screenshot({ path: process.env.SHOT });
    await p1.close();

    const p2 = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
    await openPolicies(p2, { state: 'saved', policies: [MINE], because: null, company: null });
    const plain = await readCards(p2);
    check('control: no company card without a company policy', plain.length === 1 && !plain[0].company, JSON.stringify(plain));
    await p2.close();
  } catch (e) {
    problems.push('the check could not run: ' + ((e && e.message) || e));
  } finally {
    await browser.close();
  }
  for (const p of problems) console.error(' FAIL ' + p);
  console.log(problems.length ? 'FAIL render-policy-company-5534 (' + problems.length + ')' : 'PASS render-policy-company-5534');
  process.exit(problems.length ? 1 : 0);
}

run().catch((e) => { console.error(' FAIL ' + ((e && e.message) || e)); process.exit(1); });
