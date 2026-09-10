'use strict';
// Browser-check-surface: create-name-err create-label-err pj-name-err ferr
// (#2518) the distinctive web/index.html tokens this check asserts: the three field-level
// error slots and the .ferr class a change to them must update this check at PR time.
/* #2606: Create an Agent and Create a Project show validation errors INLINE and
 * field-level (red border + message beside the field + focus), not as small text
 * far below the submit button (Josh's review; same structural defect as #1303 G,
 * one form along). Drives the SHIPPED pjFieldBad/pjFieldOk helper and the real
 * #pj-create empty-name gate against the real page (file://, no board needed:
 * the paths asserted are all client-side).
 *
 * Controls that can return the dangerous answer: the red border is read from
 * getComputedStyle (not the class alone), so the broadened `.frow input.bad`
 * selector -- the plain create/project inputs are NOT .tk-inp -- is actually
 * proven to paint, in both themes; and pjFieldOk is shown to CLEAR the flag, so a
 * stuck red border would fail. Both themes.
 *
 * Run: NODE_PATH=$HOME/work/pw-runtime/node_modules node docs/browser-checks/render-inline-field-errors-2606.js
 *      (HEADED=0 on a machine with no console session)
 */
const path = require('node:path');
const { chromium } = require('playwright');
const PAGE = 'file://' + path.join(path.resolve(__dirname, '..', '..'), 'web', 'index.html');

const problems = [];
let pass = 0;
function ok(name, cond, detail) { if (cond) pass += 1; else problems.push(name + (detail ? ' -- ' + detail : '')); }
// A red border is `--danger`, which is not gray/black/transparent. We do not hardcode the
// exact rgb (it differs per theme and could be retuned); we assert it is a real color AND
// distinct from the field's own un-flagged border, so "it painted red" is proven by change,
// not by a value that a theme edit could silently drift.
function isColored(c) { return /^rgb/.test(c || '') && !/rgba\(0,\s*0,\s*0,\s*0\)/.test(c); }

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED === '0', ignoreDefaultArgs: ['--hide-scrollbars'] });
  for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, colorScheme: theme });
    page.on('pageerror', (e) => problems.push(`[${theme}] pageerror: ${e.message}`));
    // file:// fires startup polls that cannot load; stop the 5s poll and ignore the
    // harness's own file:// fetch errors, so a genuine console error still surfaces.
    await page.addInitScript(() => { window.setInterval = () => 0; });
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      const x = m.text();
      if (/ERR_FILE_NOT_FOUND|URL scheme "file"|Failed to (fetch|load)/.test(x)) return;
      problems.push(`[${theme}] console: ${x}`);
    });
    await page.goto(PAGE);
    const t = `[${theme}]`;

    // ---- Create an Agent: the field-level error mechanism renders ----
    // The NAME error's real trigger is a server refusal (result.field === 'name'), so on
    // file:// we drive the SHIPPED helper the handler calls, and read the field back. This
    // proves the slot exists, the message lands beside the field, the input is flagged +
    // focused, and the broadened .frow input.bad selector actually paints a red border.
    const agent = await page.evaluate(() => {
      const fr = document.getElementById('firstrun'); if (fr) fr.hidden = true;
      const pc = document.getElementById('panel-create'); if (pc) pc.hidden = false;
      if (typeof cstep === 'function') cstep('name'); // show #cstep-name so fields are visible + focusable
      const read = (inputId, errId) => {
        const inp = document.getElementById(inputId);
        const err = document.getElementById(errId);
        return {
          exists: !!inp && !!err,
          plainBorder: inp ? getComputedStyle(inp).borderColor : '',
          bad: inp ? inp.classList.contains('bad') : false,
          invalid: inp ? inp.getAttribute('aria-invalid') === 'true' : false,
          focused: inp ? document.activeElement === inp : false,
          badBorder: inp ? getComputedStyle(inp).borderColor : '',
          msg: err ? err.textContent : '',
        };
      };
      // plain border BEFORE flagging (baseline for the "changed to red" comparison)
      const nameInp = document.getElementById('create-name');
      const namePlain = nameInp ? getComputedStyle(nameInp).borderColor : '';
      const labelInp = document.getElementById('create-label');
      const labelPlain = labelInp ? getComputedStyle(labelInp).borderColor : '';
      pjFieldBad('create-name', 'create-name-err', 'that name is taken');
      const name = read('create-name', 'create-name-err');
      pjFieldBad('create-label', 'create-label-err', 'Say what this agent does. One or two words.');
      const label = read('create-label', 'create-label-err');
      // pjFieldOk must CLEAR the name flag (a stuck border would fail here)
      pjFieldOk('create-name', 'create-name-err');
      const nameAfterOk = read('create-name', 'create-name-err');
      // clear-on-input: re-flag the label, then type into it; the input listener clears it
      pjFieldBad('create-label', 'create-label-err', 'again');
      labelInp.value = 'Bookkeeper';
      labelInp.dispatchEvent(new Event('input', { bubbles: true }));
      const labelAfterType = read('create-label', 'create-label-err');
      return { name, label, nameAfterOk, labelAfterType, namePlain, labelPlain };
    });
    ok(`${t} create-name error slot exists`, agent.name.exists);
    ok(`${t} create-name flagged (.bad + aria-invalid + focus)`, agent.name.bad && agent.name.invalid && agent.name.focused, JSON.stringify(agent.name));
    ok(`${t} create-name shows the reason beside the field`, /that name is taken/.test(agent.name.msg), agent.name.msg);
    ok(`${t} create-name paints a red border (broadened .frow input.bad)`, isColored(agent.name.badBorder) && agent.name.badBorder !== agent.namePlain, `plain=${agent.namePlain} bad=${agent.name.badBorder}`);
    ok(`${t} create-label flagged + reason beside it`, agent.label.bad && /say what this agent does/i.test(agent.label.msg), JSON.stringify(agent.label));
    ok(`${t} create-label red border`, isColored(agent.label.badBorder) && agent.label.badBorder !== agent.labelPlain, `plain=${agent.labelPlain} bad=${agent.label.badBorder}`);
    ok(`${t} pjFieldOk clears the name flag (no stuck red)`, !agent.nameAfterOk.bad && !agent.nameAfterOk.invalid && agent.nameAfterOk.msg === '' && agent.nameAfterOk.badBorder === agent.namePlain, JSON.stringify(agent.nameAfterOk));
    ok(`${t} typing clears the label flag`, !agent.labelAfterType.bad && agent.labelAfterType.msg === '', JSON.stringify(agent.labelAfterType));

    // ---- Create a Project: the REAL empty-name gate, driven by clicking Create project ----
    // This is the full handler path (not just the helper): the empty-name pre-check is the
    // first gate in #pj-create after the resets, before any round trip, so it is deterministic
    // on file://.
    const project = await page.evaluate(() => {
      const fr = document.getElementById('firstrun'); if (fr) fr.hidden = true;
      const pp = document.getElementById('panel-projects'); if (pp) pp.hidden = false;
      if (typeof openAddProject === 'function') openAddProject(); // reset + wire the add form
      const view = document.getElementById('pj-add-view'); if (view) view.hidden = false;
      const nameInp = document.getElementById('pj-name');
      const plain = nameInp ? getComputedStyle(nameInp).borderColor : '';
      nameInp.value = '   '; // whitespace only: the .trim() gate must still refuse it
      document.getElementById('pj-create').click(); // the real submit handler runs synchronously to the gate
      const err = document.getElementById('pj-name-err');
      return {
        exists: !!nameInp && !!err,
        bad: nameInp ? nameInp.classList.contains('bad') : false,
        invalid: nameInp ? nameInp.getAttribute('aria-invalid') === 'true' : false,
        focused: nameInp ? document.activeElement === nameInp : false,
        msg: err ? err.textContent : '',
        plain,
        badBorder: nameInp ? getComputedStyle(nameInp).borderColor : '',
      };
    });
    ok(`${t} pj-name error slot exists`, project.exists);
    ok(`${t} empty-name submit flags pj-name (.bad + aria-invalid + focus)`, project.bad && project.invalid && project.focused, JSON.stringify(project));
    ok(`${t} pj-name shows the reason beside the field`, /give this project a name/i.test(project.msg), project.msg);
    ok(`${t} pj-name paints a red border (broadened .frow input.bad)`, isColored(project.badBorder) && project.badBorder !== project.plain, `plain=${project.plain} bad=${project.badBorder}`);

    await page.close();
  }
  await browser.close();
  console.log(`${pass} passed, ${problems.length} failed`);
  problems.forEach((p) => console.log('  FAIL ' + p));
  process.exit(problems.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
