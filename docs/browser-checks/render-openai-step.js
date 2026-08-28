/**
 * The OpenAI install step, brought to parity with Claude's (#1205).
 *
 * 🔑 THREE OF THE FOUR ASSERTIONS HERE CANNOT BE MADE FROM SOURCE. The copy and
 * the button labels are greppable; "the status line is too big" is a COMPARISON
 * between two computed font sizes, and "there is an indicator while it installs"
 * is about an element that only exists after a click.
 *
 * ⚠️ IT ASSERTS PAINT BEFORE IT ASSERTS SIZE. A hidden element computes a font
 * size perfectly well while being invisible, so a size comparison on something
 * nobody can see is true and worthless. Both elements must have real boxes.
 *
 * 📌 The bar is deliberately INDETERMINATE and this check pins that it makes no
 * width claim: the OpenAI install emits no progress, so a filling bar would be a
 * percentage nobody measured. `render-conn-url.js` is its sibling for the Claude
 * side of the same wizard.
 *
 * Run: see the README in this directory.
 *   NODE_PATH="$PW/node_modules" node docs/browser-checks/render-openai-step.js http://127.0.0.1:PORT
 */
'use strict';

const playwright = require('playwright');

const BASE = process.argv[2] || 'http://127.0.0.1:4399';
const ENGINES = ['chromium', 'webkit'];

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
}

(async () => {
  for (const engine of ENGINES) {
    const browser = await playwright[engine].launch({ headless: true });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });

    const seen = await page.evaluate(() => {
      const block = document.getElementById('fr-openai-confirm');
      if (!block) return { missing: true };
      for (let n = block; n; n = n.parentElement) {
        n.removeAttribute('hidden');
        if (getComputedStyle(n).display === 'none') n.style.display = 'block';
      }
      const title = document.getElementById('fr-openai-confirm-t');
      const go = document.getElementById('fr-openai-confirm-go');
      const no = document.getElementById('fr-openai-confirm-no');
      const msg = document.getElementById('fr-openai-confirm-msg');
      const bar = document.getElementById('fr-openai-confirm-bar');
      /* ⚠️ The BAR is deliberately not required here. It is the element this
         change ADDS, so gating reachability on it makes the check fail on an
         unfixed build for a structural reason and never exercise the copy, the
         labels or the size -- a control that proves only that the check can go
         red. The four assertions that CAN run on any build must run on any
         build, and the bar gets its own assertion below. */
      if (!title || !go || !no || !msg) return { incomplete: true };
      msg.textContent = 'Installing… this screen will move on when it is done.';
      if (bar) bar.hidden = false;
      const rect = (el) => { const r = el.getBoundingClientRect(); return { w: r.width, h: r.height }; };
      const fs = (el) => getComputedStyle(el).fontSize;
      const fill = bar ? bar.querySelector('i') : null;
      return {
        copy: title.textContent.trim(),
        go: go.textContent.trim(),
        no: no.textContent.trim(),
        titleBox: rect(title), msgBox: rect(msg),
        barBox: bar ? rect(bar) : { w: 0, h: 0 }, hasBar: Boolean(bar),
        titleFs: fs(title), msgFs: fs(msg),
        barWidthStyle: fill ? (fill.style.width || '') : null,
        hasFill: Boolean(fill),
      };
    });

    if (seen.missing || seen.incomplete) {
      check(`${engine}: the OpenAI confirm step is reachable`, false, JSON.stringify(seen));
      await browser.close();
      continue;
    }

    // PAINT FIRST. A size comparison on invisible elements is true and worthless.
    const painted = seen.titleBox.w > 0 && seen.titleBox.h > 0 && seen.msgBox.w > 0 && seen.msgBox.h > 0;
    check(`${engine}: the step's title and status line are painted`, painted,
      `title ${Math.round(seen.titleBox.w)}x${Math.round(seen.titleBox.h)}, status ${Math.round(seen.msgBox.w)}x${Math.round(seen.msgBox.h)}`);
    if (!painted) { await browser.close(); continue; }

    check(`${engine}: the copy is the sentence Josh asked for`,
      seen.copy === 'In order to connect to OpenAI GPT we need to download the installer.', seen.copy);
    check(`${engine}: the buttons are Confirm and Not now`,
      seen.go === 'Confirm' && seen.no === 'Not now', `"${seen.go}" / "${seen.no}"`);
    check(`${engine}: the status line is not bigger than the line above it`,
      parseFloat(seen.msgFs) <= parseFloat(seen.titleFs), `title ${seen.titleFs}, status ${seen.msgFs}`);
    check(`${engine}: an indicator is drawn while installing`,
      seen.hasBar && seen.barBox.w > 0 && seen.barBox.h > 0,
      seen.hasBar ? `bar ${Math.round(seen.barBox.w)}x${Math.round(seen.barBox.h)}` : 'no indicator element exists');
    check(`${engine}: the indicator makes no progress CLAIM`,
      seen.hasFill && seen.barWidthStyle === '', `inline width: "${seen.barWidthStyle}"`);

    await browser.close();
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
