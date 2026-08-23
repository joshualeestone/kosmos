/**
 * Add and Undo on the found-agents row, pressed for real in a browser.
 *
 * 🛑 EVERY ASSERTION HERE IS ABOUT SOMETHING NO SOURCE TEST CAN SEE. The row was
 * restacked into two columns so the buttons sit on the far right, and Undo only
 * exists after a press -- so what could break is the layout (a control pushed off
 * the row by a long name), and the press itself (a handler naming an element the
 * paint stopped building). The suite reads text; a dead button reads as correct
 * text.
 *
 * 🔑 THE ROUTES ARE INTERCEPTED, NOT CALLED. Add installs a launch job and starts
 * a session, and Undo boots one out. Both are fulfilled here by the browser, so
 * this drives the real handlers and the real DOM without touching the machine.
 * That is the whole reason this check can press the buttons at all.
 *
 * ⚠️ IT ASKS WHETHER THE CONTROL CAN BE TOUCHED, not only whether it is painted.
 * A sibling check in this directory measured a page it had left `inert`: every
 * geometry green, every click timing out. `elementFromPoint` is the question a
 * screenshot cannot answer.
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

/* Two agents, one of them with a long name, because a long name is what pushes a
   control off the right edge of a two-column row. */
const FOUND = {
  ok: true,
  agents: [
    { dir: '/Users/x/work/workers/mike', name: 'mike', role: 'Copywriter' },
    { dir: '/Users/x/work/agents/rosalind-the-research-assistant',
      name: 'rosalind-the-research-assistant', role: 'Research assistant' },
  ],
};

(async () => {
  const browser = await playwright.chromium.launch({ headless: !HEADED });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message)));
  /* ⚠️ THE FAILURE ARM ANSWERS 400 ON PURPOSE, and the browser logs that as a
     resource error -- the exercise working, not a rendering problem. Keyed on
     the resource URL rather than a counter: a console event cannot race a URL
     match, and a 400 from any OTHER route still reports. */
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const src = (m.location() && m.location().url) || '';
    if (/\b400\b/.test(m.text()) && src.includes('/api/connect-agent')) return;
    /* A sandbox nobody has set a picture in has no avatar to serve, and this
       screen is not what that belongs to. */
    if (/\b404\b/.test(m.text()) && src.includes('/api/you/avatar')) return;
    errors.push(`console: ${m.text()} <- ${src}`);
  });

  /* The board's own answer for the step this screen belongs to, then the two
     writes. `connected` flips so the failure arm can be driven on the second row
     without a second page load. */
  let connectOk = true;
  await page.route('**/api/found-agents', (r) => r.fulfill({ json: FOUND }));
  await page.route('**/api/first-run', (r) => r.fulfill({
    /* 🔑 THE `create` PATH, WHICH IS THE ONE THAT LOOKS ON THE DISK. `adopt` is
       for agents tmux can already see; this list exists for the person tmux
       shows nothing for, which is the defect it was built after. */
    json: { done: false, path: 'create', fleetCount: 0, known: true },
  }));
  await page.route('**/api/connect-agent', (r) => r.fulfill({
    json: connectOk
      ? { ok: true, name: 'mike', displayName: 'Mike', dir: '/Users/x/work/workers/mike', started: true }
      : { ok: false, because: 'that folder is not there any more' },
    status: connectOk ? 200 : 400,
  }));
  await page.route('**/api/disconnect-agent', (r) => r.fulfill({
    json: { ok: true, name: 'mike', partial: false, because: '' },
  }));

  await page.goto(`${BASE}/?first-run=1&fr-step=6`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.fr-foundrow', { timeout: 8000 });
  await page.waitForTimeout(300);

  const geom = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.fr-foundrow')];
    return rows.map((row) => {
      const r = row.getBoundingClientRect();
      const go = row.querySelector('.fr-foundgo');
      const undo = row.querySelector('.fr-foundundo');
      const name = row.querySelector('.fr-foundname');
      const g = go.getBoundingClientRect();
      const n = name.getBoundingClientRect();
      /* Can the button be touched where it is drawn? A control the layout has
         pushed under something else measures correctly and cannot be pressed. */
      const at = document.elementFromPoint(g.left + g.width / 2, g.top + g.height / 2);
      return {
        rowH: Math.round(r.height),
        rowRight: Math.round(r.right),
        btnRight: Math.round(g.right),
        btnTop: Math.round(g.top),
        nameBottom: Math.round(n.bottom),
        overflows: Math.round(g.right) > Math.round(r.right),
        hitsButton: Boolean(at && at.closest && at.closest('.fr-foundgo') === go),
        undoHidden: undo ? undo.hidden : null,
        undoThere: Boolean(undo),
      };
    });
  });

  check('both rows painted', geom.length === 2, `${geom.length} rows`);
  for (const [i, g] of geom.entries()) {
    check(`row ${i}: undo exists and is hidden before any press`, g.undoThere && g.undoHidden === true,
      `there=${g.undoThere} hidden=${g.undoHidden}`);
    check(`row ${i}: the button is on the far right, inside the row`,
      !g.overflows && g.rowRight - g.btnRight < 24,
      `row right ${g.rowRight}, button right ${g.btnRight}`);
    /* 🔑 THE POINT OF THE RESTACK: the button shares the row's vertical band
       rather than sitting under the text. Stacked, its top was below the name. */
    check(`row ${i}: the button is beside the text, not under it`, g.btnTop < g.nameBottom,
      `button top ${g.btnTop}, name bottom ${g.nameBottom}`);
    check(`row ${i}: the button can actually be touched`, g.hitsButton);
    /* Two lines of text plus padding. A row that has grown by a button-height is
       the layout this change exists to undo. */
    check(`row ${i}: the row is short`, g.rowH <= 84, `${g.rowH}px`);
  }

  // ---- press Add ----------------------------------------------------------
  const label = await page.evaluate(() => document.querySelector('.fr-foundgo').textContent);
  await page.click('.fr-foundrow .fr-foundgo');
  await page.waitForTimeout(400);
  const added = await page.evaluate(() => {
    const row = document.querySelector('.fr-foundrow');
    const go = row.querySelector('.fr-foundgo');
    const undo = row.querySelector('.fr-foundundo');
    const u = undo.getBoundingClientRect();
    const at = document.elementFromPoint(u.left + u.width / 2, u.top + u.height / 2);
    return {
      label: go.textContent.trim(),
      disabled: go.disabled,
      done: row.classList.contains('done'),
      said: row.querySelector('.fr-foundsaid').textContent.trim(),
      undoShown: !undo.hidden && u.width > 0 && u.height > 0,
      undoPressable: Boolean(at && at.closest && at.closest('.fr-foundundo') === undo),
      /* The second row must be untouched: this screen is one somebody presses
         several buttons on, and a repaint would throw away the others. */
      otherLabel: document.querySelectorAll('.fr-foundgo')[1].textContent.trim(),
      otherUndoHidden: document.querySelectorAll('.fr-foundundo')[1].hidden,
    };
  });
  check('Add: the button becomes the receipt', added.label === 'Added' && added.disabled,
    `"${added.label}" disabled=${added.disabled}`);
  check('Add: no sentence is added under the row', added.said === '', `"${added.said}"`);
  check('Add: undo is shown and can be pressed', added.undoShown && added.undoPressable,
    `shown=${added.undoShown} pressable=${added.undoPressable}`);
  check('Add: the other row is untouched', added.otherLabel !== 'Added' && added.otherUndoHidden === true,
    `other="${added.otherLabel}" undoHidden=${added.otherUndoHidden}`);

  // ---- press Undo ---------------------------------------------------------
  await page.click('.fr-foundrow .fr-foundundo');
  await page.waitForTimeout(400);
  const undone = await page.evaluate(() => {
    const row = document.querySelector('.fr-foundrow');
    const go = row.querySelector('.fr-foundgo');
    const undo = row.querySelector('.fr-foundundo');
    return {
      label: go.textContent.trim(),
      disabled: go.disabled,
      done: row.classList.contains('done'),
      undoHidden: undo.hidden,
      said: row.querySelector('.fr-foundsaid').textContent.trim(),
    };
  });
  check('Undo: the row goes back to the words it was built with',
    undone.label === label.trim() && !undone.disabled,
    `"${undone.label}" (was "${label.trim()}") disabled=${undone.disabled}`);
  check('Undo: the undo control goes away again', undone.undoHidden === true);
  check('Undo: the row is no longer marked done', undone.done === false);
  check('Undo: nothing is left on the status line', undone.said === '', `"${undone.said}"`);

  // ---- the failure arm ----------------------------------------------------
  connectOk = false;
  await page.click('.fr-foundrow .fr-foundgo');
  await page.waitForTimeout(400);
  const failed = await page.evaluate(() => {
    const row = document.querySelector('.fr-foundrow');
    const said = row.querySelector('.fr-foundsaid');
    const s = said.getBoundingClientRect();
    return {
      said: said.textContent.trim(),
      /* Painted, not merely set: an empty-rule display:none would hide it. */
      visible: s.width > 0 && s.height > 0,
      label: row.querySelector('.fr-foundgo').textContent.trim(),
      disabled: row.querySelector('.fr-foundgo').disabled,
      undoHidden: row.querySelector('.fr-foundundo').hidden,
    };
  });
  check('failed Add: the row says why, on screen', /not there any more/.test(failed.said) && failed.visible,
    `"${failed.said}" visible=${failed.visible}`);
  check('failed Add: the button is pressable again', !failed.disabled && failed.label === label.trim(),
    `"${failed.label}" disabled=${failed.disabled}`);
  check('failed Add: no undo is offered for something that did not happen',
    failed.undoHidden === true);

  check('no page errors', errors.length === 0, errors.join(' | '));

  await browser.close();
  const failedChecks = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failedChecks.length}/${results.length} passed`);
  process.exit(failedChecks.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
