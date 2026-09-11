// Browser-check-surface: d-busy
'use strict';

/**
 * The "<name> is working…" line, rendered.
 *
 * ⚠️ WHY A BROWSER. `node --test` reads this file as text: it can prove the
 * sentence is in the page and cannot prove it is on the screen, that it is
 * hidden in the states where it must be, or what an assistive technology
 * actually says. The avatar sits INSIDE the line, so `textContent` is
 * "DDan is working…" while the accessible name should be the sentence alone —
 * a distinction only a render can settle, and one this repo got wrong once on
 * the list row's memory caption.
 *
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-busy-line.js
 *
 * ⚠️ HEADED by default, matching the other checks here. `HEADED=0` on a machine
 * with no console session; the verdicts are the same either way, because this
 * asserts computed state rather than comparing pixels.
 */

const nodePath = require('node:path');

let chromium;
try { ({ chromium } = require('playwright')); }
catch {
  console.log('render-busy-line: playwright is not on NODE_PATH — SKIPPED, not passed.');
  process.exit(0);
}

const PAGE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');

(async () => {
  let browser;
  try { browser = await chromium.launch({ headless: process.env.HEADED === '0' }); }
  catch (err) {
    console.error('FAIL  render-busy-line: could not start a browser'
      + (process.env.HEADED === '0' ? '.' : ' (headed; try HEADED=0).'));
    console.error('  ' + (err && err.message ? err.message.split('\n')[0] : err));
    process.exit(1);
  }
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  await page.goto('file://' + PAGE);

  const rows = await page.evaluate(() => {
    document.getElementById('panel-detail').hidden = false;
    const el = document.getElementById('d-busy');
    /* What an assistive technology takes: aria-hidden subtrees are not part of
       the accessible name, and the avatar is one. */
    const spoken = (root) => {
      let out = '';
      for (const n of root.childNodes) {
        if (n.nodeType === 3) { out += n.nodeValue; continue; }
        if (n.nodeType !== 1) continue;
        if (n.getAttribute('aria-hidden') === 'true') continue;
        out += spoken(n);
      }
      return out.replace(/\s+/g, ' ').trim();
    };
    const look = (label, card) => {
      paintBusy(card, card && card.name);
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        label,
        shown: !el.hidden && cs.display !== 'none' && r.width > 0 && r.height > 0,
        spoken: spoken(el),
        dots: !!el.querySelector('.act'),
        face: !!el.querySelector('.msg-av'),
        w: Math.round(r.width),
      };
    };
    return [
      look('working', { sessionName: 'dan', name: 'Dan', state: 'working' }),
      look('idle', { sessionName: 'dan', name: 'Dan', state: 'idle' }),
      look('unknown', { sessionName: 'dan', name: 'Dan', state: 'unknown' }),
      look('needs_you', { sessionName: 'dan', name: 'Dan', state: 'needs_you' }),
      look('stopped', { sessionName: 'dan', name: 'Dan', state: 'stopped' }),
      look('no card at all', null),
      /* 🛑 #2660: THE STALENESS ARMS, RENDERED. `node --test` drives `paintBusy`
         with a stubbed `busyRow`, so it can prove the SHOW DECISION and cannot
         prove the line is actually off the screen. That distinction is the
         whole reason this file exists, and it is the one #2660 is about: the
         report was a line the person SAW after the reply.
         The stamp and the snapshot are the page's own module state, set here
         rather than mocked, so this drives the shipped branch. */
      (() => {
        DM_SPOKE_AT.set('dan', { at: 1, learnedAt: LAST_AT + 1000 });
        const r = look('working, reply already on screen', { sessionName: 'dan', name: 'Dan', state: 'working' });
        DM_SPOKE_AT.delete('dan');
        return r;
      })(),
      (() => {
        /* THE OTHER DIRECTION, or the fix could be "never show it" and the arm
           above would still pass. A reply learned BEFORE the snapshot proves
           nothing about it. */
        DM_SPOKE_AT.set('dan', { at: 1, learnedAt: Math.max(0, LAST_AT - 1000) });
        const r = look('working, reply older than the snapshot', { sessionName: 'dan', name: 'Dan', state: 'working' });
        DM_SPOKE_AT.delete('dan');
        return r;
      })(),
      (() => {
        /* ⚠️ AND AN AUTH FAILURE IS NOT A STALE REPLY. #874 put that state in
           this exact slot because an agent sat here claiming to work while its
           terminal retried a 401. Same inputs that suppress `working` above. */
        DM_SPOKE_AT.set('dan', { at: 1, learnedAt: LAST_AT + 1000 });
        const r = look('auth_failed, reply already on screen', { sessionName: 'dan', name: 'Dan', state: 'auth_failed' });
        DM_SPOKE_AT.delete('dan');
        return r;
      })(),
    ];
  });

  await browser.close();
  const problems = [];
  const byLabel = Object.fromEntries(rows.map((r) => [r.label, r]));
  const work = byLabel.working;

  /* #2660 */
  const staleWork = byLabel['working, reply already on screen'];
  const freshWork = byLabel['working, reply older than the snapshot'];
  const staleAuth = byLabel['auth_failed, reply already on screen'];
  if (staleWork && staleWork.shown) {
    problems.push('the dialog still announces "working" from a snapshot OLDER than the reply already '
      + 'on screen, which is the indicator following the answer it was supposed to precede (#2660)');
  }
  if (freshWork && !freshWork.shown) {
    problems.push('a reply learned BEFORE the snapshot suppressed the working line, so the #2660 '
      + 'filter is hiding states it proves nothing about');
  }
  if (staleAuth && !staleAuth.shown) {
    problems.push('the #2660 staleness filter swallowed an auth failure, re-opening #874: an agent '
      + 'retrying a 401 would sit here saying nothing');
  }
  if (!work.shown) problems.push('a working agent draws nothing');
  if (work.spoken !== 'Dan is working…') {
    problems.push(`a working agent is announced as "${work.spoken}", not "Dan is working…"`);
  }
  if (/typing|replying|composing/i.test(work.spoken)) {
    problems.push(`the line claims to know what the agent is working on: "${work.spoken}"`);
  }
  if (!work.dots) problems.push('the working glyph the board uses is missing');
  if (!work.face) problems.push('the avatar is missing');
  if (work.w < 40) problems.push(`the line is ${work.w}px wide, which is not a line`);

  /* ⚠️ EVERY OTHER STATE, not just idle. `unknown` is the one that matters most
     — an agent we cannot read must not be rendered as working OR as idle. */
  for (const label of ['idle', 'unknown', 'needs_you', 'stopped', 'no card at all']) {
    if (byLabel[label].shown) problems.push(`a ${label} agent is shown as working`);
  }

  for (const r of rows) console.log('  ' + JSON.stringify(r));
  if (problems.length) {
    console.error(`render-busy-line: ${problems.length} problem(s)`);
    for (const p of problems) console.error('  FAIL  ' + p);
    process.exit(1);
  }
  console.log('render-busy-line: shown only for a working agent, announced without claiming why.');
})();
