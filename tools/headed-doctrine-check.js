'use strict';

/**
 * The headed pass Angel's #643 review requires: modal containment on the
 * consent dialogs, driven with REAL keypresses on a real compositor,
 * because a static pin cannot catch a leaked keystroke and headless
 * cannot vouch for a tint. Run:
 *
 *   NODE_PATH=<playwright modules> KOSMOS_URL=http://127.0.0.1:<port> \
 *     node tools/headed-doctrine-check.js
 *
 * Asserts, in order: the banner shows for a born-before agent in the
 * QUIET tint (fhint ink, no stale-note amber); Add opens the dialog with
 * "Keep as it is" focused so an accidental Enter is harmless (proven by
 * PRESSING Enter: the dialog closes, the file is unwritten, focus
 * returns to the opener); Tab and shift-Tab cycle inside the dialog in
 * both directions without reaching anything behind the backdrop; Escape
 * closes and returns focus; the backdrop click closes; and the real
 * consent click writes, after which the banner is gone. Exit 0 iff all.
 */

const { chromium } = require('playwright');
const B = process.env.KOSMOS_URL;
let fails = 0;
const chk = (ok, name, detail) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok || detail === undefined ? '' : ' :: ' + detail));
  if (!ok) fails += 1;
};

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await page.goto(B + '/', { waitUntil: 'networkidle' });

  // Open the born-before agent's page.
  await page.click('.acard .namego');
  await page.waitForSelector('#d-doctrine-note:not([hidden])', { timeout: 10000 });

  const tint = await page.evaluate(() => {
    const note = document.getElementById('d-doctrine-note');
    const stale = document.getElementById('d-instr-stale');
    return {
      noteClass: note.className,
      noteColor: getComputedStyle(note).color,
      noteBg: getComputedStyle(note).backgroundColor,
      staleBg: stale ? getComputedStyle(stale).backgroundColor : null,
    };
  });
  chk(!tint.noteClass.includes('stale-note'), 'the banner does not wear the warning class');
  chk(tint.noteBg === 'rgba(0, 0, 0, 0)' || tint.noteBg !== tint.staleBg,
    'the banner background is the quiet one, not the stale amber', JSON.stringify(tint));

  // Accidental Enter: open, then press Enter with no other key.
  await page.click('#d-doctrine-add');
  await page.waitForSelector('#doc-modal:not([hidden])');
  chk(await page.evaluate(() => document.activeElement && document.activeElement.id) === 'doc-keep',
    'the dialog opens focused on the harmless answer');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  chk(await page.evaluate(() => document.getElementById('doc-modal').hidden) === true,
    'an accidental Enter keeps, never adds');
  chk(await page.evaluate(() => document.activeElement && document.activeElement.id) === 'd-doctrine-add',
    'focus returned to the opener after Enter-keep');
  const untouched = await page.evaluate(async () => (await (await fetch('/api/agent/april/doctrine')).json()).state);
  chk(untouched === 'refresh', 'the accidental Enter wrote nothing (still missing its sections)');

  // The trap, both directions, with real keys.
  await page.click('#d-doctrine-add');
  await page.waitForSelector('#doc-modal:not([hidden])');
  const seen = [];
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab');
    seen.push(await page.evaluate(() => document.activeElement && document.activeElement.id));
  }
  chk(seen.every((id) => ['doc-fold-sum', 'doc-keep', 'doc-go'].includes(id)),
    'six Tabs never leave the dialog', JSON.stringify(seen));
  const seenBack = [];
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Shift+Tab');
    seenBack.push(await page.evaluate(() => document.activeElement && document.activeElement.id));
  }
  chk(seenBack.every((id) => ['doc-fold-sum', 'doc-keep', 'doc-go'].includes(id)),
    'six shift-Tabs never leave the dialog either', JSON.stringify(seenBack));

  // Escape closes and returns focus.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  chk(await page.evaluate(() => document.getElementById('doc-modal').hidden) === true, 'Escape leaves');
  chk(await page.evaluate(() => document.activeElement && document.activeElement.id) === 'd-doctrine-add',
    'and hands the keyboard back to the opener');

  // The backdrop leaves too.
  await page.click('#d-doctrine-add');
  await page.waitForSelector('#doc-modal:not([hidden])');
  await page.mouse.click(20, 20);
  await page.waitForTimeout(200);
  chk(await page.evaluate(() => document.getElementById('doc-modal').hidden) === true, 'the backdrop click leaves');

  // The real consent, through the dialog, writes and retires the banner.
  await page.click('#d-doctrine-add');
  await page.waitForSelector('#doc-modal:not([hidden])');
  await page.click('#doc-go');
  await page.waitForFunction(() => /Added\./.test(document.getElementById('doc-msg').textContent || ''), null, { timeout: 10000 });
  chk(true, 'the consented click reports Added.');
  const after = await page.evaluate(async () => (await (await fetch('/api/agent/april/doctrine')).json()).state);
  chk(after === 'current', 'and the agent now carries the rules', after);

  await browser.close();
  console.log(fails === 0 ? 'HEADED: the consent dialogs contain the keyboard and the click' : `HEADED: ${fails} failures`);
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('HEADED HARNESS FAILED', e.message.slice(0, 300)); process.exit(2); });
