/**
 * Step two of Create an agent, as Josh reshaped it on 2026-08-22.
 *
 * 🔑 EVERY ASSERTION HERE IS ABOUT SOMETHING A SOURCE TEST CANNOT SEE. The
 * changes were: no rules between the fields, half-width controls, a different
 * section order, and three menus drawn stepped with an elbow between them. A
 * border that lost the cascade, a width that lost to `flex: 1`, and an elbow
 * whose two edges do not meet all read as correct in the diff.
 *
 * ⚠️ THIS FILE REPLACES `render-model-more.js`, which pinned the closed
 * disclosure that used to list the other providers. That control no longer
 * exists: the providers are a menu now, with everything but Anthropic disabled.
 * The old file is deleted rather than left passing on its first four
 * assertions, which is what it was doing -- its fifth already failed on main,
 * because a SECOND `.smore` exists in the first-run pane and its locator
 * resolved to two elements. A check that half-passes on a control that is gone
 * is worse than no check.
 *
 * ⚠️ IT ASSERTS AN ELEMENT IS PAINTED BEFORE IT ASSERTS WHERE THE ELEMENT IS.
 * A hidden element reports a bottom of 0, which is above everything, so an
 * ordering assertion about something not on screen is vacuously true. That is
 * how a sibling check in this directory passed with its paint deleted.
 *
 * Needs a sandbox with first run already complete -- see the README.
 *
 * Run: see the README in this directory.
 */
'use strict';

const playwright = require('playwright');

const BASE = process.argv[2] || 'http://127.0.0.1:4399';
const ENGINES = ['chromium', 'webkit'];

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
}

(async () => {
  for (const engine of ENGINES) {
    const browser = await playwright[engine].launch({ headless: true });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1200 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e.message)));

    await page.goto(BASE + '/?tab=create', { waitUntil: 'load' });
    await page.waitForSelector('#pick-pm:not([hidden])', { timeout: 8000 });
    await page.evaluate(() => {
      document.getElementById('pick-pm').click();
      document.getElementById('role-next').click();
    });
    await page.waitForFunction(() => !document.getElementById('cstep-name').hidden, null, { timeout: 8000 });
    await page.waitForTimeout(500);

    const seen = await page.evaluate(() => {
      const live = (el) => {
        if (!el) return false;
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && +s.opacity > 0;
      };
      const step = document.getElementById('cstep-name');
      const fields = Array.from(step.querySelectorAll('.field'));
      const ruled = fields.filter((f) => {
        const w = getComputedStyle(f).borderTopWidth;
        return parseFloat(w) > 0;
      });
      const id = (x) => document.getElementById(x);
      const box = (x) => (id(x) ? id(x).getBoundingClientRect() : null);
      /* The order the person reads, taken from the rendered position of each
         section rather than from the markup: a `order` or a float would put the
         document and the screen in different orders and only one is read. */
      const order = ['create-name', 'create-label', 'create-reports', 'create-model-field', 'create-instr']
        .filter((x) => id(x))
        .sort((a, b) => box(a).top - box(b).top);
      const form = step.getBoundingClientRect();
      const btn = box('create-go');
      const tell = box('create-tell');
      const acct = box('create-account');
      const model = box('create-model');
      const prov = box('create-provider');
      const el = document.querySelector('.mstep');
      const elbow = el ? getComputedStyle(el, '::before') : null;
      /* #245: drive the provider menu both ways and read what it does to
         its neighbours, then leave it where it started. */
      const openaiParks = (() => {
        const sel = id('create-provider');
        const model = id('create-model');
        const acctSel = id('create-account');
        sel.value = 'openai';
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        const parked = {
          modelDisabled: model.disabled,
          acctDisabled: acctSel.disabled,
          why: (id('create-model-why') || {}).textContent || '',
        };
        sel.value = 'anthropic';
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        parked.reModelEnabled = !model.disabled;
        parked.reAcctEnabled = !acctSel.disabled;
        return parked;
      })();
      return {
        openaiParks,
        fieldCount: fields.length,
        ruledCount: ruled.length,
        order,
        projects: Boolean(id('create-projects')),
        disclosure: step.querySelectorAll('details.smore').length,
        nameW: box('create-name').width,
        reportsW: box('create-reports').width,
        modelW: model.width,
        instrW: box('create-instr').width,
        formW: form.width,
        reportsFirst: id('create-reports').options[0] ? id('create-reports').options[0].textContent : null,
        reportsValue: id('create-reports').value,
        reportsShown: live(id('create-reports')),
        providers: Array.from(id('create-provider').options).map((o) => [o.textContent, o.disabled]),
        acctShown: live(id('create-account')),
        acctCount: id('create-account').options.length,
        stepIn: { prov: prov.left, acct: acct.left, model: model.left },
        elbow: elbow ? { w: elbow.width, h: elbow.height, color: elbow.borderLeftColor } : null,
        /**
         * 🛑 DOES THE ELBOW CROSS A CONTROL? (#322, Josh with a screenshot:
         * "the little line is overlapping between the account and the model.")
         * Measured before the fix: the account select ran y 598-632 and the
         * model row's elbow ran y 620-650 at x 406-418, inside that select's
         * box. The rows were flush, so the elbow's upward reach had nowhere to
         * go but over the control above it.
         *
         * 🔑 ASKED AS AN INTERSECTION OF LAID-OUT BOXES, not as a spacing
         * number. A gap that looks right at one viewport is not the claim; the
         * claim is that no connector is drawn through a menu, and that is true
         * or false regardless of what the gap happens to be.
         */
        clashes: (() => {
          const g = document.querySelector('.msteps');
          if (!g) return null;
          const ctrls = [...g.querySelectorAll('select')].map((c) => c.getBoundingClientRect());
          const out = [];
          for (const st of g.querySelectorAll('.mstep')) {
            const r = st.getBoundingClientRect();
            const cs = getComputedStyle(st, '::before');
            const top = r.top + parseFloat(cs.top || '0');
            const bottom = top + parseFloat(cs.height || '0');
            const left = r.left + parseFloat(cs.left || '0');
            const right = left + parseFloat(cs.width || '0');
            for (const c of ctrls) {
              if (top < c.bottom && bottom > c.top && left < c.right && right > c.left) {
                out.push(Math.round(top) + '-' + Math.round(bottom) + ' over a menu at '
                  + Math.round(c.top) + '-' + Math.round(c.bottom));
              }
            }
          }
          return out;
        })(),
        /* And the arm lands on the middle of what it points at, which is what a
           connector is for. Reported rather than asserted to a pixel: the number
           is half a control's height and would move with the control. */
        armOffCentre: (() => {
          /**
           * 🛑 RENDERED MSTEPS ONLY (#531). This measured every .mstep on
           * the PAGE, and #390 gave the (hidden) detail panel the same
           * three-dropdown shape as this form -- from that commit, the two
           * hidden msteps measured as CSS constants over zero-height rects
           * (::before top+height = 17 against a centre of 0) and the check
           * went permanently red while the VISIBLE arms sat at a perfect
           * 0. Bisected: green at 0cfd745^, red at 0cfd745, layout correct
           * throughout; the assertion is re-expressed, not loosened -- a
           * hidden element's rectangle is a non-measurement, and skipping
           * it is what lets the ±2 bound keep meaning something.
           */
          const steps = [...document.querySelectorAll('.msteps .mstep')];
          return steps.map((st) => {
            const r = st.getBoundingClientRect();
            const cs = getComputedStyle(st, '::before');
            const bottom = r.top + parseFloat(cs.top || '0') + parseFloat(cs.height || '0');
            const c = st.querySelector('select');
            if (!c) return null;
            const cr = c.getBoundingClientRect();
            if (cr.height === 0 || r.height === 0) return null;
            return Math.round(bottom - (cr.top + cr.height / 2));
          }).filter((n) => n !== null);
        })(),
        sameRow: tell && btn ? Math.abs(tell.top - btn.top) < 60 && btn.left > tell.right : null,
        labelGap: (() => {
          const l = document.querySelector('label[for="create-name"]');
          return l ? box('create-name').top - l.getBoundingClientRect().bottom : null;
        })(),
      };
    });

    check(`[${engine}] the form has fields at all`, seen.fieldCount >= 4, `${seen.fieldCount} fields`);
    check(`[${engine}] not one of them draws a rule above it`, seen.ruledCount === 0,
      `${seen.ruledCount} of ${seen.fieldCount} still ruled`);
    check(`[${engine}] Josh's section order, measured down the screen`,
      seen.order.join(' > ') === 'create-name > create-label > create-reports > create-model-field > create-instr',
      seen.order.join(' > '));
    check(`[${engine}] the projects picker is gone`, !seen.projects);
    check(`[${engine}] and so is the closed model disclosure`, seen.disclosure === 0,
      `${seen.disclosure} left`);

    /* Half width, expressed as the thing that was wrong: they filled the form. */
    check(`[${engine}] name, reports and model are about half the form`,
      seen.nameW < seen.formW * 0.62 && seen.reportsW < seen.formW * 0.62 && seen.modelW < seen.formW * 0.62,
      `form ${Math.round(seen.formW)}, name ${Math.round(seen.nameW)}, reports ${Math.round(seen.reportsW)}, model ${Math.round(seen.modelW)}`);
    check(`[${engine}] and the instructions box is NOT, because it holds prose`,
      seen.instrW > seen.formW * 0.85, `${Math.round(seen.instrW)} of ${Math.round(seen.formW)}`);
    check(`[${engine}] the label is not sitting on its input`, seen.labelGap >= 6,
      `${Math.round(seen.labelGap)}px`);

    check(`[${engine}] Reports to is always there and defaults to you`,
      seen.reportsShown && seen.reportsValue === '' && /you/i.test(seen.reportsFirst || ''),
      `first option ${JSON.stringify(seen.reportsFirst)}, value ${JSON.stringify(seen.reportsValue)}`);

    const enabled = seen.providers.filter(([, d]) => !d);
    /* #245: OpenAI joined Anthropic as choosable; everything else still says
       coming soon. This assertion moved WITH the product in the same change,
       per the menu's own instruction that whoever wires a second provider
       enables its option in the same commit. */
    check(`[${engine}] two providers can be chosen and the rest are refused up front`,
      enabled.length === 2
        && enabled.some(([t]) => /anthropic/i.test(t))
        && enabled.some(([t]) => /openai/i.test(t))
        && seen.providers.length === 8,
      `${enabled.length} of ${seen.providers.length} selectable: ${enabled.map((x) => x[0]).join(', ')}`);
    /* #245: choosing OpenAI disables the two Claude-shaped controls WITH
       WORDS, and choosing Anthropic back re-enables them. Driven, not read
       from source: the disabling is a live listener. */
    check(`[${engine}] choosing OpenAI parks the model and account menus, with words, and Anthropic unparks them`,
      seen.openaiParks && seen.openaiParks.modelDisabled && seen.openaiParks.acctDisabled
        && /model/i.test(seen.openaiParks.why || '')
        && seen.openaiParks.reModelEnabled && seen.openaiParks.reAcctEnabled,
      JSON.stringify(seen.openaiParks));
    check(`[${engine}] the account rung is drawn even with one account in it`,
      seen.acctShown && seen.acctCount >= 1, `${seen.acctCount} options`);
    check(`[${engine}] each menu steps in from the one above`,
      seen.stepIn.acct > seen.stepIn.prov + 10 && seen.stepIn.model > seen.stepIn.acct + 10,
      `${Math.round(seen.stepIn.prov)} / ${Math.round(seen.stepIn.acct)} / ${Math.round(seen.stepIn.model)}`);
    /* 🛑 THE ELBOW IS THE PART THAT CANNOT BE READ FROM SOURCE. It is one box
       with two borders, and a zero on either dimension leaves a line that goes
       down but never across, or across but never down. */
    check(`[${engine}] no elbow is drawn through a menu (#322)`,
      Array.isArray(seen.clashes) && seen.clashes.length === 0,
      JSON.stringify(seen.clashes));
    /* Two RENDERED arms exactly, or the guard against hidden pollution has
       itself gone vacuous: this form draws two msteps, and a count of zero
       would mean the visible-only filter silently ate everything. */
    check(`[${engine}] each elbow's arm lands on the middle of its menu`,
      Array.isArray(seen.armOffCentre) && seen.armOffCentre.length === 2
        && seen.armOffCentre.every((n) => Math.abs(n) <= 2),
      JSON.stringify(seen.armOffCentre));
    check(`[${engine}] and an elbow is drawn into the gutter`,
      seen.elbow && parseFloat(seen.elbow.w) > 4 && parseFloat(seen.elbow.h) > 8,
      seen.elbow ? `${seen.elbow.w} x ${seen.elbow.h} in ${seen.elbow.color}` : 'no ::before');

    check(`[${engine}] the checkbox and the button share a line`, seen.sameRow === true);

    check(`[${engine}] no page errors`, errors.length === 0, errors.join(' | ').slice(0, 160));
    await browser.close();
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) { failed.forEach((f) => console.log('  - ' + f.name + '  ' + (f.detail || ''))); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
