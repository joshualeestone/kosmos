'use strict';

/**
 * The add-a-provider OpenAI key step is formatted like the Claude connect callout (#2164), not flat grey.
 *
 * 🔑 A RENDERED CHECK IS THE ONLY KIND THAT CAN SEE THIS. Josh's complaint was
 * that the OpenAI key explanation was "just gray text that is not formatted in
 * any way" beside the Claude flow's marked, bold, full-ink callout. The fix is a
 * class swap (.dhint -> .dwarn) plus a marker and a bold lead, and the property
 * that matters is COMPUTED: the OpenAI callout now renders in the same ink as the
 * Claude one and NOT in the muted grey .dhint tone. A source read cannot compare
 * two computed colours; only a browser can.
 *
 *   node docs/browser-checks/render-openai-key-callout-2164.js <url>
 *
 * Read-only: it forces the add-a-provider modal and both flows visible to read
 * their computed styles (the colour a CSS rule produces does not depend on how
 * the element was revealed), and never POSTs, so it needs no sandbox.
 */
const { chromium } = require('playwright');
(async () => {
  const URL = process.argv[2] || process.env.KOSMOS_URL || 'http://127.0.0.1:17471';
  const b = await chromium.launch({ headless: process.env.HEADED === '0' });
  const fails = [];
  const say = (ok, l, x) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + l + (x ? '  ' + x : '')); if (!ok) fails.push(l); };
  const pg = await b.newPage({ viewport: { width: 1200, height: 1000 } });
  pg.on('pageerror', (e) => say(false, 'page error: ' + e.message));
  try {
    await pg.goto(URL + '/?tab=settings', { waitUntil: 'networkidle' });
    if (!(await pg.$('#firstrun[hidden]'))) { await pg.keyboard.press('Escape'); await pg.waitForTimeout(400); }
    // Force the modal and both flows visible so their callouts are laid out and
    // their computed colours are readable. This does not mutate anything.
    await pg.evaluate(() => {
      const un = (id) => { const e = document.getElementById(id); if (e) e.hidden = false; };
      un('acct-add-modal'); un('acct-add-dialog'); un('acct-claude-flow'); un('acct-openai-flow'); un('acct-openai-key-step');
      const inst = document.getElementById('acct-openai-install'); if (inst) inst.hidden = true;
    });
    await pg.waitForTimeout(200);

    const OA = '#acct-openai-key-step > p.dwarn';
    const CL = '#acct-claude-warn';
    const colorOf = (sel) => pg.$eval(sel, (el) => getComputedStyle(el).color).catch(() => 'missing');
    const weightOfLead = (sel) => pg.$eval(sel + ' b', (el) => getComputedStyle(el).fontWeight).catch(() => 'missing');

    // The OpenAI explanation is now the .dwarn callout, with a marker and a bold lead.
    say((await pg.$(OA)) !== null, 'the OpenAI key explanation is a .dwarn callout (not .dhint)');
    say((await pg.$('#acct-openai-key-step > p.dwarn > .dwarn-ok')) !== null, 'it carries the marker glyph (the "checkbox")');
    say((await pg.$(OA + ' b')) !== null, 'its lead sentence is bold');

    // Parity: its ink matches the Claude connect callout beside it...
    const oaColor = await colorOf(OA);
    const clColor = await colorOf(CL);
    say(oaColor !== 'missing' && oaColor === clColor, 'its text colour matches the Claude callout (full ink, formatted alike)', oaColor + ' vs ' + clColor);

    // ...and is NOT the muted grey .dhint tone the screen still uses elsewhere,
    // which is the exact "just gray text" Josh flagged. This control proves the
    // colour read can tell formatted from muted; without a difference here the
    // parity line above could pass on two identically-grey callouts.
    const hintColor = await colorOf('#acct-openai-key-step .dhint');
    say(hintColor !== 'missing' && hintColor !== oaColor, 'the callout is NOT the muted .dhint grey (a real, still-present control on the same screen)', 'callout ' + oaColor + ' vs hint ' + hintColor);

    // Positive control for the structure assertions: the Claude callout it mirrors
    // has its own marker and bold lead, so the shape being asserted is real.
    say((await pg.$(CL + ' .dwarn-m')) !== null, 'control: the Claude callout has its own marker');
    say((await weightOfLead(CL)) === '700' || (await weightOfLead(CL)) === 'bold', 'control: the Claude callout lead is bold', String(await weightOfLead(CL)));
    say((await weightOfLead(OA)) === '700' || (await weightOfLead(OA)) === 'bold', 'the OpenAI callout lead is bold too', String(await weightOfLead(OA)));
  } finally {
    await b.close();
  }
  console.log(fails.length ? 'FAILED: ' + fails.join(', ') : 'all good');
  process.exit(fails.length ? 1 : 0);
})();
