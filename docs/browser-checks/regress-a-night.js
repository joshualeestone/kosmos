'use strict';

/**
 * Everything two nights of releases added, drawn together on one build.
 *
 * ⚠️ WHY THIS EXISTS SEPARATELY FROM THE OTHER CHECKS HERE. Each of those pins
 * one surface. This one pins that twenty-one releases still COMPOSE: the three
 * board layouts, four Settings switches, the accounts list, Delete history and
 * a task page with parts, in both themes, on one page load. Every one of those
 * was verified when it shipped and then had hours of other work land on top of
 * it, which is the moment nobody looks again.
 *
 * 🔑 IT ASSERTS COMPUTED STATE, not pixels. Border widths, `aria-checked`,
 * which container is hidden, derived text. A screenshot diff would fail on a
 * font hint and pass on a missing rule; these fail only when the claim is
 * false.
 *
 * Run against a sandboxed board (never the operator's real data):
 *
 *   AGENT_WORKFORCE_DATA=/tmp/regress PORT=17340 node server.js &
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" \
 *     KOSMOS_URL=http://127.0.0.1:17340 node docs/browser-checks/regress-a-night.js
 *
 * It needs one project called "Regression Sweep" with two members and one task
 * carrying two parts; `seed()` below prints the four lines that make it.
 *
 * ⚠️ HEADED by default, like its neighbours. `HEADED=0` on a machine with no
 * console session.
 */

const { chromium } = require('playwright');

const URL = process.env.KOSMOS_URL || 'http://127.0.0.1:17340';
const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

function seed() {
  console.log(`  const projects = require('./engine/projects'), tasks = require('./engine/tasks');
  const p = projects.create({ name: 'Regression Sweep' });
  projects.writeAll(projects.readAll().map((x) => (x.id === p.id ? { ...x, agents: ['april', 'mikey'] } : x)));
  tasks.create(p.id, { sentence: 'A task with parts', who: 'april' });
  tasks.addPart(p.id, 1, { sentence: 'Second piece' });`);
}

(async () => {
  if (process.argv.includes('--seed')) { seed(); return; }
  const b = await chromium.launch({ headless: process.env.HEADED === '0' });
  for (const theme of ['light', 'dark']) {
    const pg = await b.newPage({ viewport: { width: 1500, height: 1000 }, colorScheme: theme });
    const errs = [];
    pg.on('pageerror', (e) => errs.push(e.message));
    pg.on('console', (m) => {
      if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text());
    });
    await pg.goto(URL, { waitUntil: 'networkidle' });
    if (!(await pg.$('#firstrun[hidden]'))) { await pg.keyboard.press('Escape'); await pg.waitForTimeout(500); }
    await pg.waitForTimeout(1400);

    /* ⚠️ SCOPED TO THE AGENTS TOGGLE. `[data-layout="grid"]` matches TWO
       buttons -- the projects screen has its own pair -- and the first in the
       DOM is the projects one, which is hidden. A selector resolving to two
       elements and silently taking the first is the class this whole directory
       exists for. */
    for (const layout of ['grid', 'list', 'org']) {
      await pg.click('.viewtoggle[data-scope="agents"] [data-layout="' + layout + '"]');
      await pg.waitForTimeout(700);
      const state = await pg.evaluate(() => ({
        grid: document.getElementById('grid').hidden,
        list: document.getElementById('alist').hidden,
        org: document.getElementById('orgview').hidden,
      }));
      const shown = Object.keys(state).filter((k) => state[k] === false);
      /* 🔑 EXACTLY ONE. The two-layout version tested `!== 'list'`, which is
         true for `org` -- so the grid stayed on UNDERNEATH the chart, and any
         check asking only "is the org view visible" passed. */
      chk(shown.length === 1, theme + ': ' + layout + ' shows exactly one container', JSON.stringify(shown));
    }
    chk((await pg.evaluate(() => document.querySelectorAll('.onode').length)) > 0,
      theme + ': the org chart draws');

    await pg.click('.tab:has-text("Settings")');
    await pg.waitForTimeout(1800);
    const sw = await pg.evaluate(() => ['lim-toggle', 'tell-toggle', 'notify-toggle', 'auto-toggle', 'eng-toggle']
      .map((id) => document.getElementById(id).getAttribute('aria-checked')));
    /* Every switch is born `mixed` and must resolve. A switch still reading
       mixed after a good load means its fetch never landed. */
    chk(sw.every((x) => x === 'true' || x === 'false'),
      theme + ': all five switches resolved', JSON.stringify(sw));
    /* Settings is sections since settings-nav; the reads below are by id and
       do not need a rect, but the section is opened anyway so a later rect
       assertion added here does not inherit a hidden element. */
    await pg.click('#s-nav button[data-go="accounts"]');
    await pg.waitForTimeout(200);
    chk((await pg.evaluate(() => document.querySelectorAll('#set-accounts .acct-box').length)) > 0,
      theme + ': the accounts list is read, not asserted');
    await pg.click('#s-nav button[data-go="advanced"]');
    await pg.waitForTimeout(200);
    const hist = await pg.evaluate(() => { const el = document.getElementById('hist-count'); return el.getBoundingClientRect().height > 0 ? el.innerText : ''; });
    chk(/nothing here to delete|Right now/.test(hist), theme + ': delete-history says what is there', hist);

    await pg.click('.tab:has-text("Projects")'); await pg.waitForTimeout(500);
    await pg.click('text=Regression Sweep'); await pg.waitForTimeout(700);
    const door = await pg.$('#pj-alltasks:not([hidden])');
    if (door) { await door.click(); await pg.waitForTimeout(300); }
    await pg.click('.tkcard'); await pg.waitForTimeout(700);
    const tk = await pg.evaluate(() => ({
      parts: document.querySelectorAll('.tkpart').length,
      state: (document.getElementById('tk-state').getBoundingClientRect().height > 0 ? document.getElementById('tk-state').innerText : '').trim(),
      pickable: document.querySelectorAll('[data-pick-part]').length,
      tops: [...document.querySelectorAll('.tkpart')]
        .map((r) => Math.round(parseFloat(getComputedStyle(r).borderTopWidth) || 0)),
      addTop: Math.round(parseFloat(getComputedStyle(document.querySelector('.tkpart-add')).borderTopWidth) || 0),
    }));
    chk(tk.parts === 2, theme + ': two parts draw', String(tk.parts));
    chk(tk.state === '0 of 2 parts done', theme + ': the state is derived from the parts', tk.state);
    chk(tk.pickable === 2, theme + ': both parts can be assigned');
    /* 🛑 THE SEPARATOR, WHICH SHIPPED WRONG ONCE. A `:last-of-type` cancel
       selected zero elements because the Add row is the last div, so every task
       drew a stray rule above the input. Between-siblings cannot break that
       way, and this is what says so. */
    chk(tk.tops[0] === 0 && tk.tops[1] === 1 && tk.addTop === 0,
      theme + ': the rule sits between parts and not above the Add row',
      JSON.stringify(tk.tops) + ' add ' + tk.addTop);

    /* ══ the night of 2026-08-22, fifteen more releases ══════════════════
       Added for the same reason as everything above: each of these was
       verified when it shipped and then had hours of other work land on top of
       it. What is pinned here is that they still COMPOSE on one build, not that
       they work, which their own tests already say. */

    /* The restart control (#259) and its confirmation (#144's remedy path).
       Since agent-page-nav it lives in the Memory section as "Fresh start",
       and Remove has a section of its own, so the page is opened and then the
       Memory pill is clicked before anything is read; the membership test
       (web.agent-nav.test.js) pins where it lives, this pins that it draws.
       ⚠️ BACK TO THE AGENTS TAB AND THE GRID FIRST, in that order. The checks
       above leave the page on a task, and the layout loop leaves the agents
       view on `org`, which draws no `.acard` at all. Each of those made a click
       here time out for thirty seconds and read as the control being missing
       rather than as the wrong screen being open, which is the same
       could-not-look-reported-as-a-finding this file exists to avoid. */
    await pg.evaluate(() => showTab('agents'));
    await pg.waitForTimeout(700);
    await pg.click('.viewtoggle[data-scope="agents"] [data-layout="grid"]');
    await pg.waitForTimeout(600);
    await pg.locator('.acard .namego').first().click();
    await pg.waitForTimeout(1600);
    /* The instructions lede is read on ITS screen (#687). This check used
       to read it from the Memory screen by textContent, where it is not
       drawn, and passed on a sentence nobody was looking at. The lede is
       painted per agent now (#198), so it must not be the generic once a
       panel is open. */
    await pg.click('#d-nav button[data-go="instr"]');
    await pg.waitForTimeout(300);
    const instrLede = await pg.evaluate(() => {
      const el = document.getElementById('d-instr-lede');
      return el && el.getBoundingClientRect().height > 0 ? el.innerText : '';
    });
    chk(/the only thing that survives a restart/.test(instrLede),
      theme + ': the instructions lede states the consequence, on screen', instrLede.slice(0, 40));
    chk(!/^What this agent is for/.test(instrLede), theme + ': the lede names the agent');
    await pg.click('#d-nav button[data-go="memory"]');
    await pg.waitForTimeout(300);
    /* ⚠️ RE-EXPRESSED, NOT LOOSENED (2026-08-24). The original pins read an
       .fhint INSIDE the restart box and its on-page consequence sentence --
       a layout Josh retired at 19:57 on 08-23 for the pack's shape: three
       fat stacked buttons (Compact / Clear / Restart) under one lede, with
       the consequence moved to the confirmation dialog every press passes
       through ("one copy, at the moment of choice", the markup's own
       comment). Measuring the old shape crashed on a null .fhint, which
       read as a fixture gap and was actually a design supersession. The
       replacement pins the CURRENT design's own promises: the lede, all
       three buttons drawn in the stack, and (below, on the open dialog)
       the consequence sentence at its new home. */
    const rst = await pg.evaluate(() => {
      const box = document.getElementById('d-restart-agent');
      const rm = document.getElementById('d-remove-agent');
      const lede = document.getElementById('d-fresh-lede');
      return {
        shown: box && !box.hidden && box.getBoundingClientRect().height > 0,
        removeOffscreen: rm && rm.getBoundingClientRect().height === 0,
        freshLede: lede && lede.getBoundingClientRect().height > 0 ? lede.innerText : null,
        stack: ['d-compact-go', 'd-clear-go', 'd-restart-start']
          .map((id) => { const b = document.getElementById(id); return Boolean(b && b.getBoundingClientRect().height > 0); }),
        saves: [...document.querySelectorAll('#d-instr-save, #d-save')].map((b) => b.getAttribute('aria-label')),
      };
    });
    chk(rst.shown && rst.removeOffscreen, theme + ': restart draws in the Memory section, and Remove is not on that screen');
    /* freshStartLabel paints the agent's NAME into the lede on open, so the
       generic "it" appearing here would itself be a regression. */
    chk(/^Three ways to get .{1,40} going again, whatever the reason\./.test(rst.freshLede || ''),
      theme + ': the fresh-start lede is the pack’s sentence, named and drawn', String(rst.freshLede).slice(0, 60));
    chk(rst.stack.every(Boolean),
      theme + ': all three fresh-start buttons draw, stacked', JSON.stringify(rst.stack));
    /* 🔑 TWO SAVES, TWO NAMES. A screen reader heard one word for both. */
    chk(new Set(rst.saves.filter(Boolean)).size === 2,
      theme + ': the two Save buttons answer to different names', JSON.stringify(rst.saves));

    await pg.click('#d-restart-start');
    await pg.waitForTimeout(600);
    const dlg = await pg.evaluate(() => {
      const m = document.getElementById('rst-modal');
      const box = m.querySelector('.rm-box');
      return { open: !m.hidden, h: Math.round(box.getBoundingClientRect().height),
        title: (() => { const el = document.getElementById('rst-title'); return el.getBoundingClientRect().height > 0 ? el.innerText : ''; })(),
        small: (() => { const el = document.getElementById('rst-small'); return el.getBoundingClientRect().height > 0 ? el.innerText : ''; })(),
        focused: document.activeElement && document.activeElement.id };
    });
    chk(dlg.open && dlg.h > 100, theme + ': the restart confirmation opens and is drawn', String(dlg.h));
    chk(/^Restart /.test(dlg.title), theme + ': it names the agent', dlg.title);
    /* Only `clear` may say nothing is pending, and this board's agents have
       never reported, so the dialog must NOT claim they are clear. */
    chk(!/is not part way through anything/.test(dlg.small),
      theme + ': an unreported agent is not called clear', dlg.small.slice(0, 60));
    /* The consequence sentence's new home (the 08-23 pack match): the
       dialog, which every press passes through. The fixture agents have
       never reported, so restartCost's unknown arm speaks, and its closing
       consequence is the one pinned. */
    chk(/Restarting ends anything it had in flight/.test(dlg.small),
      theme + ': the consequence lives in the dialog, at the moment of choice', dlg.small.slice(0, 80));
    chk(dlg.focused === 'rst-keep', theme + ': it opens on the harmless answer', String(dlg.focused));
    await pg.keyboard.press('Escape');
    await pg.waitForTimeout(300);
    chk(await pg.evaluate(() => document.getElementById('rst-modal').hidden),
      theme + ': Escape leaves it running');

    /* The create form: the model hint and the disclosure (#202), and the tell
       box reading the standing answer (#258). */
    /* Back to the board: the detail panel is still open from the block above,
       and `#new-agent` lives on the board behind it. Third time in this file a
       click has needed the previous screen closed first, which is what happens
       when checks share one page in sequence. */
    await pg.evaluate(() => showTab('agents'));
    await pg.waitForTimeout(700);
    await pg.click('#new-agent');
    await pg.waitForTimeout(400);
    await pg.click('#pick-pm');
    await pg.click('#role-next');
    await pg.waitForTimeout(700);
    /* Step two is three dropdowns since Josh's redesign (provider, account,
       model); the model list behind a disclosure lives on first run only.
       This asserted the old shape on the new screen and was red for a week
       for a non-defect (#344). What is pinned now is the shape that ships:
       the three controls exist, the model menu has choices, the provider is
       Anthropic. */
    const create = await pg.evaluate(() => {
      const sel = (id) => document.getElementById(id);
      const tell = sel('create-tell');
      const model = sel('create-model');
      const shown = (el) => (el && el.getBoundingClientRect().height > 0 ? el.innerText : ''); // rendered text (#687)
      return { hint: shown(document.querySelector('#cstep-name p.shint')),
        provider: sel('create-provider') ? sel('create-provider').value : null,
        account: !!sel('create-account'),
        models: model ? model.querySelectorAll('option').length : 0,
        tellDisabled: tell.disabled, tellChecked: tell.checked,
        note: shown(sel('create-tell-note')) };
    });
    chk(/You can change this later/.test(create.hint || ''), theme + ': the model hint is there');
    chk(create.provider !== null && create.account && create.models >= 2,
      theme + ': provider, account and model menus, with models to pick from', JSON.stringify(create));
    /* The setting is on by default on a fresh board, so the box is usable and
       says nothing. What must never happen is checked-and-disabled, or a note
       with the box enabled. */
    chk(create.tellChecked !== create.tellDisabled,
      theme + ': the tell box agrees with itself', JSON.stringify([create.tellChecked, create.tellDisabled]));

    chk(errs.length === 0, theme + ': no console errors', errs.slice(0, 2).join(' | '));
    await pg.close();
  }
  await b.close();
  console.log(fail.length ? '\n' + fail.length + ' FAILED: ' + fail.join('; ') : '\nall green');
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error('HARNESS FAILED', e.message); process.exit(2); });
