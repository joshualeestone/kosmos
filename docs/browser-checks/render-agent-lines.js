'use strict';

/**
 * The lines of a rail agent, measured as TEXT rather than as boxes (#1303 A item 3).
 *
 * 🔑 Josh, 0.5.97 review: "for each agent let's tighten up the spacing between
 * lines between the agent name, its title, and its status". The rail row is a
 * multi-row grid with a 2px row gap, so the gap is not what a reader sees: at
 * .8125rem and .625rem the LINE BOXES are most of the height, and the leading
 * inside them is the spacing being complained about.
 *
 * 🛑 #3131 + #3187 (Josh 6.70) CHANGED WHAT THIS ROW SHOWS. The status is no
 * longer a third TEXT line -- it is the row's ground COLOUR now (grey/green/red),
 * and the state word is kept only in a .vh span for screen readers. So this check
 * now measures the leading of the TWO visible lines (name, title), asserts the
 * state word is present-but-visually-hidden, and asserts the row carries a colour
 * wash. This supersedes the original three-line-stack contract (which came from
 * #1191's "single text line to indicate what they're doing"); the leading claim
 * for name->title is what carries over.
 *
 * 🛑 #3187-followup (Josh 6.72) added two more agents-list facts this check now pins:
 * a NOT-RUNNING (stopped) row keeps the grey ground like idle but dims its own avatar +
 * name to ~0.5 (with an idle control at full strength), and a FOLDED rail (fold-a) carries
 * the status colour EDGE-TO-EDGE behind working (green) + needs-you (red) only while idle
 * and not-running keep no wash.
 *
 * 🛑 MEASURED WITH A RANGE, NOT `getBoundingClientRect` ON THE ELEMENT. An
 * element's box includes its leading, so reading element boxes reports the
 * spacing as unchanged when the leading is exactly what moved. This is the same
 * error that made group A's first pass call the row aligned when only two of its
 * three columns had been measured: a box is not a baseline.
 *
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-agent-lines.js
 *
 * ⚠️ HEADED by default. `HEADED=0` on a machine with no console session.
 * Runs the server in-process against a fixture fleet, every state root a temp
 * dir, so it never reads or writes a real board.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-lines-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-lines-workers-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-lines-projects-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-lines-launch-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-lines-config-'));
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';

const { chromium } = require('playwright');
const fleet = require('../../test-support/fleet');
const srv = require('../../server.js');

const fail = [];
const chk = (ok, label, extra) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
};

(async () => {
  fleet.install([
    fleet.agent('april', { state: 'working', displayName: 'April', role: 'Research Assistant' }),
    fleet.agent('mikey', { state: 'idle', displayName: 'Mikey', role: 'Bookkeeper' }),
    /* #3187: a needs-you agent so the RED wash arm is exercised, not only
       green (april) and grey (mikey). Without it the check could not tell the
       .attn wash from a fallback grey. */
    fleet.agent('raph', { state: 'needs_you', displayName: 'Raph', role: 'Fixer' }),
    /* #3187-followup (Josh 6.72): a STOPPED (not-running) agent -> .lrow.off, so the
       not-running arms below (grey ground like idle, but avatar+name knocked to ~50%) are
       exercised, distinct from plain idle (mikey). */
    fleet.agent('donnie', { state: 'stopped', displayName: 'Donnie', role: 'Ops' }),
  ]);
  const server = await srv.start(0);
  const URL = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 950 }, colorScheme: 'light' });
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await page.goto(URL, { waitUntil: 'networkidle' });
    if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
    await page.evaluate(() => fetch('/api/style', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ layout: 'consolidated' }),
    }).then((r) => r.text()));
    await page.reload({ waitUntil: 'networkidle' });
    if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
    await page.waitForSelector('#alist .lrow', { timeout: 10000 });
    await page.waitForTimeout(600);

    const m = await page.evaluate(() => {
      /* The GLYPH box, via a Range over the text node. An element rect carries
         the leading with it, which is the quantity under test, so an element
         rect cannot see this change at all. */
      const textRect = (el) => {
        if (!el) return null;
        const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let node = null;
        while ((node = walk.nextNode())) if (node.textContent.trim()) break;
        if (!node) return null;
        const r = document.createRange();
        r.selectNodeContents(node);
        const box = r.getBoundingClientRect();
        return { top: box.top, bottom: box.bottom, text: node.textContent.trim() };
      };
      const row = document.querySelector('#alist .lrow');
      if (!row) return { missing: true };
      const name = textRect(row.querySelector('.lname b')) || textRect(row.querySelector('.lname'));
      const title = textRect(row.querySelector('.ltitle'));
      /* #3131 + #3187 (Josh 6.70): the state WORD is no longer a visible third
         line -- status is the row's ground colour now, and the word is kept only
         in a .vh span for screen readers. So this reads the .vh word (must exist,
         a11y) AND any state text left VISIBLE outside it (must be empty), instead
         of measuring a state line's leading. */
      const lstate = row.querySelector('.lstate');
      const vh = lstate ? lstate.querySelector('.vh') : null;
      const stateWord = vh ? vh.textContent.trim() : '';
      const vhCs = vh ? getComputedStyle(vh) : null;
      const vhClipped = vhCs ? (parseInt(vhCs.width) <= 2 && vhCs.overflow === 'hidden') : false;
      const stateVisible = lstate ? lstate.textContent.replace(stateWord, '').trim() : '';
      const wash = getComputedStyle(row).backgroundImage;
      const rows = [...document.querySelectorAll('#alist .lrow')];
      /* #3187: the wash + class per agent, so the check can assert the RIGHT
         wash for each state (green=working, red=needs-you, grey=everything else)
         rather than merely "some gradient". */
      const byAgent = {};
      for (const r of rows) {
        const ls = r.querySelector('.lstate');
        const vhr = ls ? ls.querySelector('.vh') : null;
        const vhrCs = vhr ? getComputedStyle(vhr) : null;
        const rWord = vhr ? vhr.textContent.trim() : '';
        /* the .lstate text with the .vh word removed = what the EYE sees in that
           cell (an answerBtn / "Working now" label is legitimately here on some
           rows; the state WORD must not be). */
        const rLeftover = ls ? ls.textContent.replace(rWord, '').trim() : '';
        const lav = r.querySelector('.lav'); const lnm = r.querySelector('.lname');
        byAgent[r.dataset.agent || '?'] = {
          cls: r.className.trim(),
          wash: getComputedStyle(r).backgroundImage,
          /* #3187-followup (Josh 6.72): a not-running (.lrow.off) row dims its own avatar
             and name to ~0.5; every other state leaves them at 1. */
          lavOpacity: lav ? getComputedStyle(lav).opacity : null,
          lnameOpacity: lnm ? getComputedStyle(lnm).opacity : null,
          /* the state WORD must not appear as visible text outside its .vh, on ANY
             row -- robust to fixture order (does not care which row is first) and
             to a needs-you row's visible answerBtn (that is not the state word). */
          wordLeaked: rWord.length > 0 && rLeftover.includes(rWord),
          /* the state word is kept in .vh AND that .vh is clipped -- checked on
             EVERY row, not just the first, so a needs-you row (whose .lstate also
             carries a visible answerBtn) is verified to still hide its WORD. */
          wordHidden: !!vhr && vhr.textContent.trim().length > 0 && !!vhrCs && parseInt(vhrCs.width) <= 2 && vhrCs.overflow === 'hidden',
        };
      }
      const cs = (sel) => {
        const e = row.querySelector(sel);
        if (!e) return null;
        const s = getComputedStyle(e);
        return { fontSize: s.fontSize, lineHeight: s.lineHeight };
      };
      return {
        name, title,
        stateWord, vhClipped, stateVisible, wash,
        byAgent,
        rowHeight: Math.round(row.getBoundingClientRect().height * 10) / 10,
        rowCount: rows.length,
        css: { name: cs('.lname b'), title: cs('.ltitle') },
      };
    });

    if (m.missing) { chk(false, 'a rail agent row is on the page'); }
    else {
      const gap = (a, b) => (a && b ? Math.round((b.top - a.bottom) * 10) / 10 : null);
      const nameTitle = gap(m.name, m.title);
      console.log('');
      console.log('  row height        : ' + m.rowHeight + 'px  (' + m.rowCount + ' rows)');
      console.log('  name              : ' + JSON.stringify(m.css.name) + '  "' + (m.name && m.name.text) + '"');
      console.log('  title             : ' + JSON.stringify(m.css.title) + '  "' + (m.title && m.title.text) + '"');
      console.log('  state word (.vh)  : "' + m.stateWord + '"  clipped=' + m.vhClipped);
      console.log('  visible state text: "' + m.stateVisible + '"');
      console.log('  row wash          : ' + m.wash);
      console.log('  GAP name -> title : ' + nameTitle + 'px');
      console.log('');

      /* 🛑 THE CONTROL. The two VISIBLE lines must actually be on screen with
         text, or the leading below is measuring absence. */
      chk(!!(m.name && m.name.text), 'the name line has text', m.name && m.name.text);
      chk(!!(m.title && m.title.text), 'the title line has text', m.title && m.title.text);

      /* #3131 (Josh 6.70): the status WORD is no longer a visible line. It is
         kept in a .vh span for screen readers (a11y, not deleted) but must NOT
         show as text -- status is the ground colour now. This is the arm that
         catches a revert of the .vh wrap in lrow(). */
      chk(!!m.stateWord, 'the state word is kept for screen readers (a11y)', m.stateWord);
      chk(m.vhClipped, 'the state word is visually hidden (.vh clipped), not a visible line', 'clipped=' + m.vhClipped);
      /* Per-row and order-robust: no row shows its OWN state word as visible text
         (an answerBtn / "Working now" label is allowed; the waiting/idle/busy word
         is not). Replaces an earlier first-row-only check that a fixture reorder
         could have false-failed on a needs-you row's visible answerBtn.
         #3187-followup (Josh 6.72): this covers EVERY row, the stopped one included. A
         state-'stopped' agent (.lrow.off, donnie) renders through the SAME row template as
         the running states and wraps its "Not running" label in a clipped .vh -- measured,
         it hides the word exactly like the others (wordHidden true, wordLeaked false). An
         earlier version of this check scoped both sweeps to non-off rows on the belief that a
         stopped row prints "Not running" as a visible line; that was measured FALSE and only
         dropped coverage, so the scoping is gone. (A genuinely-offline agent -- server-side
         running:false -- does use a different template that prints "Not running" visibly, but
         that state is not in this fixture.) */
      const allRows = Object.values(m.byAgent);
      chk(allRows.length > 0 && allRows.every((v) => !v.wordLeaked),
        'no agent row shows its state word as visible text (word lives only in .vh)',
        JSON.stringify(Object.fromEntries(Object.entries(m.byAgent).map(([k, v]) => [k, v.wordLeaked]))));

      /* #3187 (Josh 6.70): status owns the GROUND, and the ground must be the
         RIGHT colour for the state, not just some gradient. Green=working,
         red=needs-you, grey=everything else, reusing the .acard rgba values.
         april=working, mikey=idle, raph=needs-you are the three fixtures. */
      const GREEN = '47, 125, 90', RED = '179, 38, 30', GREY = '120, 120, 128';
      const washOf = (a) => (m.byAgent[a] || {}).wash || '';
      console.log('  washes            : ' + JSON.stringify(m.byAgent));
      chk(washOf('april').includes(GREEN), 'a WORKING agent gets the green wash', washOf('april'));
      chk(washOf('mikey').includes(GREY), 'an IDLE agent gets the grey wash', washOf('mikey'));
      chk(washOf('raph').includes(RED), 'a NEEDS-YOU agent gets the red wash', washOf('raph'));
      /* #3187-followup (Josh 6.72): a NOT-RUNNING (stopped) agent keeps the grey ground like
         idle, but knocks its OWN avatar+name to ~0.5 so it reads as "asleep, click to see
         why". mikey (idle) is the control: same grey ground, avatar/name at full strength. */
      chk(washOf('donnie').includes(GREY), 'a NOT-RUNNING agent keeps the grey ground (like idle)', washOf('donnie'));
      const opOf = (a, k) => parseFloat((m.byAgent[a] || {})[k]);
      chk(Math.abs(opOf('donnie', 'lavOpacity') - 0.5) < 0.02 && Math.abs(opOf('donnie', 'lnameOpacity') - 0.5) < 0.02,
        'a NOT-RUNNING agent dims its avatar and name to ~0.5',
        `lav=${(m.byAgent.donnie || {}).lavOpacity} lname=${(m.byAgent.donnie || {}).lnameOpacity}`);
      chk(opOf('mikey', 'lavOpacity') === 1 && opOf('donnie', 'lavOpacity') < 1
        && opOf('mikey', 'lnameOpacity') === 1 && opOf('donnie', 'lnameOpacity') < 1,
        'CONTROL: an IDLE agent avatar+name are full-strength while the not-running one is dimmed',
        `idle lav=${(m.byAgent.mikey || {}).lavOpacity} name=${(m.byAgent.mikey || {}).lnameOpacity} / stopped lav=${(m.byAgent.donnie || {}).lavOpacity} name=${(m.byAgent.donnie || {}).lnameOpacity}`);
      /* CONTROL: the three washes are distinct, or "matches GREEN/GREY/RED" could
         pass on a single wash that happened to contain all three substrings. */
      chk(washOf('april') !== washOf('mikey') && washOf('mikey') !== washOf('raph') && washOf('april') !== washOf('raph'),
        'the three state washes are distinct', 'w/i/n differ');
      /* #3131: the WORD is hidden on EVERY row, not only the first (april). This catches a
         needs-you row -- whose .lstate also carries a visible answerBtn -- failing to wrap its
         state word in .vh, and (per the note above) the stopped row too, which hides "Not
         running" in a clipped .vh like the rest. */
      chk(allRows.length > 0 && allRows.every((v) => v.wordHidden),
        'every agent row hides its state word in a .vh clip',
        JSON.stringify(Object.fromEntries(Object.entries(m.byAgent).map(([k, v]) => [k, v.wordHidden]))));

      /* The remaining #1191 claim, now for the TWO visible lines: the name/title
         leading Josh asked to tighten. Ceiling + floor so neither loose spacing
         nor an overlap passes. */
      chk(nameTitle !== null && nameTitle <= 3.5, 'name to title leading is tight', nameTitle + 'px');
      chk(nameTitle !== null && nameTitle >= 0, 'name and title do not overlap', nameTitle + 'px');

      /* #3187-followup (Josh 6.72): FOLD the rail to its 48px strip. The status colour goes
         EDGE-TO-EDGE behind working (green) and needs-you (red) only; idle and not-running
         lose their wash so the strip is not a wall of grey. The layout is already consolidated
         (set above), which the fold-a rules require. */
      const folded = await page.evaluate(() => {
        document.body.classList.add('fold-a');
        const o = { wash: {} };
        for (const r of document.querySelectorAll('#alist .lrow[data-agent]')) o.wash[r.dataset.agent] = getComputedStyle(r).backgroundImage;
        /* #3187-followup (Josh 6.72): "edge-to-edge" is a GEOMETRY claim, not only a colour one,
           and a background-image substring cannot see it. The base consolidated .lrow carries
           border-radius 9px and #alist carries 8px side padding; left unhandled, a folded
           green/red row renders as a rounded chip inset in an 8px grey gutter (measured: 9px
           radius on a ~31px box, 29% of the width). So also read the washed row's radius and its
           width against the strip, and assert square + full-bleed, or the colour is not
           edge-to-edge. */
        const alist = document.querySelector('#alist');
        const geomOf = (sel) => {
          const el = document.querySelector(sel);
          if (!el) return null;
          const cs = getComputedStyle(el);
          return { radius: parseFloat(cs.borderTopLeftRadius) || 0, rowW: Math.round(el.getBoundingClientRect().width) };
        };
        o.alistW = Math.round(alist.getBoundingClientRect().width);
        /* Both washed rows, green (.working) AND red (.attn), are measured: the two
           border-radius:0 declarations are separate, so reading only .working would let a
           copy-paste slip that squares one and not the other pass silently. */
        o.geom = { working: geomOf('#alist .lrow.working'), attn: geomOf('#alist .lrow.attn') };
        return o;
      });
      console.log('  folded washes     : ' + JSON.stringify(folded.wash));
      console.log('  folded geom       : ' + JSON.stringify({ alistW: folded.alistW, working: folded.geom.working, attn: folded.geom.attn }));
      chk((folded.wash.april || '').includes(GREEN), 'FOLDED: a working agent keeps the green wash edge-to-edge', folded.wash.april);
      chk((folded.wash.raph || '').includes(RED), 'FOLDED: a needs-you agent keeps the red wash edge-to-edge', folded.wash.raph);
      const noWash = (s) => !(s || '').includes(GREEN) && !(s || '').includes(RED) && !(s || '').includes(GREY);
      chk(noWash(folded.wash.mikey), 'FOLDED: an idle agent has NO wash (no wall of grey)', folded.wash.mikey);
      chk(noWash(folded.wash.donnie), 'FOLDED: a not-running agent has NO wash', folded.wash.donnie);
      for (const [k, g] of [['green working', folded.geom.working], ['red needs-you', folded.geom.attn]]) {
        chk(!!g && g.radius <= 1, 'FOLDED: the ' + k + ' wash row is SQUARE, not a rounded chip (edge-to-edge)', g ? 'radius=' + g.radius + 'px' : '(row missing)');
        chk(!!g && g.rowW >= folded.alistW - 2, 'FOLDED: the ' + k + ' wash row fills the full strip width (no grey side gutter)', g ? 'row=' + g.rowW + ' strip=' + folded.alistW : '(row missing)');
      }
    }
    chk(errs.length === 0, 'no page errors', errs.join(' | '));
    await page.close();
  } finally {
    await browser.close();
    server.close();
    fleet.restore();
  }
  if (fail.length) { console.log('\n' + fail.length + ' FAILED'); process.exit(1); }
  console.log('\nall passed');
})().catch((e) => { console.error(e); process.exit(2); });
