/**
 * What the agent page says after you rename an agent.
 *
 * 🛑 A RENAME IS TWO ACTS AND THE SENTENCE HAS TO SAY WHICH ONES HAPPENED. The
 * record is what every screen reads; the sentence at the top of the agent's own
 * instructions is the only one the AGENT reads, and a running agent read that
 * when it started. Josh renamed one Bob to Scarlet and it still thought it was
 * Bob, so "Saved." on its own is exactly the message that misled him.
 *
 * 🔑 IT PRESSES SAVE. The three sentences live inside a click handler, which is
 * the code no page check ever reaches -- the class this directory already has a
 * scar from: a form that rendered perfectly with a dead button at the end of it,
 * because the throw was on the press.
 *
 * ⚠️ THE ROUTE IS INTERCEPTED IN THE BROWSER, so nothing here renames a real
 * agent or rewrites anybody's instruction file. The three answers are the three
 * the server can actually give.
 *
 * ⚠️ NEEDS A SANDBOX WITH FIRST RUN COMPLETE (see render-found-board.js) and at
 * least one agent the board can see. It drives whichever agent the board opens
 * first and never presses anything but Save.
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

/* The three answers, and what each one owes the person. The restart clause is
   owed by exactly one of them: telling somebody to restart an agent whose
   instructions we could not touch sends them to do something that will not
   help, and saying nothing when the file DID change leaves them with a board
   reading Scarlet and an agent answering to Bob. */
const CASES = [
  { name: 'the file changed',
    body: { renamed: { ok: true, changed: true, was: 'Bob', now: 'Scarlet' } },
    wants: /restart it/i, forbids: null },
  { name: 'the name was already there',
    body: { renamed: { ok: true, changed: false } },
    wants: /^Saved\.$/, forbids: /restart/i },
  { name: 'the file could not be updated',
    body: { renamed: { ok: false, changed: false, because: 'its instructions changed while we were renaming it' } },
    wants: /instructions changed while we were renaming it/, forbids: /restart/i },
  { name: 'nothing about the name was sent',
    body: {},
    wants: /^Saved\.$/, forbids: /restart/i },
];

(async () => {
  const browser = await playwright.chromium.launch({ headless: !HEADED });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message)));

  let answer = CASES[0].body;
  await page.route('**/api/agent/*/profile', (r) => {
    if (r.request().method() !== 'PUT') { r.continue(); return; }
    r.fulfill({ json: { ok: true, ...answer } });
  });

  await page.goto(BASE + '/?tab=agents', { waitUntil: 'networkidle' });
  await page.waitForSelector('.acard', { timeout: 10000 });
  await page.click('.acard');
  await page.waitForSelector('#panel-detail:not([hidden])', { timeout: 8000 });
  await page.click('#d-nav button[data-go="profile"]');   // the Name field lives in Profile since agent-page-nav
  await page.waitForSelector('#d-rename', { timeout: 8000 });
  await page.waitForTimeout(400);

  const reachable = await page.evaluate(() => {
    const f = document.getElementById('d-rename');
    const b = document.getElementById('d-save');
    const r = f.getBoundingClientRect();
    f.scrollIntoView({ block: 'center' });
    const br = b.getBoundingClientRect();
    const at = document.elementFromPoint(br.left + br.width / 2, br.top + br.height / 2);
    return {
      /* ⚠️ A field, not a heading. A sibling check once read a `.value` expando
         off a span and reported a confident pass; the tell was the geometry. */
      isField: f.tagName === 'INPUT',
      wide: r.width > 60,
      pressable: Boolean(at && at.closest && at.closest('#d-save')),
    };
  });
  check('the name field is a field, and Save can be pressed',
    reachable.isField && reachable.wide && reachable.pressable, JSON.stringify(reachable));

  /* The hint under the field is a claim about what a rename touches, and it went
     incomplete the moment the rename started reaching the instruction file. */
  const hint = await page.evaluate(() => {
    const f = document.getElementById('d-rename');
    const box = f.closest('.field');
    return (box.querySelector('.fhint') || {}).textContent || '';
  });
  check('the hint says the instructions are part of a rename', /instructions/i.test(hint), `"${hint}"`);

  for (const c of CASES) {
    answer = c.body;
    await page.fill('#d-rename', 'Scarlet');
    await page.click('#d-save');
    await page.waitForFunction(() => {
      const m = document.getElementById('d-role-msg');
      return m && m.textContent && m.textContent !== 'Saving…';
    }, null, { timeout: 8000 });
    const said = await page.evaluate(() => document.getElementById('d-role-msg').textContent.trim());
    const ok = c.wants.test(said) && (!c.forbids || !c.forbids.test(said));
    check(`${c.name}: the sentence matches what happened`, ok, `"${said}"`);
  }

  check('no page errors', errors.length === 0, errors.join(' | '));

  await browser.close();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
