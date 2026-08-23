/**
 * The board's panel for agents on this Mac that Kosmos is not looking after.
 *
 * 🛑 IT IS THE ROUTE IN FOR EVERYBODY WHO ALREADY HAD KOSMOS. The find-your-
 * agents list shipped inside first run, so the people it was written for -- the
 * ones with agents Kosmos could not see -- had all finished first run and could
 * not reach it. This panel is the whole fix, and if it does not draw, they are
 * back to uninstalling.
 *
 * 🔑 WHAT NO SOURCE TEST CAN SEE HERE: whether the panel appears on the board at
 * all (it is painted by the poll, not by the page load), where it sits relative
 * to the grid, and whether its rows can be pressed. The stub-based tests measure
 * the decision; this measures the screen.
 *
 * ⚠️ THE ROUTES ARE INTERCEPTED, so nothing here starts an agent.
 *
 * ⚠️ NEEDS A SANDBOX WITH FIRST RUN ALREADY COMPLETE, or the onboarding overlay
 * sits over the board and every click times out against it -- which reads as the
 * panel being unpressable rather than as the wrong screen being in front. The
 * flag the engine reads is `completedAt`, not `done`:
 *
 *     echo '{"completedAt":"2026-01-01T00:00:00.000Z"}' \
 *       > "$SB/data/AgentWorkforce/first-run.json"
 *
 * 🔑 AND SEED ONE REMOVED AGENT, or the above-the-removed-ones assertion reports
 * itself SKIPPED: that panel is absent on a machine that has removed nothing,
 * and a hidden element measures a top of 0, which is above everything.
 *
 *     printf '%s' '[{"name":"oldbob","shownAs":"Old Bob","removedAt":"2026-01-01T00:00:00.000Z","stopped":true}]' \\
 *       > "$SB/data/AgentWorkforce/removed.json"
 *
 * Run: see the README in this directory.
 */
'use strict';

const playwright = require('playwright');

const BASE = process.argv[2] || 'http://127.0.0.1:4399';
const HEADED = process.env.HEADED !== '0';

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
}

/* One agent Kosmos has and two it does not. The one it has must not appear:
   offering somebody their own fleet back is the panel's worst failure, and it is
   the one that looks like it is working. */
const FOUND = {
  ok: true,
  agents: [
    { dir: '/Users/x/work/workers/claude-bot', name: 'Splinter', role: 'Project manager', already: false },
    { dir: '/Users/x/work/workers/anna', name: 'Anna', role: 'Copywriter', already: false },
    { dir: '/Users/x/work/workers/kept', name: 'Kept', role: 'Editor', already: true },
  ],
};

(async () => {
  const browser = await playwright.chromium.launch({ headless: !HEADED });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message)));

  /* 🛑 THE ANSWER CHANGES AFTER AN ADD, exactly as the engine's does: the agent
     that was just added comes back `already: true` on the next poll, so the set
     shrinks and its signature changes. Without that, the "survives a poll"
     assertion below is vacuous -- the panel would decline to repaint anyway
     because nothing had changed, and the guard it means to test could be deleted
     with the check still green. Measured: it was, and it was. */
  let added = false;
  await page.route('**/api/found-agents', (r) => r.fulfill({
    json: {
      ok: true,
      agents: FOUND.agents.map((a) => (added && a.name === 'Splinter' ? { ...a, already: true } : a)),
    },
  }));
  await page.route('**/api/connect-agent', (r) => {
    added = true;
    r.fulfill({
      json: { ok: true, name: 'claude-bot', displayName: 'Splinter',
        dir: '/Users/x/work/workers/claude-bot', started: true },
    });
  });

  await page.goto(BASE + '/?tab=agents', { waitUntil: 'networkidle' });
  /* 🔑 THE FOLD IS SHUT ON ARRIVAL (Josh, 2026-08-23), so this opens it the way
     a person does -- through the control, not by setting `hidden` from script.
     A check that reached past the toggle would pass with the toggle broken. */
  await page.waitForSelector('#found-toggle', { timeout: 10000 });
  const shut = await page.evaluate(() => ({
    listHidden: document.getElementById('found-list').hidden,
    label: document.getElementById('found-toggle').textContent,
  }));
  check('it arrives shut, and says what it holds', shut.listHidden && /^Show /.test(shut.label),
    `hidden=${shut.listHidden} "${shut.label}"`);
  await page.click('#found-toggle');
  await page.waitForSelector('#found-list .fr-foundrow', { timeout: 8000 });
  await page.waitForTimeout(400);

  const seen = await page.evaluate(() => {
    const wrap = document.getElementById('found-wrap');
    const rows = [...wrap.querySelectorAll('.fr-foundrow')];
    const grid = document.getElementById('grid');
    const removed = document.getElementById('removed-wrap');
    const w = wrap.getBoundingClientRect();
    const g = grid ? grid.getBoundingClientRect() : null;
    const rm = removed ? removed.getBoundingClientRect() : null;
    const first = rows[0] && rows[0].querySelector('.fr-foundgo');
    /* 🛑 SCROLLED INTO VIEW FIRST. `elementFromPoint` is VIEWPORT-relative, and
       this panel now sits under the cards -- so on any board with more than a
       screenful of agents the hit test lands outside the window and answers
       null, which reads as "the button cannot be pressed" for a button that is
       perfectly fine. Cost one red run to find, on the very move that put it
       down here. */
    if (first) first.scrollIntoView({ block: 'center' });
    const fr = first ? first.getBoundingClientRect() : null;
    const at = fr ? document.elementFromPoint(fr.left + fr.width / 2, fr.top + fr.height / 2) : null;
    return {
      hidden: wrap.hidden,
      names: rows.map((r) => (r.querySelector('.fr-foundname') || {}).textContent),
      heading: (document.getElementById('found-toggle') || {}).textContent || '',
      /* 🔑 UNDER THE CARDS AND OVER THE REMOVED ONES (Josh, 2026-08-23). Read
         off the laid-out boxes rather than off the markup order, because that
         is the fact he asked for: a person looks at where things are.
         ⚠️ THE REMOVED PANEL IS HIDDEN ON A MACHINE THAT HAS REMOVED NOTHING,
         and a hidden element measures a top of 0 -- which is above everything,
         so the assertion would be vacuously false rather than skipped. Its
         presence is asked for separately. */
      belowGrid: Boolean(g && g.height > 0 && w.top >= g.bottom - 1),
      removedShown: Boolean(rm && rm.height > 0),
      aboveRemoved: Boolean(rm && rm.height > 0 && w.bottom <= rm.top + 1),
      painted: w.width > 100 && w.height > 40,
      pressable: Boolean(at && at.closest && at.closest('.fr-foundgo') === first),
    };
  });

  check('the panel is on the board', !seen.hidden && seen.painted,
    `hidden=${seen.hidden} ${JSON.stringify(seen.names)}`);
  check('it sits below the cards', seen.belowGrid);
  check(seen.removedShown ? 'it sits above the removed ones' : 'it sits above the removed ones (SKIPPED: nothing removed on this machine)',
    seen.removedShown ? seen.aboveRemoved : true,
    seen.removedShown ? '' : 'remove an agent in this sandbox to exercise it');
  check('it offers the agents Kosmos does not have', seen.names.includes('Splinter') && seen.names.includes('Anna'),
    JSON.stringify(seen.names));
  check('it does NOT offer the one Kosmos already has', !seen.names.includes('Kept'),
    JSON.stringify(seen.names));
  check('the count is the number offered, not the number found', /2 agents/.test(seen.heading),
    `"${seen.heading}"`);
  check('its buttons can be touched', seen.pressable);

  // ---- press Add, then hold through a poll --------------------------------
  await page.click('#found-list .fr-foundrow .fr-foundgo');
  await page.waitForTimeout(400);
  const pressed = await page.evaluate(() => {
    const row = document.querySelector('#found-list .fr-foundrow');
    return {
      label: row.querySelector('.fr-foundgo').textContent.trim(),
      undoShown: !row.querySelector('.fr-foundundo').hidden,
    };
  });
  check('Add on a board row works the same as in setup',
    pressed.label === 'Added' && pressed.undoShown, `"${pressed.label}" undo=${pressed.undoShown}`);

  /* 🛑 THE POLL MUST NOT EAT IT. The board repaints every five seconds, and a
     panel that rebuilt itself would throw away every "Added" on the screen. This
     is the assertion the stub tests cannot make, because they do not have a
     poll. */
  await page.waitForTimeout(6500);
  const survived = await page.evaluate(() => {
    const row = document.querySelector('#found-list .fr-foundrow');
    if (!row) return { label: '(the panel went away)', undo: false };
    return {
      label: row.querySelector('.fr-foundgo').textContent.trim(),
      undo: !row.querySelector('.fr-foundundo').hidden,
    };
  });
  check('the press survives a board poll', survived.label === 'Added', `"${survived.label}"`);
  /* 🔑 AND SO DOES THE UNDO, which is the half that matters. A repaint would
     take away the control somebody reaches for when they realise they pressed
     the wrong row -- at the exact moment they are reaching for it. */
  check('so does the undo it offered', survived.undo === true);

  check('no page errors', errors.length === 0, errors.join(' | '));

  await browser.close();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
