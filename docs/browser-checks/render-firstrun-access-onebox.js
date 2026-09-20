/**
 * Screen 2 (Access) shows ONE macOS-style permission preview: "Kosmos" would like
 * to access files. #2910 introduced a six-ask layout (three folders x two apps,
 * framed as "Terminal"); #2685 relabelled the file-access app "Terminal" -> "tmux"
 * (Kosmos ships and launches its own bundled tmux, the process macOS holds
 * responsible for agent FILE access, engine/fileaccessstatus.js, so it is the name
 * on the real folder prompts). #3031 (Josh 2026-09-14) cut the six previews to two,
 * one per app (Kosmos + tmux). 2026-09-19 (Josh, 0.6.81 QA) removed the tmux
 * preview box, leaving ONE "Kosmos" preview.
 * This check covers the FILE-access screen only; the accessibility step (S3) is
 * separate and this check does not assert it.
 *
 * FILENAME IS HISTORICAL. This check began at 0.6.39 #8 asserting ONE box
 * ("onebox") that replaced a three-card fan; #2910 grew it to six, #3031 settled it
 * at two, and Josh's 0.6.81 simplification returns it to ONE. The name is kept so
 * the browser-check surface map / count gates do not churn on a rename.
 *
 * #3336 (Josh 6.83): the preview is now a SMALL icon+text prompt. Its mock Don't
 * Allow / Allow buttons were REMOVED, and the box was shrunk (~1/3 the old width,
 * ~1/2 the old height) with the caption wrapped to two lines ("Kosmos" would like /
 * to access files.). The real, focusable grant path is unchanged -- the
 * `.s2-gate-row` Allow Access button, whose click wiring this check does not assert
 * (pinned in engine/machine.a11y-1344.test.js). So the old button/wrap/mock/ring
 * arms are gone; this check now asserts the buttons are ABSENT and the box is small.
 *
 * WHY A SOURCE TEST CANNOT SEE THE SIZE (or the compact copy weight). The shrunk
 * box width and the caption's compact 600-weight size are computed layout/cascade
 * results; a rule that loses the cascade reads in the diff like a rule that works,
 * so only the computed style / rendered rect tells them apart.
 *
 * Arms:
 *  1. STRUCTURE: exactly one `.s2-dlg`, no `.s2-appgrp` groups, no `.s2-applbl`.
 *  2. NAME: the preview names Kosmos, NOT tmux, NOT Terminal.
 *  3. GENERIC 2-LINE COPY: the caption is "\"Kosmos\" would like<br>to access files.",
 *     with no per-folder text and the old "...in your folders." line gone.
 *  4. TRIMMED (#3031 items 4/5/6): the group micro-note and folder-count labels are gone.
 *  5. COMPACT COPY: the caption renders at the compact dialog size (~12-14px, weight 600),
 *     not the 17px/400 first-run body.
 *  6. NO BUTTONS (#3336): the preview renders NO `.s2-db` buttons (no Don't Allow / Allow
 *     mock inside the demo box).
 *  7. SHRUNK BOX (#3336): the `.s2-dlg` is a small fixed box (rendered width well under the
 *     old pane-filling size), not the wide box that used to hold the buttons.
 *
 * HERMETIC: loads web/index.html over file://, boots no server. Everything it
 * reads is static markup + computed style, so it sits in the browser-checks.sh
 * `for n in` loop with no URL and no board.
 *
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-firstrun-access-onebox.js
 *   (HEADED by default; HEADED=0 on a console-less machine, as run_one sets it.)
 */
'use strict';

const nodePath = require('node:path');

let playwright;
try { playwright = require('playwright'); }
catch {
  console.log('render-firstrun-access-onebox: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}

const PAGE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');
const ENGINES = ['chromium', 'webkit'];

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
}

(async () => {
  for (const engine of ENGINES) {
    const browser = await playwright[engine].launch({ headless: process.env.HEADED === '0' });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    const page = await ctx.newPage();
    await page.goto('file://' + PAGE);

    // The first-run overlay and fr-pane-2 are hidden on a set-up board. Unhide the
    // chain up from the dialog fan so it has real layout for the computed-style read.
    const pre = await page.evaluate(() => {
      const fan = document.querySelector('#fr-pane-2 .s2-dlg-fan') || document.querySelector('.s2-dlg-fan');
      if (!fan) return { noFan: true };
      for (let n = fan.parentElement; n; n = n.parentElement) {
        n.removeAttribute('hidden');
        if (getComputedStyle(n).display === 'none') n.style.display = 'block';
      }
      return { ok: true };
    });
    if (!pre.ok) {
      check(`${engine}: the access dialog previews are reachable`, false, JSON.stringify(pre));
      await browser.close();
      continue;
    }

    const state = await page.evaluate(() => {
      const fan = document.querySelector('#fr-pane-2 .s2-dlg-fan') || document.querySelector('.s2-dlg-fan');
      const dlgs = fan ? Array.from(fan.querySelectorAll('.s2-dlg')) : [];
      const says = dlgs.map((d) => { const p = d.querySelector('.s2-say'); return p ? p.textContent.trim() : ''; });
      // #3336: the caption is two lines via <br>, so textContent has no space at the break
      // ("would liketo access files"); read innerHTML to pin the exact 2-line structure.
      const sayEl = fan ? fan.querySelector('.s2-say') : null;
      const sayHtml = sayEl ? sayEl.innerHTML.trim() : '';
      const sayCs = sayEl ? getComputedStyle(sayEl) : null;

      const dlgEl = dlgs[0] || null;
      const dlgRect = dlgEl ? dlgEl.getBoundingClientRect() : null;

      return {
        dlgCount: dlgs.length,
        says,
        sayHtml,
        // #3336: no per-folder text, no old "...in your folders." line. The 2-line caption
        // still contains "would like" and ends "to access files." (textContent joins the <br>).
        oldGenericCopy: says.some((s) => /in your folders\.?$/.test(s)),
        perFolderCopy: says.some((s) => /(Documents|Downloads|Desktop) folder/.test(s)),
        namesKosmos: says.some((s) => /"Kosmos"/.test(s)),
        namesTmux: says.some((s) => /"tmux"/.test(s)),
        namesTerminal: says.some((s) => /"Terminal"/.test(s)),
        grpnote: (() => { const n = fan ? fan.querySelector('.s2-grpnote') : null; return n ? n.textContent.trim() : null; })(),
        labelCount: fan ? fan.querySelectorAll('.s2-applbl').length : 0,
        groupCount: fan ? fan.querySelectorAll('.s2-appgrp').length : 0,
        // #3336: the mock buttons are gone -- no .s2-db anywhere in the fan.
        dbCount: fan ? fan.querySelectorAll('.s2-db').length : 0,
        mockCount: fan ? fan.querySelectorAll('.s2-mockallow').length : 0,
        sayPx: sayCs ? parseFloat(sayCs.fontSize) : null,
        sayWeight: sayCs ? String(sayCs.fontWeight) : null,
        boxW: dlgRect ? Math.round(dlgRect.width) : null,
        boxH: dlgRect ? Math.round(dlgRect.height) : null,
      };
    });

    check(`${engine}: exactly ONE preview, no groups, no labels`,
      state.dlgCount === 1 && state.groupCount === 0 && state.labelCount === 0,
      `dlgs ${state.dlgCount}, groups ${state.groupCount}, labels ${state.labelCount}`);

    check(`${engine}: the preview names Kosmos, not tmux, not Terminal`,
      state.namesKosmos && !state.namesTmux && !state.namesTerminal,
      `kosmos ${state.namesKosmos}, tmux ${state.namesTmux}, terminal ${state.namesTerminal}`);

    // #3336: the caption is the two-line "\"Kosmos\" would like<br>to access files.", with no
    // per-folder text and the older "...in your folders." line gone. Pin the exact 2-line HTML
    // (a <br> between "would like" and "to access files."), which also proves the wrap is
    // structural rather than an accident of width.
    check(`${engine}: the caption is the generic two-line "access files." copy (<br> wrap, no per-folder text)`,
      !state.perFolderCopy && !state.oldGenericCopy && state.says.length === 1
        && /^"Kosmos" would like<br\s*\/?>to access files\.$/.test(state.sayHtml),
      JSON.stringify({ says: state.says, sayHtml: state.sayHtml }));

    check(`${engine}: the folder-count labels and the group micro-note are gone`,
      state.grpnote === null && state.labelCount === 0,
      `grpnote ${JSON.stringify(state.grpnote)}, labels ${state.labelCount}`);

    check(`${engine}: caption is compact dialog-sized (~12-14px, weight 600), not the overlay 17px/400 body`,
      state.sayPx !== null && state.sayPx >= 11.5 && state.sayPx <= 14 && state.sayWeight === '600',
      `sayPx ${state.sayPx}, weight ${state.sayWeight}`);

    // #3336 (Josh 6.83): the mock Don't Allow / Allow buttons were REMOVED from the demo box.
    // No .s2-db and no .s2-mockallow remain in the preview. Non-vacuous: it read 2 and 1 before.
    check(`${engine}: the preview has NO Don't Allow / Allow buttons (#3336 removed them)`,
      state.dbCount === 0 && state.mockCount === 0,
      `s2-db ${state.dbCount}, s2-mockallow ${state.mockCount}`);

    // #3336: the box was shrunk (was flex:1 1 240px growing to fill the ~552px pane; now a fixed
    // ~205px box). Assert it is well under the old pane-filling width. The 1280px viewport makes
    // the pane wide, so a regression back to the growing box would read far above this bound.
    check(`${engine}: the demo box is shrunk to a small fixed width (#3336), not the old pane-filling box`,
      state.boxW !== null && state.boxW > 0 && state.boxW <= 240,
      `boxW ${state.boxW}`);

    // #3336: the box is also ~1/2 the old HEIGHT. Removing the buttons + the .s2-dlg-head trailing
    // margin + tighter padding brought it from ~105px to ~58px. Bound it well under the old height
    // so a regression that re-inflates it (buttons back, or the head margin restored) reds.
    check(`${engine}: the demo box is shrunk to about half its old height (#3336)`,
      state.boxH !== null && state.boxH > 0 && state.boxH <= 70,
      `boxH ${state.boxH}`);

    await browser.close();
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
