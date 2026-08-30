/**
 * #1573: the confirm is SKIPPED on a machine that already has a working Claude,
 * and OPENS on one that does not. Observed in a browser, which nothing did before.
 *
 * 🛑 WHY THIS CHECK COULD NOT EXIST UNTIL NOW, AND IT IS THE WHOLE POINT OF #1573.
 * Every OTHER `node ./server.js` board this gate boots sets `AGENT_WORKFORCE_DRY_RUN=1`
 * (these two are the exception, which is why they exist), and a dry-run probe returns
 * `{ok:true, dryRun:true}` WITHOUT EXECUTING. #1556 correctly scores that as
 * "we did not check", so `willInstall` is unconditionally true on a dry-run board and
 * the skip path is unreachable by construction. The gate could not see the one
 * user-visible thing #1556 delivered.
 *
 * ⭐ DRY-RUN NEUTRALISES A SUBPROCESS BY FAKING SUCCESS. THAT IS EXACTLY WHAT MAKES A
 * PROBE UNOBSERVABLE. A stub launcher neutralises it by being HARMLESS instead, which
 * costs the same and leaves the probe visible. This check runs against a board booted
 * that way: no dry-run, a stub `claude` and a stub `tmux`.
 *
 * ⚠️ TWO ARMS, AND THE SECOND IS NOT OPTIONAL. An assertion that the confirm is
 * skipped, alone, passes on any build where the confirm never opens at all. The broken
 * launcher arm is what proves the screen can still ask.
 *
 * 📌 WHAT THIS OBSERVES, STATED EXACTLY, BECAUSE THE LABELS CLAIM SLIGHTLY MORE.
 * It reads `frClaudeInstallNeeded()`, the predicate `frConnectStart` gates the confirm
 * on, against the real `FR` the real server produced. It does NOT click Connect and
 * watch a dialog: clicking on a non-dry-run board is exactly what the safety comment in
 * the runner forbids, because `create.js`'s `run()` would then really mutate the
 * operator's launchd. The predicate-to-dialog wiring is separately pinned by a
 * source-text assertion in `web.connect-confirm.test.js`.
 *
 * ⇒ So "SKIPPED" and "OPENS" in the labels below mean "the gate that decides it says
 * so", one link short of the pixels. That link is one line long and guarded elsewhere.
 *
 * Takes two base URLs: a board whose stub Claude RUNS, and one whose stub EXISTS and
 * exits non-zero.
 *
 *   node docs/browser-checks/render-connect-skip.js <works-url> <broken-url>
 */
'use strict';

const playwright = require('playwright');

const WORKS = process.argv[2];
const BROKEN = process.argv[3];
const ENGINES = ['chromium'];

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
}

/** Reads the real predicate off the real page, against the real server's answer. */
async function readBoard(browser, url) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url, { waitUntil: 'networkidle' });
  /* FR is populated by the page's own fetch of /api/first-run. Waiting for it rather
     than sleeping, because a sleep that is too short reads as "the field is absent",
     which is the same answer a real regression gives. */
  await page.waitForFunction(() => typeof FR !== 'undefined' && FR !== null, null, { timeout: 20000 });
  const seen = await page.evaluate(() => ({
    connect: FR.connect,
    installNeeded: typeof frClaudeInstallNeeded === 'function' ? frClaudeInstallNeeded() : 'MISSING',
    sentence: typeof frClaudeConfirmSentence === 'function' ? frClaudeConfirmSentence() : 'MISSING',
  }));
  await page.close();
  return { seen, errors };
}

(async () => {
  if (!WORKS || !BROKEN) {
    console.log('FAIL  render-connect-skip needs two board URLs (working launcher, broken launcher)');
    process.exit(1);
  }
  for (const engine of ENGINES) {
    /* `run_one` exports HEADED=0; honour it so a standalone HEADED=1 run behaves like
       its siblings rather than silently staying headless. */
    const browser = await playwright[engine].launch({ headless: process.env.HEADED !== '1' });

    const works = await readBoard(browser, WORKS);
    check(`[${engine}] a working Claude is reported as needing no install`,
      works.seen.connect && works.seen.connect.willInstall === false,
      JSON.stringify(works.seen.connect));
    check(`[${engine}] and the 281MB confirm is SKIPPED`,
      works.seen.installNeeded === false,
      `frClaudeInstallNeeded() = ${works.seen.installNeeded}`);
    check(`[${engine}] no page errors on the working board`,
      works.errors.length === 0, works.errors.join(' | ').slice(0, 160));

    /* The control arm. Without it, "the confirm is skipped" would also pass on a
       build where the confirm can never open, which is the pre-#1556 defect
       inverted. */
    const broken = await readBoard(browser, BROKEN);
    check(`[${engine}] a launcher that does not RUN still needs an install`,
      broken.seen.connect && broken.seen.connect.willInstall === true,
      JSON.stringify(broken.seen.connect));
    check(`[${engine}] and the confirm OPENS for it`,
      broken.seen.installNeeded === true,
      `frClaudeInstallNeeded() = ${broken.seen.installNeeded}`);
    check(`[${engine}] no page errors on the broken board either`,
      broken.errors.length === 0, broken.errors.join(' | ').slice(0, 160));
    check(`[${engine}] and it says so flatly, not with the hedge`,
      typeof broken.seen.sentence === 'string'
        && /we need to install Claude Code first/.test(broken.seen.sentence)
        && !/If it is not here already/.test(broken.seen.sentence),
      String(broken.seen.sentence).slice(0, 90));

    await browser.close();
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) { failed.forEach((f) => console.log('  - ' + f.name + '  ' + (f.detail || ''))); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
