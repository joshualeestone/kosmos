// Browser-check-surface: heavy-slot
/**
 * kosmos#9217: when an agent says a heavy job is running (`kosmos heavy start`), the board's top notes show one line
 * naming the job, whose it is and since when, in #heavy-slot. /api/status carries `heavyJobs: [{agent,label,since}]`,
 * already cleared by engine/heavyjobs.js of a record whose process or agent is gone.
 *
 * 🔑 THE CONTROL THAT CAN RETURN THE DANGEROUS ANSWER: a board with nothing running must show NO line and the slot
 * must take no space (CSS :empty). A check that only saw the running case would pass a build that always shows it.
 *
 * INJECTED, NOT MOCKED WHOLE: the field rides the board's REAL /api/status 200, so tick() runs its real success path,
 * modelled on render-update-abort-2055.js.
 *
 * Run: NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-heavy-9217.js http://127.0.0.1:PORT
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

  // `inject === undefined` leaves the real board's heavyJobs untouched (the board under test runs none).
  async function slotAfter(inject) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    const page = await ctx.newPage();
    await page.route('**/api/status*', async (route) => {
      try {
        const resp = await route.fetch();
        const NOT_JSON = Symbol('not json');
        const json = await resp.json().catch(() => NOT_JSON);
        if (json === NOT_JSON) return await route.fulfill({ response: resp });
        if (inject !== undefined) json.heavyJobs = inject;
        await route.fulfill({ response: resp, json });
      } catch { await route.abort().catch(() => {}); }
    });
    await page.goto(BASE + '/?tab=agents', { waitUntil: 'networkidle' });
    await page.waitForTimeout(700); // let a poll paint
    const got = await page.evaluate(() => {
      const s = document.getElementById('heavy-slot');
      if (!s) return null;
      const r = s.getBoundingClientRect();
      return { text: s.textContent || '', display: getComputedStyle(s).display, h: r.height, tags: [...s.querySelectorAll('*')].map((e) => e.tagName) };
    });
    await ctx.close();
    return got;
  }

  const since = new Date(2026, 10, 27, 9, 5).getTime(); // the browser runs in this machine's zone, so 09:05 local

  const one = await slotAfter([{ agent: 'Angel', label: 'cargo test (kosmos-relay)', since }]);
  check('the board has a #heavy-slot', one !== null);
  if (one) {
    check('one job: the line names the job, whose it is and since when',
      one.text === 'A heavy job is running on this computer: cargo test (kosmos-relay) (Angel, since 09:05).', JSON.stringify(one.text));
    check('one job: the line is shown and takes space', one.display !== 'none' && one.h > 0, `display=${one.display} h=${one.h}`);
  }

  const two = await slotAfter([{ agent: 'Angel', label: 'cargo test', since }, { agent: 'Mona Lisa', label: 'full suite', since }]);
  check('two jobs: one plural line naming both',
    !!two && two.text === 'Heavy jobs are running on this computer: cargo test (Angel, since 09:05); full suite (Mona Lisa, since 09:05).', JSON.stringify(two && two.text));

  const tagged = await slotAfter([{ agent: 'Angel', label: '<b>bold</b><img src=x>', since }]);
  check('a label with markup stays text: no B or IMG element in the slot',
    !!tagged && /<b>bold<\/b>/.test(tagged.text) && !tagged.tags.includes('B') && !tagged.tags.includes('IMG'), JSON.stringify(tagged && tagged.tags));

  // CONTROL (the dangerous answer): the real board, which runs no heavy job, shows nothing and the slot takes no space.
  const clean = await slotAfter(undefined);
  check('CONTROL nothing running: no line, and the empty slot is hidden', !!clean && clean.text === '' && clean.display === 'none' && clean.h === 0,
    JSON.stringify(clean));
  const empty = await slotAfter([]);
  check('CONTROL an empty list: no line', !!empty && empty.text === '' && empty.display === 'none', JSON.stringify(empty));

  await browser.close();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) {
    console.log('FAILED: ' + failed.map((r) => r.name).join(', '));
    process.exit(1);
  }
})().catch((e) => {
  console.error('render-heavy-9217 threw: ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
