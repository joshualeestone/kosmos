'use strict';
/**
 * The project-room composer's caret sits at the end of the text you typed, on every line (#4585, Josh
 * 2026-09-29 11:33, Mac app 0.7.08: "how far away my cursor is from the text that I'm typing").
 *
 * The room composer (#pj-post) is a textarea whose own text is transparent: the text you see is drawn by
 * the @mention mirror (#pj-post-mirror) behind it, while the caret belongs to the textarea. If the two lay
 * the same words out differently, the mirror wraps a word onto a line the textarea has not (or the other
 * way), and the caret sits where the textarea's invisible text is: characters away from the visible text.
 * Measured on origin/main: at 1400px and 1180px the two disagreed on the number of lines at 3 and 8 of a
 * long sentence's lengths (the mirror inherited the body's letter-spacing, which a textarea does not, and
 * was sized by offsetWidth, whole pixels, up to 1px narrower).
 *
 * Arms (each engine asked for):
 *  - every text-layout property is the same on the textarea and the mirror's text box,
 *  - the mirror's box is the textarea's real width, and its text starts at the textarea's text's left edge,
 *  - typing a long sentence one character at a time, the textarea and the mirror agree on the number of
 *    lines at EVERY length, at three widths (a wrap mismatch is exactly the caret gap; at the first length
 *    where they part, the counts differ),
 *  - scrolled past its max height the composer shows no scrollbar (the mirror relies on that: its width is
 *    the textarea's full width),
 *  - a width change with no window resize (the column narrowed in place) re-sizes the mirror,
 *  - the Direct Message box draws its own text (no mirror), so its caret cannot drift.
 * Not covered here: the touch layout (hover: none), where both boxes go to 16px by two rules;
 * render-room-msgbox-2806 guards that pair.
 *
 *   HEADED=0 node docs/browser-checks/render-composer-caret-4585.js
 *   ENGINES=chromium,webkit HEADED=0 node docs/browser-checks/render-composer-caret-4585.js   (WebKit: the Mac app's engine)
 */
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-caret-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-caret-workers-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-caret-config-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-caret-launch-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-caret-projects-'));
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';

let pw;
try { pw = require('playwright'); }
catch {
  console.log('render-composer-caret-4585: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}
const fleet = require('../../test-support/fleet');
const srv = require('../../server.js');
const store = require('../../engine/store');
const create = require('../../engine/create');

// The gate runs Chromium; ENGINES=chromium,webkit adds WebKit by hand.
const ALL_ENGINES = ['chromium', 'webkit'];
const ASKED = (process.env.ENGINES || 'chromium').split(',').map((s) => s.trim()).filter(Boolean);
const ENGINES = ASKED.filter((e) => ALL_ENGINES.includes(e));
// A misspelt engine would otherwise be dropped silently and the run read as covering it.
if (!ENGINES.length || ENGINES.length !== ASKED.length) {
  console.log('FAIL  render-composer-caret-4585: ENGINES names an unknown engine (' + (process.env.ENGINES || '') + '); known: ' + ALL_ENGINES.join(', '));
  process.exit(1);
}
const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}
async function open(page, base, where, pid) {
  await page.goto(base, { waitUntil: 'networkidle' });
  if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
  if (where === 'agent') {
    // Through the agent's card, as a person does (a ?tab=detail address is not kept at phone size).
    await page.waitForSelector('.acard[data-agent="ada"] .namego', { timeout: 8000 });
    await page.locator('.acard[data-agent="ada"] .namego').first().click();
    await page.waitForSelector('#d-say', { state: 'visible', timeout: 8000 });
  } else {
    // The Projects tab, through the menu on a phone (as mobile-shots.js does).
    if (await page.isVisible('#burger')) {
      await page.click('#burger');
      await page.waitForSelector('[data-tab="projects"]', { state: 'visible', timeout: 5000 });
    }
    await page.click('[data-tab="projects"]');
    await page.waitForSelector(`.pj-row[data-project="${pid}"]`, { state: 'visible', timeout: 8000 });
    await page.click(`.pj-row[data-project="${pid}"]`);
    await page.waitForSelector('#pj-post', { state: 'visible', timeout: 8000 });
  }
  await page.waitForTimeout(300);
}
const NAMES = ['ada', 'bram'];
const LAYOUT = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontStretch', 'letterSpacing', 'wordSpacing', 'lineHeight',
  'textIndent', 'textTransform', 'whiteSpace', 'overflowWrap', 'wordBreak', 'tabSize', 'fontKerning', 'fontVariantLigatures',
  'fontFeatureSettings', 'paddingLeft', 'paddingRight', 'paddingTop', 'boxSizing', 'direction', 'borderLeftWidth', 'borderRightWidth'];
const SENT = 'Thanks for using tasks and putting files here, helps me see it from the UX side and I think we should keep going '
  + 'with this approach for the rest of the week, then look again on Monday @ada';
/* Lines as each element lays the text out: the textarea from its scrollHeight, the mirror's text box from its
   own. Swept over every length of SENT, which crosses each width's wrap points. */
const SWEEP = async (page, text, from = 20) => page.evaluate(async ([text, from]) => {
  const t = document.getElementById('pj-post'), m = document.querySelector('#pj-post-mirror .pj-mirror-in');
  const cs = getComputedStyle(t), lh = parseFloat(cs.lineHeight), pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
  const bad = [];
  let lengths = 0, wrapped = 0;
  for (let n = from; n <= text.length; n++) {
    t.value = text.slice(0, n); t.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => requestAnimationFrame(r));
    const tl = Math.round((t.scrollHeight - pad) / lh), ml = Math.round((m.scrollHeight - pad) / lh);
    lengths++; if (tl > 1) wrapped++;
    if (tl !== ml) bad.push({ n, textarea: tl, mirror: ml, at: text.slice(Math.max(0, n - 14), n) });
  }
  return { lengths, wrapped, bad: bad.slice(0, 5), badCount: bad.length, live: t.classList.contains('mention-live') };
}, [text, from]);

(async () => {
  fleet.install(NAMES.map((n, i) => fleet.agent(n, { state: 'idle', displayName: n[0].toUpperCase() + n.slice(1), role: 'Role ' + (i + 1) })));
  NAMES.forEach((n, i) => { store.writeProfile(n, { role: 'Role ' + (i + 1) }); fs.mkdirSync(create.workerDir(n), { recursive: true }); });
  const server = await srv.start(0);
  const base = 'http://127.0.0.1:' + server.address().port;
  let ran = 0;
  const arm = (ok, label, extra) => { ran++; chk(ok, label, extra); };
  try {
    const res = await fetch(base + '/api/projects', { method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
      body: JSON.stringify({ name: 'Spring launch', agents: NAMES }) });
    const made = await res.json().catch(() => ({}));
    const pid = made && (made.id || (made.project && made.project.id));
    arm(res.ok && !!pid, 'a project to open the room of', `status ${res.status}`);
    for (const engine of ENGINES) {
      const browser = await pw[engine].launch(engine === 'chromium'
        ? { headless: process.env.HEADED === '0', ignoreDefaultArgs: ['--hide-scrollbars'] } : { headless: process.env.HEADED === '0' });
      try {
        const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
        await open(page, base, 'room', pid);
        await page.fill('#pj-post', SENT.slice(0, 60));
        await page.waitForTimeout(200);
        const st = await page.evaluate((LAYOUT) => {
          const t = document.getElementById('pj-post'), m = document.querySelector('#pj-post-mirror .pj-mirror-in'), box = document.getElementById('pj-post-mirror');
          const ct = getComputedStyle(t), cm = getComputedStyle(m);
          const diff = {}; for (const p of LAYOUT) if (ct[p] !== cm[p]) diff[p] = [ct[p], cm[p]];
          const bl = parseFloat(ct.borderLeftWidth) || 0, br = parseFloat(ct.borderRightWidth) || 0;
          const tr = t.getBoundingClientRect(), mr = m.getBoundingClientRect();
          const tTextLeft = tr.left + bl + parseFloat(ct.paddingLeft), mTextLeft = mr.left + parseFloat(cm.paddingLeft);
          const tTextTop = tr.top + (parseFloat(ct.borderTopWidth) || 0) + parseFloat(ct.paddingTop), mTextTop = mr.top + parseFloat(cm.paddingTop);
          return { live: t.classList.contains('mention-live'), diff, boxW: box.getBoundingClientRect().width, want: tr.width,
            dx: +(mTextLeft - tTextLeft).toFixed(3), dy: +(mTextTop - tTextTop).toFixed(3) };
        }, LAYOUT);
        arm(st.live, `[${engine}] the mirror is what shows the text (the textarea's own text is transparent)`, JSON.stringify(st.live));
        arm(Object.keys(st.diff).length === 0, `[${engine}] the textarea and the mirror share every text-layout property`, JSON.stringify(st.diff));
        arm(Math.abs(st.boxW - st.want) < 0.01, `[${engine}] the mirror is the textarea's real width`, JSON.stringify({ boxW: st.boxW, want: st.want }));
        arm(Math.abs(st.dx) < 0.05 && Math.abs(st.dy) < 0.05, `[${engine}] the mirror's text starts exactly where the textarea's does`, JSON.stringify({ dx: st.dx, dy: st.dy }));
        /* And under the new look (#4470), whose composer box pads differently, where the textarea can sit at a
           fractional offset: the mirror is placed from the real box, so it still lines up. */
        const nl = await page.evaluate(async () => {
          const cbox = document.getElementById('pj-post').closest('.composerbox');
          const look = () => { const c = getComputedStyle(cbox); return [c.paddingLeft, c.borderRadius, c.backgroundColor].join('|'); };
          const lookBefore = look(), xBefore = document.getElementById('pj-post').getBoundingClientRect().left;
          document.documentElement.setAttribute('data-look', 'new');
          const t = document.getElementById('pj-post'), m = document.querySelector('#pj-post-mirror .pj-mirror-in');
          t.dispatchEvent(new Event('input', { bubbles: true }));
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          const ct = getComputedStyle(t), cm = getComputedStyle(m), tr = t.getBoundingClientRect(), mr = m.getBoundingClientRect();
          const out = { dx: +((mr.left + parseFloat(cm.paddingLeft)) - (tr.left + (parseFloat(ct.borderLeftWidth) || 0) + parseFloat(ct.paddingLeft))).toFixed(3),
            dy: +((mr.top + parseFloat(cm.paddingTop)) - (tr.top + (parseFloat(ct.borderTopWidth) || 0) + parseFloat(ct.paddingTop))).toFixed(3),
            dw: +(document.getElementById('pj-post-mirror').getBoundingClientRect().width - tr.width).toFixed(3), x: tr.left, y: tr.top,
            applied: look() !== lookBefore || tr.left !== xBefore };
          document.documentElement.removeAttribute('data-look');
          t.dispatchEvent(new Event('input', { bubbles: true }));
          return out;
        });
        arm(nl.applied && Math.abs(nl.dx) < 0.05 && Math.abs(nl.dy) < 0.05 && Math.abs(nl.dw) < 0.01,
          `[${engine}] under the new look (its composer box really restyled) the mirror still sits exactly on the textarea`, JSON.stringify(nl));
        for (const width of [1400, 1180, 1000]) {
          await page.setViewportSize({ width, height: 900 });
          await page.waitForTimeout(250);
          const sw = await SWEEP(page, SENT);
          // The control first: the sweep really crossed wrap points, or agreement proves nothing.
          arm(sw.live && sw.wrapped > 10, `[${engine} ${width}] the sweep typed ${sw.lengths} lengths and crossed onto a second line (control)`, JSON.stringify({ wrapped: sw.wrapped }));
          arm(sw.badCount === 0, `[${engine} ${width}] at every length the textarea and the mirror wrap onto the same number of lines (the caret is at the visible text)`, JSON.stringify(sw.bad));
        }
        /* Scrolled past its max height, the composer shows no scrollbar in this engine (the page hides it in
           both, and the mirror's width assumes it). */
        const sc = await page.evaluate(async (long) => {
          const t = document.getElementById('pj-post'); t.value = long; t.dispatchEvent(new Event('input', { bubbles: true }));
          await new Promise((r) => requestAnimationFrame(r));
          return { scrolls: t.scrollHeight > t.clientHeight, sb: t.offsetWidth - t.clientWidth };
        }, (SENT + ' ').repeat(6));
        // Chromium runs with classic scrollbars here, so this can fail there; WebKit's overlay scrollbars take no
        // width, so its arm only confirms the box scrolls with a zero-width bar (it cannot see a removed rule).
        arm(sc.scrolls && sc.sb === 0, `[${engine}] scrolled past its max height, the composer shows no scrollbar` + (engine === 'webkit' ? ' (overlay scrollbars: a zero-width bar)' : ''), JSON.stringify(sc));
        /* The column narrowed in place, no window resize: the textarea rewraps, and the mirror must follow. */
        await page.evaluate(() => { const t = document.getElementById('pj-post'); t.value = 'Thanks for using tasks and putting files here, helps me see it from the UX side'; t.dispatchEvent(new Event('input', { bubbles: true })); });
        await page.waitForTimeout(150);
        const nar = await page.evaluate(async () => {
          const t = document.getElementById('pj-post'), box = document.getElementById('pj-post-mirror');
          const col = t.closest('.composer') || t.parentElement;
          const before = t.getBoundingClientRect().width;
          col.style.maxWidth = Math.round(before * 0.6) + 'px';
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          await new Promise((r) => setTimeout(r, 50));
          const out = { before, after: t.getBoundingClientRect().width, mirror: box.getBoundingClientRect().width };
          col.style.maxWidth = '';
          return out;
        });
        arm(nar.after < nar.before - 20 && Math.abs(nar.mirror - nar.after) < 0.01,
          `[${engine}] narrowing the column in place (no window resize) re-sizes the mirror with the textarea`, JSON.stringify(nar));
        await page.close();
        // The Direct Message box draws its own text: nothing to drift from its caret. (A guard: it fails only if a
        // mirror, or transparent text, is ever added to that box without this check being extended to it.)
        const dm = await browser.newPage({ viewport: { width: 1400, height: 900 } });
        await open(dm, base, 'agent');
        await dm.fill('#d-say', SENT);
        const d = await dm.evaluate(() => { const s = document.getElementById('d-say'); return { color: getComputedStyle(s).color, mirror: !!document.querySelector('#d-say ~ [id$="mirror"], #d-say-mirror') }; });
        arm(!/rgba\([^)]*,\s*0\)|transparent/.test(d.color) && !d.mirror, `[${engine}] the Direct Message box draws its own text, with no mirror`, JSON.stringify(d));
        await dm.close();
      } finally { await browser.close(); }
    }
  } finally {
    server.close();
    fleet.restore && fleet.restore();
  }
  const floor = 1 + ENGINES.length * (5 + 3 * 2 + 2 + 1);
  console.log(`\n${ran - fail.length}/${ran} passed` + (ran < floor ? ` (expected ${floor}: an arm did not run)` : ''));
  process.exit(fail.length || ran < floor ? 1 : 0);
})().catch((e) => { console.error('FAIL  render-composer-caret-4585: ' + (e && e.message ? e.message.split('\n')[0] : e)); process.exit(1); });
