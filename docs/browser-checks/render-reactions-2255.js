'use strict';
/* #2255 emoji reactions on room posts, hover-restyled in #2806, checked in the real
 * painted room.
 *
 * #2806 (Josh): the always-visible "+" is gone. On message hover a `.rxn-quick` bar
 * reveals three default reactions plus a grey-smiley `.rxn-more` that opens the FULL
 * emoji picker (PJ_EMOJI). This check drives that shape: it asserts no "+", the three
 * quick defaults, the hover-reveal (opacity 0 -> 1), the smiley opening the full
 * picker, a picker emoji adding a pill with count + gold `.mine`, the toggle-off
 * round-trip control, and Escape closing the picker. Driven against the SHIPPED page
 * + the real react route (never a copy): self-boots a sandboxed server, creates a
 * project + an agent, posts a message, opens the room, and interacts.
 *
 * DOM-state + computed-opacity assertions only, so headless + mode-independent. A
 * control proves the toggle round-trips: reacting twice with the same emoji leaves
 * NO pill.
 *
 * Run: NODE_PATH=$HOME/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-reactions-2255.js
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const REPO = path.resolve(__dirname, '..', '..');
const freePort = () => Number(require('node:child_process').execFileSync(process.execPath, ['-e', "const s=require('node:net').createServer();s.listen(0,'127.0.0.1',()=>{process.stdout.write(String(s.address().port));s.close()})"], { encoding: 'utf8' }));
const PORT = freePort();

let failures = 0, ran = 0;
const ok = (n) => { ran++; console.log('PASS  ' + n); };
const bad = (n, why) => { ran++; failures++; console.log('FAIL  ' + n + '  --  ' + why); };

(async () => {
  const roots = {};
  for (const k of ['DATA', 'WORKERS', 'LAUNCH', 'PROJECTS']) {
    roots[k] = fs.mkdtempSync(path.join(os.tmpdir(), 'rx-' + k.toLowerCase() + '-'));
  }
  fs.writeFileSync(roots.DATA + '/fake-panes',
    require('../../test-support/fleet').line({ session: 'roomer-discord', claim: 'roomer', title: '✳ idle' }) + '\n');
  fs.writeFileSync(roots.DATA + '/fake-sessions', 'roomer-discord\n');
  fs.writeFileSync(roots.DATA + '/fake-screen', '❯ \n  ⏵⏵ bypass permissions on (shift+tab to cycle)\n');
  const srv = spawn('node', ['server.js'], {
    cwd: REPO,
    env: { ...process.env, PORT: String(PORT), AGENT_WORKFORCE_RELEASE_BASE: 'http://127.0.0.1:9/dist',
      AGENT_WORKFORCE_DATA: roots.DATA, AGENT_WORKFORCE_WORKERS: roots.WORKERS,
      AGENT_WORKFORCE_LAUNCH: roots.LAUNCH, AGENT_WORKFORCE_PROJECTS: roots.PROJECTS,
      AGENT_WORKFORCE_TMUX_BIN: path.join(REPO, 'test-support', 'fake-tmux.sh'),
      AGENT_WORKFORCE_FAKE_PANES: roots.DATA + '/fake-panes',
      AGENT_WORKFORCE_FAKE_SESSIONS: roots.DATA + '/fake-sessions',
      AGENT_WORKFORCE_FAKE_SCREEN: roots.DATA + '/fake-screen' },
    stdio: 'ignore',
  });
  await new Promise((r) => setTimeout(r, 1200));

  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    for (const theme of ['light', 'dark']) {
      const p = await browser.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: theme });
      const t = '[' + theme + ']';
      const errs = [];
      p.on('pageerror', (e) => errs.push(String(e)));
      p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FILE_NOT_FOUND|favicon|status 404/.test(m.text())) errs.push(m.text()); });

      await p.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'networkidle' });
      if (await p.isVisible('#firstrun')) await p.keyboard.press('Escape');

      const pjName = 'Reax ' + theme;
      const made = await p.evaluate(async (name) => {
        const r1 = await fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
        if (!r1.ok) return { error: 'project create ' + r1.status };
        const id = (await r1.json()).project.id;
        await fetch('/api/project/' + id + '/agent/roomer', { method: 'POST', headers: { 'content-type': 'application/json' } });
        // #2806: post MANY messages so the thread scrolls past its max-height. The
        // reaction picker must stay on-screen when opened on the BOTTOM post -- the
        // exact case an absolutely-positioned (clipped-by-overflow) picker failed.
        let j = null;
        for (let i = 1; i <= 16; i += 1) {
          const r2 = await fetch('/api/project/' + id + '/room', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'react to me #' + i }) });
          j = await r2.json().catch(() => null);
          if (j && j.delivery && j.delivery.state === 'could_not') return { error: 'post refused: ' + j.delivery.because };
        }
        return { id };
      }, pjName);
      if (made.error) { bad(t + ' fixture posted a room message', made.error); await p.close(); continue; }

      await p.click('[data-tab="projects"]');
      await p.locator('#pj-list').getByText(pjName, { exact: true }).first().click();
      await p.waitForSelector('#pj-room', { state: 'visible' });
      // Wait for the reaction rows (the hover-revealed grey-smiley opener) to paint.
      await p.waitForSelector('#pj-room .msg-b .rxns .rxn-more', { timeout: 15000 }).catch(() => {});

      // #2806: everything runs on the BOTTOM post of a scrolled thread -- the case an
      // overflow-clipped (absolutely positioned) picker failed. `lastRow` is the last
      // .msg that has a reaction row; `rxns` is its `.rxns`, passed straight into each
      // evaluate (Playwright hands the matched element in -- no in-page eval, so no CSP
      // dependence).
      const lastRow = p.locator('#pj-room .msg').filter({ has: p.locator('.rxns') }).last();
      await lastRow.scrollIntoViewIfNeeded();
      const rxns = lastRow.locator('.rxns');
      const msgB = lastRow.locator('.msg-b');

      // #2806: the "+" is gone; the affordance is a hover-gated .rxn-quick bar (three
      // defaults + the grey-smiley .rxn-more) plus the full picker it opens.
      const initial = await rxns.evaluate((box) => {
        const quick = box.querySelector('.rxn-quick');
        // #2834: the full picker is the SHARED #rxn-picker (built lazily on first
        // smiley click, appended to body), not an inline element -- so before any
        // click it does not exist yet, which is "hidden" for this assertion.
        const shared = document.getElementById('rxn-picker');
        return { pills: box.querySelectorAll('.rxn').length,
          hasOldPlus: !!box.querySelector('.rxn-add'),
          hasMore: !!box.querySelector('.rxn-more'),
          hasInlinePicker: !!box.querySelector('.rxn-picker'),
          quickDefaults: quick ? quick.querySelectorAll('.rxn-pick').length : -1,
          quickOpacity: quick ? Number(getComputedStyle(quick).opacity) : null,
          pickerHidden: !shared || shared.hidden };
      });
      if (initial.hasMore && !initial.hasOldPlus) ok(t + ' a post shows the grey-smiley opener and NO "+" (removed per #2806)'); else bad(t + ' opener is the smiley, not "+"', JSON.stringify(initial));
      if (!initial.hasInlinePicker) ok(t + ' #2834: a post does NOT inline its own .rxn-picker (the full list is the shared #rxn-picker)'); else bad(t + ' post still inlines a picker', 'the #2834 refactor should have removed it');
      if (initial.quickDefaults === 3) ok(t + ' the quick bar carries exactly three default reactions'); else bad(t + ' three quick defaults', 'n=' + initial.quickDefaults);
      if (initial.pills === 0) ok(t + ' a fresh post has no pills yet'); else bad(t + ' no initial pills', 'pills=' + initial.pills);
      if (initial.pickerHidden === true) ok(t + ' the full picker starts hidden'); else bad(t + ' picker starts hidden', String(initial.pickerHidden));
      if (initial.quickOpacity === 0) ok(t + ' the quick bar is hidden (opacity 0) before hover'); else bad(t + ' quick bar hidden pre-hover', 'opacity=' + initial.quickOpacity);

      // Hover the message -> the quick bar reveals (opacity animates 0 -> 1 over the
      // .12s transition; poll rather than read the instant it starts). This also makes
      // the bar clickable (pointer-events flips with the reveal).
      await msgB.hover();
      let revealed = false;
      for (let i = 0; i < 30; i += 1) {
        const op = await rxns.evaluate((box) => { const q = box.querySelector('.rxn-quick'); return q ? Number(getComputedStyle(q).opacity) : 0; });
        if (op > 0.9) { revealed = true; break; }
        await p.waitForTimeout(50);
      }
      if (revealed) ok(t + ' hovering the message reveals the quick bar (opacity -> 1)'); else bad(t + ' hover reveals quick bar', 'opacity stayed low after hover');

      // #2806 headline ask: a QUICK DEFAULT (thumbs-up/heart/fire) reacts directly.
      await msgB.hover();
      await rxns.locator('.rxn-quick .rxn-pick').first().click();
      await rxns.locator('.rxn').first().waitFor({ timeout: 8000 }).catch(() => {});
      const quickReacted = await rxns.evaluate((box) => {
        const pill = box.querySelector('.rxn');
        return { has: !!pill, count: pill ? (pill.querySelector('.rxn-n') || {}).textContent : null, mine: pill ? pill.classList.contains('mine') : null };
      });
      if (quickReacted.has && quickReacted.count === '1' && quickReacted.mine) ok(t + ' clicking a quick default adds the viewer\'s pill (count 1, mine)'); else bad(t + ' quick-default react', JSON.stringify(quickReacted));
      await rxns.locator('.rxn').first().click();
      await p.waitForTimeout(400);
      const quickOff = await rxns.evaluate((box) => ({ pills: box.querySelectorAll('.rxn').length }));
      if (quickOff.pills === 0) ok(t + ' CONTROL: clicking the quick-default pill again toggles it OFF'); else bad(t + ' quick toggle-off leaves no pill', 'pills=' + quickOff.pills);

      // Click the grey smiley -> the FULL picker (PJ_EMOJI) opens.
      await msgB.hover();
      await rxns.locator('.rxn-more').click();
      const opened = await rxns.evaluate((box) => {
        const picker = document.getElementById('rxn-picker'); const more = box.querySelector('.rxn-more');
        return { shown: picker ? !picker.hidden : null, picks: picker ? picker.querySelectorAll('.rxn-pick').length : -1,
          forThisPost: picker ? (picker.getAttribute('data-post') === box.getAttribute('data-post')) : null,
          expanded: more ? more.getAttribute('aria-expanded') : null };
      });
      if (opened.shown && opened.picks >= 40) ok(t + ' the smiley opens the full picker (' + opened.picks + ' emoji)'); else bad(t + ' full picker reveals', JSON.stringify(opened));
      if (opened.forThisPost) ok(t + ' #2834: the shared picker records the post it was opened for (data-post routing)'); else bad(t + ' shared picker data-post', JSON.stringify(opened));
      if (opened.expanded === 'true') ok(t + ' the smiley reports aria-expanded=true'); else bad(t + ' aria-expanded', String(opened.expanded));

      // #2806 BLOCKER regression: the picker on the BOTTOM post must be actually
      // VISIBLE, not clipped by the thread's overflow. getBoundingClientRect cannot see
      // overflow clipping (it is visual, not layout), so hit-test the picker's centre:
      // a fixed popover is the topmost element there; an overflow-clipped absolute one
      // is not (elementFromPoint returns something else / nothing).
      const vis = await rxns.evaluate((box) => {
        const picker = document.getElementById('rxn-picker');
        if (!picker || picker.hidden) return { ok: false, why: 'hidden' };
        const r = picker.getBoundingClientRect();
        if (!(r.width > 0 && r.height > 0)) return { ok: false, why: 'zero-size' };
        const cx = Math.round(r.left + r.width / 2), cy = Math.round(r.top + r.height / 2);
        const hit = document.elementFromPoint(cx, cy);
        return { ok: !!(hit && (hit === picker || picker.contains(hit))),
          rectTop: Math.round(r.top), rectBottom: Math.round(r.bottom), vh: window.innerHeight,
          hit: hit ? (hit.className || hit.tagName) : null };
      });
      if (vis.ok) ok(t + ' the picker on the BOTTOM post is fully visible (not clipped by the thread overflow)'); else bad(t + ' bottom-post picker visible', JSON.stringify(vis));

      // React with the first emoji in the open shared picker (#2834: it lives at
      // #rxn-picker outside the row, so drive it page-level, not scoped to `rxns`).
      await p.locator('#rxn-picker .rxn-pick').first().click();
      await rxns.locator('.rxn').first().waitFor({ timeout: 8000 }).catch(() => {});
      const reacted = await rxns.evaluate((box) => {
        const pill = box.querySelector('.rxn');
        return { has: !!pill, count: pill ? (pill.querySelector('.rxn-n') || {}).textContent : null,
          mine: pill ? pill.classList.contains('mine') : null, pressed: pill ? pill.getAttribute('aria-pressed') : null };
      });
      if (reacted.has && reacted.count === '1' && reacted.mine && reacted.pressed === 'true') ok(t + ' clicking a picker emoji adds the viewer\'s pill (count 1, mine, pressed)'); else bad(t + ' picker react', JSON.stringify(reacted));
      await rxns.locator('.rxn').first().click();
      await p.waitForTimeout(400);
      const off = await rxns.evaluate((box) => ({ pills: box.querySelectorAll('.rxn').length }));
      if (off.pills === 0) ok(t + ' CONTROL: clicking the picker pill again toggles it OFF'); else bad(t + ' picker toggle-off', 'pills=' + off.pills);

      // #2834: ROUTING TO THE CORRECT POST. Every arm above drives ONE post (the
      // last), so a regression that always routed a shared-picker pick to a FIXED
      // post would pass them all. Open the picker on the FIRST post instead and
      // confirm the pick lands there and NOT on the last post. Both start at 0 pills
      // (the last post was toggled back off just above).
      const firstRow = p.locator('#pj-room .msg').filter({ has: p.locator('.rxns') }).first();
      await firstRow.scrollIntoViewIfNeeded();
      const firstRxns = firstRow.locator('.rxns');
      const firstMsgB = firstRow.locator('.msg-b');
      await firstMsgB.hover();
      await firstRxns.locator('.rxn-more').click();
      await p.waitForTimeout(150);
      const routedTo = await firstRxns.evaluate((box) => {
        const picker = document.getElementById('rxn-picker');
        return picker ? (picker.getAttribute('data-post') === box.getAttribute('data-post')) : null;
      });
      if (routedTo) ok(t + ' #2834: opening the picker on the FIRST post records that post (not the last)'); else bad(t + ' cross-post data-post', String(routedTo));
      await p.locator('#rxn-picker .rxn-pick').first().click();
      await firstRxns.locator('.rxn').first().waitFor({ timeout: 8000 }).catch(() => {});
      const firstGot = await firstRxns.locator('.rxn').count();
      const lastStayed = await rxns.locator('.rxn').count();
      if (firstGot === 1 && lastStayed === 0) ok(t + ' #2834: the pick landed on the post whose smiley opened the picker, NOT another post'); else bad(t + ' cross-post routing', 'first=' + firstGot + ' last=' + lastStayed);
      await firstRxns.locator('.rxn').first().click();   // toggle off, back to a clean 0-pill room
      await p.waitForTimeout(400);

      // #2806: Escape closes an open picker (parity with the composer emoji panel).
      await msgB.hover();
      await rxns.locator('.rxn-more').click();
      await p.waitForTimeout(150);
      await p.keyboard.press('Escape');
      await p.waitForTimeout(150);
      const escaped = await rxns.evaluate((box) => {
        const picker = document.getElementById('rxn-picker'); const more = box.querySelector('.rxn-more');
        return { hidden: picker ? picker.hidden : null, expanded: more ? more.getAttribute('aria-expanded') : null };
      });
      if (escaped.hidden === true && escaped.expanded === 'false') ok(t + ' Escape closes the open picker'); else bad(t + ' Escape closes picker', JSON.stringify(escaped));

      // #2806: an outside click also closes the picker.
      await msgB.hover();
      await rxns.locator('.rxn-more').click();
      await p.waitForTimeout(150);
      await p.mouse.click(5, 5);   // top-left corner, outside any picker
      await p.waitForTimeout(150);
      const outside = await rxns.evaluate(() => { const el = document.getElementById('rxn-picker'); return { hidden: el ? el.hidden : null }; });
      if (outside.hidden === true) ok(t + ' an outside click closes the open picker'); else bad(t + ' outside-click closes picker', JSON.stringify(outside));

      // #2806: scrolling INSIDE the open picker must NOT close it (the emoji grid is
      // taller than its max-height, so the lower rows are only reachable by scrolling).
      // A scroll event dispatched on the picker reaches the document capture listener
      // (capture propagates to descendants even for a non-bubbling event), exactly as a
      // real wheel scroll on it would; the listener must skip it.
      await msgB.hover();
      await rxns.locator('.rxn-more').click();
      await p.waitForTimeout(150);
      const insideScroll = await rxns.evaluate(() => {
        const picker = document.getElementById('rxn-picker');
        if (!picker || picker.hidden) return { ok: false, why: 'picker did not open' };
        picker.scrollTop = 60;
        picker.dispatchEvent(new Event('scroll', { bubbles: false }));
        return { ok: !picker.hidden, hidden: picker.hidden };
      });
      if (insideScroll.ok) ok(t + ' scrolling INSIDE the picker does NOT close it (lower rows stay reachable)'); else bad(t + ' scroll-inside keeps picker open', JSON.stringify(insideScroll));

      // CONTROL: a scroll OUTSIDE the picker DOES still close it (proves the skip above
      // is a targeted exception, not a broken close). Dispatch a scroll on the room.
      const outsideScroll = await p.evaluate(() => {
        const room = document.getElementById('pj-room');
        if (room) room.dispatchEvent(new Event('scroll', { bubbles: false }));
        const picker = document.getElementById('rxn-picker');
        return { hidden: picker ? picker.hidden : null };
      });
      if (outsideScroll.hidden === true) ok(t + ' CONTROL: a scroll outside the picker DOES close it'); else bad(t + ' outside-scroll closes picker', JSON.stringify(outsideScroll));

      // #2834: a ROOM-CONTENT CHANGE while the picker is open must close it. The old
      // inline picker was destroyed by the room rebuild; the shared one is closed
      // explicitly in paintThreadInto when the room re-renders. Open it, post a NEW
      // message (which the room poll repaints in), and confirm the picker closes.
      await msgB.hover();
      await rxns.locator('.rxn-more').click();
      await p.waitForTimeout(150);
      const openedBeforeRepaint = await p.evaluate(() => { const el = document.getElementById('rxn-picker'); return !!(el && !el.hidden); });
      await p.evaluate((pid) => fetch('/api/project/' + pid + '/room',
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'repaint trigger #2834' }) }), made.id);
      let closedByRepaint = false;
      for (let i = 0; i < 60; i += 1) {
        const hidden = await p.evaluate(() => { const el = document.getElementById('rxn-picker'); return !el || el.hidden; });
        if (hidden) { closedByRepaint = true; break; }
        await p.waitForTimeout(200);
      }
      if (openedBeforeRepaint && closedByRepaint) ok(t + ' #2834: a room-content change (a new message) closes an open picker, as the old inline rebuild did'); else bad(t + ' repaint closes picker', 'opened=' + openedBeforeRepaint + ' closed=' + closedByRepaint);

      if (errs.length) bad(t + ' no page errors', errs.join(' | ')); else ok(t + ' no page errors');
      await p.close();
    }
  } catch (e) {
    bad('the check itself', String((e && e.message) || e));
  } finally {
    await browser.close().catch(() => {});
    srv.kill();
  }

  if (ran < 32) { console.log('reactions: only ' + ran + ' checks ran, so this proved nothing'); process.exit(1); }
  if (failures) { console.log('reactions: ' + failures + ' FAILED'); process.exit(1); }
  console.log('reactions: all good, ' + ran + ' checks');
})();
