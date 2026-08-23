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

/**
 * Two agents. One has a long name, because a long name is what pushes a control
 * off the right edge of a two-column row.
 *
 * 🛑 AND THE FIRST ONE'S FOLDER IS NOT CALLED WHAT THE AGENT IS CALLED, which is
 * the ordinary case for a real agent and was the one shape every fixture missed:
 * the row draws "Splinter", Kosmos files it under "claude-bot", and 0.3.8's undo
 * addressed the drawn one and refused every agent it was offered on. The connect
 * answer below names the folder, exactly as the engine does.
 */
const FOUND = {
  ok: true,
  agents: [
    { dir: '/Users/x/work/workers/claude-bot', name: 'Splinter', role: 'Project manager' },
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
      ? { ok: true, name: 'claude-bot', displayName: 'Splinter',
          dir: '/Users/x/work/workers/claude-bot', started: true }
      : { ok: false, because: 'that folder is not there any more' },
    status: connectOk ? 200 : 400,
  }));
  /* 🔑 IT ANSWERS OK ONLY FOR THE REGISTERED NAME. Fulfilling every request the
     same way would make this check pass with the undo addressed to anything at
     all, which is precisely the defect it exists for. */
  let undoAskedFor = null;
  await page.route('**/api/disconnect-agent', (r) => {
    let body = {};
    try { body = JSON.parse(r.request().postData() || '{}'); } catch { body = {}; }
    undoAskedFor = body.name;
    if (body.name !== 'claude-bot') {
      r.fulfill({ status: 400, json: { ok: false, because: 'we have no record of adding that agent' } });
      return;
    }
    r.fulfill({ json: { ok: true, name: 'claude-bot', partial: false, because: '' } });
  });

  await page.goto(`${BASE}/?first-run=1&fr-step=6`, { waitUntil: 'networkidle' });
  /* 🛑 SCOPED TO THE SETUP PANE. The board grew a found list of its own, and
     these selectors were global -- so this check started measuring four rows,
     two of them inside a collapsed fold with a geometry of zero, and reported
     the setup screen as broken. The board's copy has its own check. */
  await page.waitForSelector('#fr-fleet .fr-foundrow', { timeout: 8000 });
  await page.waitForTimeout(300);

  const geom = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#fr-fleet .fr-foundrow')];
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
  const label = await page.evaluate(() => document.querySelector('#fr-fleet .fr-foundgo').textContent);
  await page.click('#fr-fleet .fr-foundrow .fr-foundgo');
  await page.waitForTimeout(400);
  const added = await page.evaluate(() => {
    const row = document.querySelector('#fr-fleet .fr-foundrow');
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
      otherLabel: document.querySelectorAll('#fr-fleet .fr-foundgo')[1].textContent.trim(),
      otherUndoHidden: document.querySelectorAll('#fr-fleet .fr-foundundo')[1].hidden,
      /* 🛑 THE RECEIPT HAS TO BE READABLE. `.btn:disabled` is half opacity, and
         "Added" is the one word telling somebody what happened to their agent.
         It measured 3.43:1 that way, under this project's AA floor. Composited
         here rather than read off the rule, because opacity is what made it
         fail and a colour value alone cannot show that. */
      addedContrast: (() => {
        const cs = getComputedStyle(go);
        const num = (c) => c.match(/[\d.]+/g).map(Number);
        let bg = 'rgba(0, 0, 0, 0)';
        for (let n = go; n && (bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent'); n = n.parentElement) {
          bg = getComputedStyle(n).backgroundColor;
        }
        const b = num(bg).slice(0, 3);
        const f = num(cs.color);
        const op = Number(cs.opacity) * (f.length > 3 ? f[3] : 1);
        const eff = f.slice(0, 3).map((v, i) => v * op + b[i] * (1 - op));
        const lum = (c) => {
          const [r, g2, bl] = c.map((v) => {
            const x = v / 255;
            return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
          });
          return 0.2126 * r + 0.7152 * g2 + 0.0722 * bl;
        };
        const l1 = lum(eff); const l2 = lum(b);
        return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      })(),
    };
  });
  check('Add: the button becomes the receipt', added.label === 'Added' && added.disabled,
    `"${added.label}" disabled=${added.disabled}`);
  check('Add: no sentence is added under the row', added.said === '', `"${added.said}"`);
  check('Add: undo is shown and can be pressed', added.undoShown && added.undoPressable,
    `shown=${added.undoShown} pressable=${added.undoPressable}`);
  check('Add: the receipt clears the AA floor', added.addedContrast >= 4.5,
    `${added.addedContrast.toFixed(2)}:1`);
  check('Add: the other row is untouched', added.otherLabel !== 'Added' && added.otherUndoHidden === true,
    `other="${added.otherLabel}" undoHidden=${added.otherUndoHidden}`);

  // ---- press Undo ---------------------------------------------------------
  await page.click('#fr-fleet .fr-foundrow .fr-foundundo');
  await page.waitForTimeout(400);
  const undone = await page.evaluate(() => {
    const row = document.querySelector('#fr-fleet .fr-foundrow');
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
  check('Undo: it asked for the name the server registered, not the one drawn',
    undoAskedFor === 'claude-bot', `asked for "${undoAskedFor}"`);

  // ---- the failure arm ----------------------------------------------------
  connectOk = false;
  await page.click('#fr-fleet .fr-foundrow .fr-foundgo');
  await page.waitForTimeout(400);
  const failed = await page.evaluate(() => {
    const row = document.querySelector('#fr-fleet .fr-foundrow');
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

  // ---- two rows added at once ---------------------------------------------
  /**
   * 🛑 THE DUPLICATE THE DIRECTORY'S OWN NAME CHECK CANNOT REACH. `named-
   * controls.js` asserts no two visible controls answer to the same name, and it
   * passes on this screen because the undos are HIDDEN until somebody presses
   * Add. Two added rows put two buttons reading "Undo" on screen at once, which
   * to anybody moving through the page by control is two identical choices with
   * no way to tell them apart. Only a check that presses can see it.
   */
  connectOk = true;
  await page.click('#fr-fleet .fr-foundrow .fr-foundgo');
  await page.waitForTimeout(300);
  await page.click('#fr-fleet .fr-foundrow:nth-child(2) .fr-foundgo');
  await page.waitForTimeout(400);
  const names = await page.evaluate(() => {
    const out = [];
    for (const b of document.querySelectorAll('#fr-fleet .fr-foundundo')) {
      if (b.hidden) continue;
      const r = b.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      out.push((b.getAttribute('aria-label') || b.textContent || '').trim());
    }
    return out;
  });
  check('two undos are on screen at once', names.length === 2, JSON.stringify(names));
  check('and they do not answer to the same name', new Set(names).size === names.length,
    JSON.stringify(names));
  /* ⚠️ WCAG's label-in-name: somebody speaking "undo" at a voice control must
     reach the button that reads Undo, so the accessible name has to contain the
     visible word rather than replace it. */
  check('each still answers to the word it shows', names.every((n) => /\bundo\b/i.test(n)),
    JSON.stringify(names));

  check('no page errors', errors.length === 0, errors.join(' | '));

  await browser.close();
  const failedChecks = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failedChecks.length}/${results.length} passed`);
  process.exit(failedChecks.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
