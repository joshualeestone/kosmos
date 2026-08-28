/**
 * The last step of Create an agent: what a person sees while it is being made,
 * and what they are handed when it is.
 *
 * 🔑 IT DRIVES THE REAL CREATE BUTTON, which is the only way to reach this
 * screen, so the server MUST be in dry run. See the README.
 *
 * ⚠️ AND IT ANSWERS `/api/status` ITSELF FOR THE SUCCESS RUN. A dry-run
 * creation writes nothing and starts nothing, so the board can never see the
 * agent and the flow would always take its timed-out branch. The invitation is
 * shown only when the board HAS seen it running, which is the behaviour most
 * worth pinning, so the roster is answered with an agent it can see. Everything
 * else on the page is the real thing.
 *
 * 🛑 THE ONE ASSERTION THAT IS ABOUT TRUTH RATHER THAN LAYOUT: the mark
 * completes into a tick on the success branch and NOT on the timed-out one. A
 * mark that finished on a timer would be a check that cannot fail, which is the
 * shape this whole screen exists to refuse.
 *
 * Run: see the README in this directory.
 */
'use strict';

const { chromium } = require('playwright');

const BASE = process.argv[2] || 'http://127.0.0.1:4399';

/* 🛑 IT REFUSES TO RUN WITHOUT A DELIBERATE ACT, because it presses the real
   Create button and the server has no way to tell a caller it is in dry run.
   Against an ordinary board this would spawn a session and install a launch job
   for an agent nobody asked for. A flag is not proof -- nothing here can prove
   it -- but it is the difference between a mistake and a decision. */
if (process.argv[3] !== '--yes-dry-run') {
  console.error('render-create-made.js presses Create for real.');
  console.error('Start the server with AGENT_WORKFORCE_DRY_RUN=1 and every root sandboxed,');
  console.error('then re-run with: node docs/browser-checks/render-create-made.js <base> --yes-dry-run');
  process.exit(2);
}

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
}

/* The roster answer that makes the board able to see the new agent. */
const SEEN = `(() => {
  const real = window.fetch;
  window.fetch = async (u, o) => {
    const res = await real(u, o);
    if (String(u).startsWith('/api/status')) {
      const j = await res.clone().json().catch(() => null);
      if (j) {
        j.agents = (j.agents || []).concat([{ sessionName: 'anna', name: 'Anna',
          isAgentSession: true, isNamedOurs: true, state: 'idle' }]);
        return new Response(JSON.stringify(j), { status: 200,
          headers: { 'content-type': 'application/json' } });
      }
    }
    return res;
  };
})()`;

/* A canvas that has had something drawn on it, and roughly what colour. Reading
   pixels is the only way to tell a finished mark from a working one: both are
   the same element with the same size at the same place. */
const INK = `(() => {
  const cv = document.getElementById('made-mark');
  const g = cv.getContext('2d');
  const d = g.getImageData(0, 0, cv.width, cv.height).data;
  let n = 0; let r = 0; let gg = 0; let b = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 40) continue;
    n += 1; r += d[i]; gg += d[i + 1]; b += d[i + 2];
  }
  return n ? { n, r: r / n, g: gg / n, b: b / n } : { n: 0 };
})()`;

async function makeAnna(page, { seen }) {
  await page.goto(BASE + '/?tab=create', { waitUntil: 'load' });
  await page.waitForSelector('#pick-pm:not([hidden])', { timeout: 8000 });
  if (seen) await page.evaluate(SEEN);
  await page.evaluate(() => {
    document.getElementById('pick-pm').click();
    document.getElementById('role-next').click();
  });
  await page.waitForTimeout(300);
  await page.fill('#create-name', 'Anna');
  await page.click('#create-go');
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message)));

  /* ---- while it is being made ------------------------------------------ */
  await makeAnna(page, { seen: true });
  await page.waitForTimeout(500);

  const early = await page.evaluate((inkSrc) => {
    const step = document.getElementById('cstep-made');
    const cs = getComputedStyle(step);
    const rows = Array.from(step.querySelectorAll('.tick'));
    const box = step.getBoundingClientRect();
    return {
      onScreen: !step.hidden && box.width > 0,
      /* No card: the page ground shows through and no border is drawn. */
      bordered: parseFloat(cs.borderTopWidth) > 0 || cs.boxShadow !== 'none',
      centred: Math.abs((box.left + box.right) / 2 - window.innerWidth / 2) < 24,
      head: document.getElementById('made-head').textContent,
      rows: rows.length,
      working: rows.filter((r) => r.classList.contains('working')).length,
      markInk: eval(inkSrc).n,
      helloHidden: document.getElementById('made-hello').hidden,
      /* The background-item explanation is gone from the page entirely. */
      bg: Boolean(document.getElementById('made-bg')),
    };
  }, INK);

  check('the last step is on screen and centred', early.onScreen && early.centred);
  check('it is not in a card any more', !early.bordered);
  check('it is headed with the name being made', /making anna/i.test(early.head), JSON.stringify(early.head));
  check('the mark is drawing something', early.markInk > 200, `${early.markInk} lit pixels`);
  check('the rows arrive one at a time, so some are still working',
    early.rows > 0 && early.working > 0, `${early.working} of ${early.rows} still working`);
  check('the invitation is NOT offered while it is still being made', early.helloHidden);
  check('the background-item explanation is gone', !early.bg);

  /* ---- and when the board can see it ------------------------------------ */
  /* 🛑 WAIT FOR THE SCREEN TO SETTLE, NOT FOR 4.2 SECONDS (#913). This was a
     fixed sleep, which is a bet that the making finishes in that time. Under
     load it does not, every assertion below then reads a screen that is still
     working, and the runner's retry passes on a quieter second attempt -- the
     exact "fails once, passes on retry" this card was opened about. The screen
     was never the racy half; the check was.
     ⭐ THE SETTLED CONDITION IS THE FILE'S OWN: the assertion four lines above
     says the invitation is NOT offered while it is still being made, so the
     invitation appearing IS completion. No new concept, just waited for.
     ⚠️ AND IT FAILS LOUDLY IF IT NEVER SETTLES rather than falling through to
     assert on a half-built screen, which would report the timeout as whichever
     assertion happened to notice first.
     🛑 THE SLEEP IN THE "never sees it" ARM BELOW MUST STAY A SLEEP. That one
     asserts a NEGATIVE, and you cannot wait for nothing to happen: replacing
     it would make the file's own control vacuous. The two sleeps look
     identical and only one of them may be touched. */
  /* 🛑 TWO CONDITIONS, AND MY FIRST VERSION ONLY WAITED FOR THE FIRST. Waiting
     for the invitation alone made "the mark has turned into a green tick" fail:
     the invitation appears BEFORE the mark finishes animating, and the 4.2s
     sleep had been covering both. Caught by running the unmodified check
     through the same harness: 18 pass / 0 fail against my 17 / 1.
     ⚠️ AND THE MARK IS NOT WAITED FOR BY COLOUR, DELIBERATELY. Waiting for it
     to be green and then asserting it is green cannot fail: it would time out
     instead, and a timeout is not a verdict about the product. So the wait is
     for the drawing to STOP CHANGING, and the assertion below still decides
     whether what it settled on is a green tick. */
  try {
    await page.waitForFunction(
      () => { const h = document.getElementById('made-hello'); return h && !h.hidden; },
      null, { timeout: 20000 });
  } catch {
    check('the making screen offered the invitation within 20s, so the assertions below mean something',
      false, 'it never appeared; everything after this would be reading a screen still being made');
  }
  {
    // The mark is a canvas/animation: settled means two identical samples.
    const sample = () => page.evaluate((src) => JSON.stringify(eval(src)), INK);
    let prev = await sample();
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(150);
      const now = await sample();
      if (now === prev) break;
      prev = now;
    }
  }
  const done = await page.evaluate((inkSrc) => {
    const step = document.getElementById('cstep-made');
    const rows = Array.from(step.querySelectorAll('.tick'));
    const go = document.getElementById('made-hello-go');
    return {
      head: document.getElementById('made-head').textContent,
      labels: rows.map((r) => r.textContent.replace(/^[^a-z]*/i, '')),
      working: rows.filter((r) => r.classList.contains('working')).length,
      hello: document.getElementById('made-hello').hidden
        ? null : document.getElementById('made-hello-say').textContent,
      btn: go.textContent,
      goesTo: go.dataset.agent,
      /* 4bf7d95 removed the See-it-under-Agents button outright (the two
         endings that are not success got true offers); the assertion is
         now that no such button exists, not that a hidden one is hidden. */
      noDoneButton: !document.getElementById('made-done'),
      ink: eval(inkSrc),
    };
  }, INK);

  check('every row has resolved', done.working === 0);
  /* 🔑 FIVE ROWS, AND THE COUNT IS THE ASSERTION. Josh asked for the project
     rows and the board-watch row to go; a check that only looked at the five it
     wanted would pass with a sixth sitting underneath them. */
  check('five rows, and only five', done.labels.length === 5, done.labels.join(' | '));
  check('none of them is about a project or about the board watching',
    !done.labels.some((l) => /project|board/i.test(l)), done.labels.join(' | '));
  check('the heading becomes the agent running', /anna is running/i.test(done.head),
    JSON.stringify(done.head));
  /* 🛑 THE COPY REVERSED ON 2026-08-22 AND THIS CHECK IS THE RECORD OF WHY. It
     asserted the invitation did NOT say "activate": an agent is running from the
     moment it is made and has simply never been given anything to do, so the
     word describes a switch that is not there. Mona Lisa ruled it, I built it,
     and Josh overruled us both with the only evidence anybody had -- ten agents
     of his own: "Unless I go say hello to them, they don't start."
     ⚠️ SO THE ASSERTION IS INVERTED RATHER THAN DELETED. If the mechanism is ever
     pinned down and the word turns out to be wrong after all, this line is where
     the argument is kept. */
  /* #858 (Josh, 2026-08-25 10:28): "Let's put 'hello' in quotation marks
     so it's like 'Say "hello" to your agent to activate it on Kosmos'." */
  check('the invitation asks for the hello, in his words, "hello" quoted as he asked',
    done.hello && /say .hello. to your agent to activate it on kosmos/i.test(done.hello),
    JSON.stringify(done.hello));
  check('the button names the agent, with the capital he asked for',
    done.btn === 'Say Hello to Anna' && done.goesTo === 'anna', JSON.stringify(done.btn));
  /* One button on the success path: no "See it under Agents" sending somebody
     back to a list to find the agent they just made. */
  check('the only way on is straight to the agent: no See-it-under-Agents button exists', done.noDoneButton === true,
    `a made-done element is on the page again`);
  /* The mark completed: same dots, now green. */
  check('the mark has turned into a green tick',
    done.ink.n > 200 && done.ink.g > done.ink.r + 20 && done.ink.g > done.ink.b + 20,
    `r${Math.round(done.ink.r)} g${Math.round(done.ink.g)} b${Math.round(done.ink.b)} over ${done.ink.n}px`);

  /* ---- and when the board never sees it --------------------------------- */
  /* 🛑 THE CONTROL FOR THE LINE ABOVE. Without it, a mark that completed on a
     timer would pass every assertion in this file. Dry run creates nothing, so
     leaving the roster alone is exactly the "it never came up" case. */
  await makeAnna(page, { seen: false });
  await page.waitForTimeout(4200);
  const never = await page.evaluate((inkSrc) => ({
    hello: document.getElementById('made-hello').hidden,
    ink: eval(inkSrc),
  }), INK);
  check('an agent the board never sees is not offered a greeting', never.hello);
  check('and its mark does NOT complete into a tick',
    never.ink.n > 0 && !(never.ink.g > never.ink.r + 20),
    `r${Math.round(never.ink.r)} g${Math.round(never.ink.g)} b${Math.round(never.ink.b)}`);

  check('no page errors', errors.length === 0, errors.join(' | ').slice(0, 160));
  await browser.close();

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) { failed.forEach((f) => console.log('  - ' + f.name + '  ' + (f.detail || ''))); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
