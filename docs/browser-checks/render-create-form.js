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
      /* #996/item 3: the created-ping checkbox was removed from this step on
         2026-08-26. Kept as a lookup so the absence is MEASURED on the rendered
         page rather than assumed from the markup. */
      const tellGone = !id('create-tell');
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
        /* #2097: the account ROW hides at fewer than two usable accounts (Josh's
           hide-at-one ruling). Read straight off the element the code toggles. */
        acctRowHidden: id('create-account-row') ? id('create-account-row').hidden : null,
        /* This cut: when the row is hidden, the account `.mstep` that wraps it must
           NOT still draw its elbow (an orphan stub pointing at the absent account).
           `content: none` on the ::before is how the CSS drops it; read it back. */
        acctElbowPainted: (() => {
          const arow = id('create-account-row');
          const st = arow ? arow.closest('.mstep') : null;
          if (!st) return null;
          return getComputedStyle(st, '::before').content !== 'none';
        })(),
        /* #1917: the rendered option TEXT of each account, read out of the live
           <select>. A source test executes fillCreateAccounts' string-building; only
           a browser sees what actually lands in the control. */
        acctOptionTexts: Array.from(id('create-account').options).map((o) => o.textContent),
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
        tellGone,
        btnPresent: !!btn,
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
    /* #245: choosing OpenAI disables the model control WITH WORDS, and
       choosing Anthropic back re-enables it. Driven, not read from source:
       the disabling is a live listener. #540 moved the ACCOUNT menu out of
       this: it no longer parks for OpenAI, it fills with OpenAI accounts (or
       names this computer's sign-in when there are none), so the assertion
       moved with the product in the same change. */
    check(`[${engine}] choosing OpenAI parks the model menu with words and leaves the account menu live; Anthropic unparks the model`,
      seen.openaiParks && seen.openaiParks.modelDisabled && !seen.openaiParks.acctDisabled
        && /model/i.test(seen.openaiParks.why || '')
        && seen.openaiParks.reModelEnabled && seen.openaiParks.reAcctEnabled,
      JSON.stringify(seen.openaiParks));
    /* #2097 (Josh's hide-at-one ruling, reversing the old show-at-one this check
       was written for): the account rung is HIDDEN at fewer than two usable
       accounts and SHOWN at two or more. Each usable account is one option and the
       zero-usable case draws a single placeholder, so `options >= 2` is exactly
       "two or more usable" -- the same threshold fillCreateAccounts hides on. This
       is the invariant on ANY machine: the check used to pass on a multi-account
       box and fail on a one-account box (the build box), which is the staleness. */
    check(`[${engine}] the account rung follows #2097: hidden at one account, shown at two or more`,
      seen.acctShown === (seen.acctCount >= 2),
      `${seen.acctCount} option(s), row ${seen.acctShown ? 'shown' : 'hidden'}`);
    /* And when the rung is hidden, its elbow goes with it: #2097 hid the row but
       left the wrapping `.mstep` drawing an orphan connector at the absent account
       (this cut). The CSS `:has(> #create-account-row[hidden])` drops it; assert the
       stub is gone whenever the row is hidden, so the regression cannot come back. */
    check(`[${engine}] a hidden account rung draws no orphan elbow`,
      seen.acctRowHidden ? seen.acctElbowPainted === false : true,
      `row ${seen.acctRowHidden ? 'hidden' : 'shown'}, elbow painted ${seen.acctElbowPainted}`);
    /* #1917: two accounts on ONE email used to render as two IDENTICAL options, so a
       real tester could not tell which to pick and ran his agent on the dead one. The
       rendered option TEXT must be distinct per account -- a claim a source test cannot
       make, because it executes the string-building but never sees what lands in the
       live <select>. Bites on any machine that actually holds a duplicated-email
       account (this build box holds agent@example.com twice); on a machine with none it
       is trivially unique, which is the correct pass and still catches a regression
       that collapsed two rows to one text. */
    check(`[${engine}] every account option is distinctly labelled (#1917)`,
      new Set(seen.acctOptionTexts).size === seen.acctOptionTexts.length,
      JSON.stringify(seen.acctOptionTexts));
    /* Each VISIBLE menu steps in from the one above it. With the account rung
       hidden (#2097, one account) the cascade is just provider -> model and the
       model steps in a single level; a hidden account select reports left 0, which
       is not a rung and must not be measured as one. With the rung shown it is the
       full provider -> account -> model. The visible rungs are what a person reads. */
    check(`[${engine}] each visible menu steps in from the one above`,
      seen.acctShown
        ? (seen.stepIn.acct > seen.stepIn.prov + 10 && seen.stepIn.model > seen.stepIn.acct + 10)
        : (seen.stepIn.model > seen.stepIn.prov + 10),
      `${seen.acctShown ? 'shown' : 'hidden'}: prov ${Math.round(seen.stepIn.prov)} / acct ${Math.round(seen.stepIn.acct)} / model ${Math.round(seen.stepIn.model)}`);
    /* 🛑 THE ELBOW IS THE PART THAT CANNOT BE READ FROM SOURCE. It is one box
       with two borders, and a zero on either dimension leaves a line that goes
       down but never across, or across but never down. */
    check(`[${engine}] no elbow is drawn through a menu (#322)`,
      Array.isArray(seen.clashes) && seen.clashes.length === 0,
      JSON.stringify(seen.clashes));
    /* One RENDERED arm per VISIBLE rung with a menu, and it lands on that menu's
       middle. With the account rung shown that is two (account + model); with it
       hidden (#2097, one account) it is one (model) -- the account mstep's select
       is height 0 and its elbow is dropped by the CSS above, so it is neither
       measured nor drawn. An expected count that tracks the visible rungs keeps the
       "not zero" guard meaningful (a silent visible-only filter eating everything
       would read as zero, not as the expected one or two). */
    const expectedArms = seen.acctShown ? 2 : 1;
    check(`[${engine}] each elbow's arm lands on the middle of its menu`,
      Array.isArray(seen.armOffCentre) && seen.armOffCentre.length === expectedArms
        && seen.armOffCentre.every((n) => Math.abs(n) <= 2),
      `expected ${expectedArms} arm(s): ${JSON.stringify(seen.armOffCentre)}`);
    check(`[${engine}] and an elbow is drawn into the gutter`,
      seen.elbow && parseFloat(seen.elbow.w) > 4 && parseFloat(seen.elbow.h) > 8,
      seen.elbow ? `${seen.elbow.w} x ${seen.elbow.h} in ${seen.elbow.color}` : 'no ::before');

    /* 🛑 THIS ASSERTED THE CHECKBOX AND NOW ASSERTS ITS ABSENCE. Josh removed
       the created-ping setting on 2026-08-26 ("they both need to be removed"),
       and this check went red on the RENDERED page while the product was doing
       exactly what he asked. It was one of four page-layer reds holding a cut.
       📌 The button half is kept as the control: without it, "the checkbox is
       gone" would also pass on a step that had lost its Create button. */
    check(`[${engine}] the created-ping checkbox is gone from this step`, seen.tellGone === true);
    check(`[${engine}] and the Create button is still on it`, seen.btnPresent === true);

    check(`[${engine}] no page errors`, errors.length === 0, errors.join(' | ').slice(0, 160));
    await browser.close();
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) { failed.forEach((f) => console.log('  FAIL  ' + f.name + '  ' + (f.detail || ''))); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
