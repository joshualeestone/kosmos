/**
 * Screen 2 (Access) shows TWO macOS-style permission previews, side by side, one
 * per app: Kosmos and tmux, each a single "<app> would like to access files."
 * prompt. #2910 introduced a six-ask layout (three folders x two apps, framed as
 * "Terminal"); #2685 relabelled the file-access app "Terminal" -> "tmux" (Kosmos
 * ships and launches its own bundled tmux, the process macOS holds responsible
 * for agent FILE access, engine/fileaccessstatus.js, so it is the name on the
 * real folder prompts). #3031 (Josh 2026-09-14) then cut the six previews to two:
 * Josh found six graphics visually heavy and asked for one representative preview
 * per app, with the folder-count labels and the group micro-note removed and the
 * "Don't Allow"/"Allow" buttons no longer wrapping.
 * This check covers the FILE-access screen only; the accessibility step (S3) is
 * separate, its tmux-vs-Kosmos attribution is tracked on #2911/#3032, and this
 * check does not assert it.
 *
 * FILENAME IS HISTORICAL. This check began at 0.6.39 #8 asserting ONE box
 * ("onebox") that replaced a three-card fan; #2910 grew it to six, #3031 settles
 * it at two. The name is kept so the browser-check surface map / count gates do
 * not churn on a rename.
 *
 * This is the preview cluster (`.s2-dlg-fan`, aria-hidden). Each preview's mock
 * Allow keeps `.s2-mockallow`, so a click forwards into the one real file-access
 * flow (the #fr-pane-2 handler targets the single `.s2-allow`); the keyboard/AT
 * grant path stays the real `.s2-gate-row` Allow Access button, whose click
 * wiring this check does not assert (pinned in engine/machine.a11y-1344.test.js).
 *
 * WHY A SOURCE TEST CANNOT SEE THE RING (or the wrap). The ring is a `::after`
 * pseudo on `.s2-db.s2-hl`, and a wrapped button's extra height is a computed
 * layout result. A rule that loses the cascade reads in the diff like a rule that
 * works; only the computed style / rendered rect tells them apart.
 *
 * Arms:
 *  1. STRUCTURE: exactly two `.s2-dlg`, no `.s2-appgrp` groups, no `.s2-applbl`.
 *  2. NAMES: the two previews name Kosmos and tmux, NOT Terminal.
 *  3. GENERIC COPY: each preview reads "<app> would like to access files.", with
 *     no per-folder text and the old "...in your folders." line gone.
 *  4. TRIMMED (#3031 items 4/5/6): the group micro-note and folder-count labels
 *     are gone.
 *  5. COMPACT COPY: a preview line renders at the compact dialog size (~12-14px,
 *     weight 600), not the 17px/400 first-run body.
 *  6. BUTTONS: every preview renders a "Don't Allow" and an "Allow".
 *  7. NO WRAP (#3031 item 3): every `.s2-db` is white-space:nowrap and renders as
 *     a single line, and the two buttons in a row are equal height (a wrap would
 *     make "Don't Allow" taller and leave a gap under "Allow").
 *  8. MOCK AFFORDANCE: every Allow is a live affordance (`.s2-mockallow` +
 *     cursor:pointer).
 *  9. RING: every Allow draws a solid gold `::after` ring and is the blue macOS
 *     default button.
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

// Gold hue ordering r > g > b with r near the brand gold (#e3b341 = 227,179,65).
// A transparent, white, grey, or blue ring fails this, and so would a wrong token.
function isGold(rgb) {
  if (!rgb) return false;
  const m = rgb.match(/rgba?\(([^)]+)\)/i);
  if (!m) return false;
  const [r, g, b] = m[1].split(',').map((s) => parseFloat(s.trim()));
  if (![r, g, b].every((n) => Number.isFinite(n))) return false;
  return Math.abs(r - 227) <= 45 && Math.abs(g - 179) <= 45 && Math.abs(b - 65) <= 55
    && r > g && g > b;
}
// Blue-ish: the macOS default/suggested button. b is the dominant channel.
function isBlue(rgb) {
  if (!rgb) return false;
  const m = rgb.match(/rgba?\(([^)]+)\)/i);
  if (!m) return false;
  const [r, g, b] = m[1].split(',').map((s) => parseFloat(s.trim()));
  if (![r, g, b].every((n) => Number.isFinite(n))) return false;
  return b > r && b > 120;
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

      const allows = dlgs.map((d) => Array.from(d.querySelectorAll('.s2-db')).find((b) => /^Allow$/.test(b.textContent.trim())) || null);
      const denies = dlgs.map((d) => Array.from(d.querySelectorAll('.s2-db')).find((b) => /Don't Allow/.test(b.textContent.trim())) || null);

      const sayEl = fan ? fan.querySelector('.s2-say') : null;
      const sayCs = sayEl ? getComputedStyle(sayEl) : null;

      // #3031 item 3: measure every .s2-db for the wrap fix. white-space must be
      // nowrap, and the rendered height must fit a single line (client height not
      // taller than one line-box of padding+border).
      const btnRows = dlgs.map((d) => {
        const btns = Array.from(d.querySelectorAll('.s2-db'));
        return btns.map((b) => {
          const cs = getComputedStyle(b);
          const r = b.getBoundingClientRect();
          const lh = parseFloat(cs.lineHeight) || (parseFloat(cs.fontSize) * 1.2);
          const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
          const bd = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
          return { txt: b.textContent.trim(), whiteSpace: cs.whiteSpace, h: r.height, oneLineMax: lh + pad + bd + 2 };
        });
      });

      const allowInfo = allows.map((a) => {
        if (!a) return null;
        const af = getComputedStyle(a, '::after');
        const r = a.getBoundingClientRect();
        return {
          mock: a.classList.contains('s2-mockallow'),
          cursor: getComputedStyle(a).cursor,
          bg: getComputedStyle(a).backgroundColor,
          sized: r.width > 0 && r.height > 0,
          ring: { content: af.content, bw: af.borderTopWidth, bs: af.borderTopStyle, bc: af.borderTopColor },
        };
      });

      return {
        dlgCount: dlgs.length,
        says,
        oldGenericCopy: says.some((s) => /in your folders\.?$/.test(s)),
        perFolderCopy: says.some((s) => /(Documents|Downloads|Desktop) folder/.test(s)),
        namesKosmos: says.some((s) => /"Kosmos"/.test(s)),
        namesTmux: says.some((s) => /"tmux"/.test(s)),
        namesTerminal: says.some((s) => /"Terminal"/.test(s)),
        grpnote: (() => { const n = fan ? fan.querySelector('.s2-grpnote') : null; return n ? n.textContent.trim() : null; })(),
        labelCount: fan ? fan.querySelectorAll('.s2-applbl').length : 0,
        groupCount: fan ? fan.querySelectorAll('.s2-appgrp').length : 0,
        denyCount: denies.filter(Boolean).length,
        allowCount: allows.filter(Boolean).length,
        sayPx: sayCs ? parseFloat(sayCs.fontSize) : null,
        sayWeight: sayCs ? String(sayCs.fontWeight) : null,
        btnRows,
        allowInfo,
      };
    });

    // #3031 item 2: at the REAL onboarding pane width (~552px) the two previews must sit
    // side by side, not stacked. That width is not the test viewport: .fr-box caps the modal
    // at max-width:40rem (640px), and .fr-body's 44px side padding leaves ~552px of content,
    // so the natural render here is already ~552px whatever the viewport is. We pin 552px
    // anyway so this guard does not silently disarm if .fr-box's own width rules change later.
    // The regression the first cut shipped: 320px-wide previews wrapped to a column on the
    // narrow pane. Same top + different left = one row.
    const layout = await page.evaluate(() => {
      const fan = document.querySelector('#fr-pane-2 .s2-dlg-fan') || document.querySelector('.s2-dlg-fan');
      if (!fan) return { ok: false };
      const prevW = fan.style.width;
      fan.style.width = '552px';
      fan.getBoundingClientRect();
      const dlgs = Array.from(fan.querySelectorAll('.s2-dlg'));
      const tops = dlgs.map((d) => Math.round(d.getBoundingClientRect().top));
      const lefts = dlgs.map((d) => Math.round(d.getBoundingClientRect().left));
      fan.style.width = prevW;
      return { ok: true, count: dlgs.length, tops, lefts };
    });
    check(`${engine}: the two previews are side by side at the onboarding pane width (~552px)`,
      layout.ok && layout.count === 2
        && layout.tops[0] === layout.tops[1] && layout.lefts[0] !== layout.lefts[1],
      JSON.stringify(layout));

    check(`${engine}: exactly TWO previews, no groups, no labels (was six in two groups)`,
      state.dlgCount === 2 && state.groupCount === 0 && state.labelCount === 0,
      `dlgs ${state.dlgCount}, groups ${state.groupCount}, labels ${state.labelCount}`);

    check(`${engine}: the two previews name Kosmos and tmux (not Terminal)`,
      state.namesKosmos && state.namesTmux && !state.namesTerminal,
      `kosmos ${state.namesKosmos}, tmux ${state.namesTmux}, terminal ${state.namesTerminal}`);

    // #3031: the six per-folder lines collapsed to one generic "would like to access
    // files." per app -- no per-folder text, and the older "...in your folders." line
    // stays gone too.
    check(`${engine}: previews use the generic "access files." line, no per-folder text`,
      !state.perFolderCopy && !state.oldGenericCopy
        && state.says.length === 2 && state.says.every((s) => /would like to access files\.$/.test(s)),
      JSON.stringify(state.says));

    // #3031 items 4/5/6: the "(3 folders)" labels and the tmux group micro-note are gone.
    check(`${engine}: the folder-count labels and the group micro-note are gone`,
      state.grpnote === null && state.labelCount === 0,
      `grpnote ${JSON.stringify(state.grpnote)}, labels ${state.labelCount}`);

    check(`${engine}: preview copy is compact dialog-sized (~12-14px, weight 600), not the overlay 17px/400 body`,
      state.sayPx !== null && state.sayPx >= 11.5 && state.sayPx <= 14 && state.sayWeight === '600',
      `sayPx ${state.sayPx}, weight ${state.sayWeight}`);

    check(`${engine}: every preview renders a Don't Allow and an Allow`,
      state.denyCount === 2 && state.allowCount === 2,
      `deny ${state.denyCount}, allow ${state.allowCount}`);

    // #3031 item 3: neither button wraps. white-space:nowrap on every .s2-db AND each
    // button renders as a single line (height within a one-line box), so "Don't Allow"
    // no longer breaks to two lines and leaves a gap under "Allow".
    const noWrap = state.btnRows.length === 2 && state.btnRows.every((row) =>
      row.length === 2 && row.every((b) => b.whiteSpace === 'nowrap' && b.h > 0 && b.h <= b.oneLineMax));
    check(`${engine}: neither button wraps (nowrap + single-line height on every .s2-db)`,
      noWrap, JSON.stringify(state.btnRows));

    // A wrap would make "Don't Allow" taller than "Allow"; equal height means no wrap gap.
    const equalHeight = state.btnRows.length === 2
      && state.btnRows.every((row) => row.length === 2 && Math.abs(row[0].h - row[1].h) <= 1);
    check(`${engine}: the two buttons in each preview are equal height (no wrap gap)`,
      equalHeight, JSON.stringify(state.btnRows.map((r) => r.map((b) => b.h))));

    // Josh 2026-09-08: people click the mock "Allow" (they read it as the real macOS button),
    // so each is a live mouse affordance (.s2-mockallow + pointer). The click BEHAVIOUR is
    // pinned in engine/machine.a11y-1344.test.js; this arm verifies the RENDERED affordance.
    const allMock = state.allowInfo.length === 2 && state.allowInfo.every((a) => a && a.mock && a.cursor === 'pointer' && a.sized);
    check(`${engine}: every mock Allow is a live clickable affordance (.s2-mockallow + cursor:pointer)`,
      allMock, JSON.stringify(state.allowInfo.map((a) => a && { mock: a.mock, cursor: a.cursor })));

    // Non-vacuous: the ring pseudo must actually exist on every Allow, then be a gold solid ring on a blue button.
    const allRinged = state.allowInfo.length === 2 && state.allowInfo.every((a) => {
      const present = a && a.ring && a.ring.content && a.ring.content !== 'none' && parseFloat(a.ring.bw) >= 1;
      return present && a.ring.bs === 'solid' && isGold(a.ring.bc) && isBlue(a.bg);
    });
    check(`${engine}: every Allow is ringed (solid gold ::after) and is the blue default button`,
      allRinged, JSON.stringify(state.allowInfo.map((a) => a && { ring: a.ring, bg: a.bg })));

    await browser.close();
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
