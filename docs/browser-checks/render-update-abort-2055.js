/**
 * #2055: a silently-aborting update must SHOW ITSELF on the board, not only in
 * install.log (155 aborts on one machine, seen by nobody). The board reads
 * `updateAbort = { count, reason, port, ts } | null` off /api/status and, when a
 * marker is present with count >= 1, paints a notice in #uabort-slot that NAMES N.
 *
 * 🔑 THE CONTROL THAT MUST RETURN THE DANGEROUS ANSWER (the card's acceptance):
 * a CLEAN machine -- updateAbort null/absent -- must show NO notice. A check that
 * only ever saw the abort case would pass on a build that shows the notice always,
 * which is how 155 aborts also went unnoticed. CONTROL A asserts the slot is empty
 * on a healthy board, and it is the assertion that gives the rest meaning.
 *
 * 🔑 INJECTED, NOT MOCKED WHOLE: the field rides a REAL /api/status 200 (the
 * board's own agents/version/etc.), so tick() runs its real success path -- the
 * only path that paints this notice -- rather than a hand-built body that could
 * diverge from what the server actually sends.
 *
 * Run: see the README. Shape:
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 \
 *     node docs/browser-checks/render-update-abort-2055.js http://127.0.0.1:PORT
 * against a sandboxed board with first-run completed.
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

(async () => {
  const browser = await playwright.chromium.launch({ headless: !HEADED });

  // Inject `updateAbort` into the real /api/status 200 so tick's success path runs.
  // `inject === undefined` leaves the real (healthy) board untouched -- the clean control.
  async function slotAfter(inject) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    const page = await ctx.newPage();
    await page.route('**/api/status*', async (route) => {
      const resp = await route.fetch();
      let json;
      try { json = await resp.json(); } catch { return route.fulfill({ response: resp }); }
      if (inject !== undefined) json.updateAbort = inject;
      await route.fulfill({ response: resp, json });
    });
    await page.goto(BASE + '/?tab=agents', { waitUntil: 'networkidle' });
    await page.waitForTimeout(700); // let a poll paint
    const txt = await page.evaluate(() => (document.getElementById('uabort-slot') || {}).textContent || '');
    await ctx.close();
    return txt;
  }

  // ---- Scenario 1: a stuck machine (count 3) shows the notice and NAMES N.
  const s3 = await slotAfter({ count: 3, reason: 'board-would-not-pause', port: 16180, ts: '2026-09-03T00:00:00Z' });
  check('abort count 3: the board shows the update-stuck notice with its title', /new version of Kosmos is ready/i.test(s3), s3.slice(0, 120));
  check('abort count 3: it NAMES the count ("tried to install it 3 times")', /tried to install it 3 times/i.test(s3), s3.slice(0, 200));
  check('abort count 3: it reassures the agents keep working', /agents keep working/i.test(s3), s3.slice(0, 240));
  check('abort count 3: the action is quit-and-reopen, never a type instruction or a dead "Update now"', /quit and reopen Kosmos/i.test(s3) && !/paste|install line|kosmos stop|in a terminal|run this|update now/i.test(s3), s3.slice(0, 280));

  // ---- Scenario 2: count 1 reads "install it once", not "1 times".
  const s1 = await slotAfter({ count: 1, reason: 'board-would-not-pause', port: 16180, ts: '' });
  check('abort count 1: reads "install it once", not "1 times"', /install it once/i.test(s1) && !/1 times/.test(s1), s1.slice(0, 160));

  // ---- CONTROL A (the dangerous answer): a CLEAN board shows NOTHING.
  const clean = await slotAfter(undefined);
  check('CONTROL clean: a healthy board (no updateAbort) shows no notice', clean.trim() === '', JSON.stringify(clean.slice(0, 80)));

  // ---- CONTROL B: an explicit null (a machine that recovered) clears the notice.
  const nulled = await slotAfter(null);
  check('CONTROL null: an explicit null updateAbort shows nothing', nulled.trim() === '', JSON.stringify(nulled.slice(0, 80)));

  // ---- CONTROL C: a garbage (non-finite) count shows nothing, never "failed NaN times".
  const garbage = await slotAfter({ count: 'lots', reason: 'x' });
  check('CONTROL garbage: a non-numeric count shows nothing (never NaN)', garbage.trim() === '' && !/NaN/.test(garbage), JSON.stringify(garbage.slice(0, 80)));

  await browser.close();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) {
    console.log('FAILED: ' + failed.map((r) => r.name).join(', '));
    process.exit(1);
  }
})().catch((e) => {
  console.error('render-update-abort-2055 threw: ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
