/**
 * The two endings of Create an agent that are not success.
 *
 * 🛑 NOBODY EVER SEES THESE ON PURPOSE, which is why they are worth a check.
 * The success ending has had four rounds of Josh's attention; these two are
 * reached only when something went wrong, so they are where a false sentence
 * can live for months. One did: a partial creation says "Nothing was made" and
 * then offered a button to go and see it under Agents.
 *
 * 🔑 THE TIMEOUT ENDING IS DRIVEN FOR REAL, thirty seconds and all. `/api/status`
 * is answered with a board that never contains the agent, so the watch runs its
 * full course exactly as it would on somebody's machine. Faking the ending by
 * setting `hidden` from script would test markup I wrote rather than the branch
 * that reveals it.
 *
 * ⚠️ THE CREATE ROUTE IS INTERCEPTED, so nothing here makes an agent.
 *
 * ⚠️ NEEDS A SANDBOX WITH FIRST RUN COMPLETE (see render-found-board.js).
 *
 * Run: see the README in this directory.
 */
'use strict';

const playwright = require('playwright');

const BASE = process.argv[2] || 'http://127.0.0.1:4399';
const HEADED = process.env.HEADED !== '0';

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
}

const MADE = {
  outcome: 'created',
  name: 'rosie',
  shownAs: 'Rosie',
  folder: '/Users/x/work/workers/rosie',
  steps: [
    { label: 'made its folder', ok: true },
    { label: 'wrote its instructions', ok: true },
    { label: 'put the script that starts agents in place', ok: true },
    { label: 'set it up to keep running', ok: true },
    { label: 'started it', ok: true },
  ],
  projects: [],
};

(async () => {
  const browser = await playwright.chromium.launch({ headless: !HEADED });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message)));

  /* A board that never contains Rosie: the exact machine state this ending is
     about. Everything else on it is left alone. */
  await page.route('**/api/status**', async (r) => {
    const res = await r.fetch();
    let body = {};
    try { body = await res.json(); } catch { body = { agents: [] }; }
    body.agents = (body.agents || []).filter((a) => a && a.sessionName !== 'rosie');
    r.fulfill({ json: body });
  });
  await page.route('**/api/agents', (r) => {
    if (r.request().method() !== 'POST') { r.continue(); return; }
    r.fulfill({ json: MADE });
  });

  await page.goto(BASE + '/?tab=create', { waitUntil: 'networkidle' });
  await page.waitForSelector('#pick-pm:not([hidden])', { timeout: 10000 });
  await page.evaluate(() => {
    document.getElementById('pick-pm').click();
    document.getElementById('role-next').click();
  });
  await page.waitForFunction(() => !document.getElementById('cstep-name').hidden, null, { timeout: 8000 });
  await page.fill('#create-name', 'Rosie');
  await page.click('#create-go');

  /* The watch is thirty seconds by design and this waits it out rather than
     shortening it: the number is the product's promise about how long it will
     keep looking, and a check that stubs it past would not be measuring it. */
  await page.waitForFunction(
    () => !document.getElementById('made-look').hidden,
    null,
    { timeout: 45000 },
  );

  const ending = await page.evaluate(() => {
    const look = document.getElementById('made-look');
    const lr = look.getBoundingClientRect();
    look.scrollIntoView({ block: 'center' });
    const after = look.getBoundingClientRect();
    const at = document.elementFromPoint(after.left + after.width / 2, after.top + after.height / 2);
    return {
      head: document.getElementById('made-head').textContent.trim(),
      warn: document.getElementById('made-warn').textContent.trim(),
      look: look.textContent.trim(),
      lookShown: !look.hidden && lr.width > 0,
      pressable: Boolean(at && at.closest && at.closest('#made-look')),
      /* 🔑 THE ABSENCE IS ASKED OF THE CONTROLS A PERSON CAN PRESS, not of the
         page text. The markup carries a comment recording why that button went,
         and a check that grepped the document for the words would fail on the
         explanation for their removal -- a trap this file has sprung before. */
      buttons: [...document.querySelectorAll('#cstep-made button')]
        .filter((b) => !b.hidden && b.getBoundingClientRect().width > 0)
        .map((b) => b.textContent.trim()),
    };
  });

  check('the timeout ending is reached and says so', /has not come up/.test(ending.head), `"${ending.head}"`);
  check('it says the screen stopped waiting, not the agent',
    /stopped waiting, it did not stop it/.test(ending.warn), `"${ending.warn.slice(0, 90)}…"`);
  check('no button offers to go and see it under Agents',
    !ending.buttons.some((b) => /under Agents/i.test(b)), JSON.stringify(ending.buttons));
  check('the offer is to look again, and it can be pressed',
    ending.look === 'Look again' && ending.lookShown && ending.pressable, JSON.stringify(ending));

  // ---- press it -----------------------------------------------------------
  await page.click('#made-look');
  await page.waitForTimeout(600);
  const again = await page.evaluate(() => ({
    head: document.getElementById('made-head').textContent.trim(),
    look: document.getElementById('made-look').hidden,
    warn: document.getElementById('made-warn').hidden,
  }));
  check('pressing it goes back to looking', /^Looking for Rosie$/.test(again.head), `"${again.head}"`);
  check('and takes its own offer off the screen while it does', again.look && again.warn,
    JSON.stringify(again));

  check('no page errors', errors.length === 0, errors.join(' | '));

  await browser.close();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
