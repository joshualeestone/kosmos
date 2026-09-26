'use strict';
/**
 * kosmos#1040 2b: the provider logo combobox (enhanceProviderSelect), over ALL THREE
 * provider selects (#d-provider, the switch dialog; #acct-provider-pick, the Add-a-provider
 * screen; #create-provider, the Create Agent form). Drives the SHIPPED widget in the real
 * page and asserts the WAI-ARIA combobox
 * contract: the native <select> stays the source of truth (hidden, still in the DOM with its
 * options), the trigger shows the selected mark+label, open/close + keyboard nav +
 * Enter-select sync the hidden select's .value and fire `change`, Esc closes and refocuses,
 * a coming-soon option is aria-disabled and NOT selectable, Grok gets its real mark (#3708; it was an initial-letter chip)
 * (no wrong-brand mark), and a programmatic value change re-renders the trigger. Both themes,
 * plus a screenshot. It also checks the #acct-provider-pick reauth-hide contract: the
 * "Sign in again" screen hides the whole chooser container, widget included. And a REAL mouse
 * pick of Gemini or Grok in the Add-a-provider dialog keeps the dialog open (the 0.6.95 flash:
 * the option was chosen on mousedown, and the mouseup's click closed the dialog); at least one
 * picked option must sit past the dialog's edge, the geometry that bug needed (which one is
 * printed on the NOTE geometry line). This is the CI browser-checks (Playwright) verification
 * of the a11y CONTRACT; a real screen-reader pass is the human follow-up no Playwright can do.
 *
 * The two selects use DIFFERENT option-value vocabularies for the SAME provider (#d-provider
 * uses 'anthropic', #acct-provider-pick uses 'claude'), so claudeVal parametrizes the
 * flip-to-Claude assertions; the display labels (Claude / OpenAI) are the same for both.
 *
 * Run: NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-provider-combobox-1040.js
 *      (HEADED=0 on a console-less machine.)
 */
const nodePath = require('node:path');
let chromium;
try { ({ chromium } = require('playwright')); }
catch { console.log('render-provider-combobox-1040: playwright not on NODE_PATH - SKIPPED, not passed.'); process.exit(0); }

const PAGE = 'file://' + nodePath.join(__dirname, '..', '..', 'web', 'index.html');
const problems = [];
function ok(name, cond, detail) { if (!cond) problems.push(name + (detail ? '  ' + detail : '')); }

// The same contract over both remaining provider selects. claudeVal is the option value
// that names Claude in that select (#d-provider: 'anthropic'; #acct-provider-pick: 'claude').
const SELECTS = [
  { id: 'd-provider', claudeVal: 'anthropic' },
  { id: 'acct-provider-pick', claudeVal: 'claude' },
  { id: 'create-provider', claudeVal: 'anthropic' },   // #1040 2b final select: the Create Agent form (same 'anthropic' vocab as #d-provider).
];

(async () => {
  let browser;
  try { browser = await chromium.launch({ headless: process.env.HEADED === '0' }); }
  catch (err) {
    console.error('FAIL  render-provider-combobox-1040: could not start a browser'
      + (process.env.HEADED === '0' ? '.' : ' (headed; try HEADED=0).'));
    console.error('  ' + (err && err.message ? err.message.split('\n')[0] : err));
    process.exit(1);
  }
  const shots = [];
  for (const theme of ['light', 'dark']) {
  for (const { id: selId, claudeVal } of SELECTS) {
    const page = await browser.newPage({ viewport: { width: 900, height: 700 }, colorScheme: theme });
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    await page.goto(PAGE);
    const t = '[' + theme + '][' + selId + '] ';

    const r = await page.evaluate(({ selId, claudeVal }) => {
      const select = document.getElementById(selId);
      const wrap = select && select.parentNode.querySelector('.pcombo');
      if (!select || !wrap) return { fatal: 'no #' + selId + ' or no .pcombo widget (enhanceProviderSelect did not run)' };
      // The select may live inside a hidden dialog/screen; un-hide its ancestor path so the
      // trigger is focusable (focus() no-ops in a display:none subtree). This mirrors the
      // dialog/screen being OPEN, the only state a user reaches Esc-refocus in. Generic ancestor
      // walk, so it works for #d-provider (switch dialog) and #acct-provider-pick (Add screen).
      for (let p = select; p && p !== document.body; p = p.parentNode) {
        if (p.hasAttribute && p.hasAttribute('hidden')) p.hidden = false;
        if (p.style && p.style.display === 'none') p.style.display = '';
      }
      const trigger = wrap.querySelector('.pcombo-trigger');
      const list = wrap.querySelector('.pcombo-list');
      const dispatchKey = (key) => trigger.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      const activeLi = () => (trigger.getAttribute('aria-activedescendant') ? document.getElementById(trigger.getAttribute('aria-activedescendant')) : null);

      // Source of truth preserved: the native select is hidden but still in the DOM with options.
      const selectStillHasOptions = select.options.length >= 2 && !!select.querySelector('option[value="' + claudeVal + '"]');
      const selectHidden = getComputedStyle(select).position === 'absolute' && select.clientWidth <= 2;
      // The native select must be out of the tab order AND the a11y tree, not merely clipped:
      // otherwise it is a phantom tab stop with no focus ring and a duplicate "Provider" combobox.
      const selectOutOfATandTab = select.getAttribute('aria-hidden') === 'true' && select.tabIndex === -1;

      // Closed state: role, collapsed, shows the selected label + a mark.
      const roleCombobox = trigger.getAttribute('role') === 'combobox';
      // The trigger is named by a hidden field label AND its own text (the value), via
      // aria-labelledby "<label> <trigger>", not an aria-label that would REPLACE the value.
      const lbIds = (trigger.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
      const lblEl = lbIds.map((id) => document.getElementById(id)).find((el) => el && /Provider/i.test(el.textContent || ''));
      const accNameHasLabelAndValue = !trigger.hasAttribute('aria-label') && lbIds.includes(trigger.id) && !!lblEl;
      const collapsed = trigger.getAttribute('aria-expanded') === 'false' && list.hidden === true;
      // The trigger shows the CURRENT selection and the select's own `change` listener re-renders
      // it. Flip to OpenAI and back to Claude so this cannot pass with a broken listener:
      // asserting only the default would be vacuous. Leave the value on Claude for the
      // open/ArrowDown/Enter flow below.
      select.value = 'openai'; select.dispatchEvent(new Event('change', { bubbles: true }));
      const triggerLabelOpenai = (trigger.querySelector('.pcombo-name') || {}).textContent || '';
      select.value = claudeVal; select.dispatchEvent(new Event('change', { bubbles: true }));
      const triggerLabelClosed = (trigger.querySelector('.pcombo-name') || {}).textContent || '';
      const triggerHasMark = !!trigger.querySelector('.pcombo-mark');

      // Open via click; an option becomes active with aria-activedescendant.
      trigger.click();
      const openedAfterClick = trigger.getAttribute('aria-expanded') === 'true' && list.hidden === false;
      const activeOnOpen = !!activeLi();

      // ArrowDown moves the active option (skipping disabled) and updates aria-activedescendant.
      const beforeArrow = trigger.getAttribute('aria-activedescendant');
      dispatchKey('ArrowDown');
      const afterArrow = trigger.getAttribute('aria-activedescendant');
      const arrowMoved = beforeArrow !== afterArrow && !!activeLi() && activeLi().getAttribute('aria-disabled') !== 'true';

      // Enter selects the active option: hidden select .value updates + `change` fires, list closes.
      let changeFired = false;
      const onChange = () => { changeFired = true; };
      select.addEventListener('change', onChange);
      const activeValBeforeEnter = activeLi() ? activeLi().dataset.value : null;
      dispatchKey('Enter');
      const selectSynced = select.value === activeValBeforeEnter;
      const closedAfterEnter = list.hidden === true && trigger.getAttribute('aria-expanded') === 'false';
      select.removeEventListener('change', onChange);

      // A coming-soon option is aria-disabled and NOT selectable.
      const disabledLi = Array.from(list.children).find((li) => li.getAttribute('aria-disabled') === 'true');
      const disabledIsDisabled = !!disabledLi;
      let disabledNotSelectable = true;
      if (disabledLi) {
        const before = select.value;
        // A whole press (the choice is made on click since the Add-dialog fix below).
        disabledLi.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        disabledLi.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        disabledNotSelectable = select.value === before; // committing a disabled option is a no-op
      }

      // #3708: the Grok/xai option wears the real Grok mark cloned from first run, not the letter chip.
      const grokLi = Array.from(list.children).find((li) => li.dataset.value === 'xai');
      const grokChip = !!(grokLi && !grokLi.querySelector('.pcombo-chip') && grokLi.querySelector('[data-pmark="xai"] svg path'));

      // Esc closes and refocuses the trigger.
      trigger.click(); // open again
      const reopened = list.hidden === false;
      dispatchKey('Escape');
      const escClosed = list.hidden === true;
      const escRefocus = document.activeElement === trigger;

      // The trigger mirrors select.disabled, AND disabling while the popup is OPEN closes it
      // (no stale aria-expanded=true on a disabled trigger). Testing "a disabled button does not
      // open" via .click() would be vacuous: .click() on a disabled <button> is a spec no-op, so
      // it can never fail. Test the observable close-on-disable instead, with a positive control.
      select.disabled = false;
      const disabledSyncsOff = trigger.disabled === false;
      trigger.click();          // open while ENABLED (positive control: the open path runs)
      const openedForDisableTest = list.hidden === false;
      select.disabled = true;   // NO dispatch; the disabled-setter wrap must sync + close
      const disabledSyncsOn = trigger.disabled === true;
      const closedOnDisable = list.hidden === true && trigger.getAttribute('aria-expanded') === 'false';
      select.disabled = false;  // restore

      // Programmatic value change WITHOUT dispatching change (resetCreateProvider sets .value
      // then calls applyCreateProviderUI directly, no change event) must still re-render the
      // trigger, via the value-setter wrap. This is the case a change-listener-only re-sync misses.
      // The trigger currently shows OpenAI (the Enter-commit above selected it), so assign a
      // DIFFERENT value: without the value-setter wrap the label would stay on OpenAI and the
      // assertion below (flips to Claude, no longer OpenAI) fails. Setting the same value would
      // be vacuous.
      const progFrom = (trigger.querySelector('.pcombo-name') || {}).textContent || '';
      select.value = claudeVal;   // NO dispatch on purpose; a value the trigger is NOT showing
      const progLabel = (trigger.querySelector('.pcombo-name') || {}).textContent || '';

      // A programmatic value change WHILE THE POPUP IS OPEN must also update the trigger and the
      // option aria-selected (a paintProviderPicker repaint can set select.value under an open
      // popup). Open (value is Claude), change to openai with NO dispatch, assert both flip.
      trigger.click();
      const openedForStale = list.hidden === false;
      select.value = 'openai';   // NO dispatch, popup OPEN
      const openLabel = (trigger.querySelector('.pcombo-name') || {}).textContent || '';
      const openaiLi = Array.from(list.children).find((li) => li.dataset.value === 'openai');
      const openAriaSelected = !!(openaiLi && openaiLi.getAttribute('aria-selected') === 'true');

      // No option name may be ellipsis-clipped in the OPEN list: the popup must autosize to the
      // widest "<Provider> Coming soon" row like a native select, not stay pinned to the trigger
      // width (which is sized to the short selected value and truncated every coming-soon row).
      // A rendered-geometry check (scrollWidth > clientWidth), not textContent, so it can see it.
      const truncatedNames = Array.from(list.querySelectorAll('.pcombo-opt .pcombo-name'))
        .filter((n) => n.scrollWidth > n.clientWidth + 1)
        .map((n) => n.textContent);
      const noTruncatedNames = truncatedNames.length === 0;
      // Leave the list OPEN so the screenshot below captures the expanded state (marks, chip, pills).

      return {
        selectStillHasOptions, selectHidden, selectOutOfATandTab, roleCombobox, collapsed, triggerLabelClosed, triggerHasMark,
        openedAfterClick, activeOnOpen, arrowMoved, selectSynced, changeFired, closedAfterEnter,
        disabledIsDisabled, disabledNotSelectable, grokChip, reopened, escClosed, escRefocus,
        accNameHasLabelAndValue, triggerLabelOpenai, disabledSyncsOn, disabledSyncsOff,
        openedForDisableTest, closedOnDisable, progFrom, progLabel,
        openedForStale, openLabel, openAriaSelected, noTruncatedNames, truncatedNames,
      };
    }, { selId, claudeVal });

    if (r.fatal) { problems.push(t + r.fatal); await page.close(); continue; }
    ok(t + 'the native select stays in the DOM with its options (source of truth)', r.selectStillHasOptions, JSON.stringify(r.selectStillHasOptions));
    ok(t + 'the native select is visually hidden', r.selectHidden, JSON.stringify(r.selectHidden));
    ok(t + 'the native select is out of the tab order and a11y tree (no phantom tab stop / duplicate combobox)', r.selectOutOfATandTab);
    ok(t + 'the trigger is role=combobox', r.roleCombobox);
    ok(t + 'the trigger accessible name carries the field label AND its own value text (aria-labelledby, not aria-label)', r.accNameHasLabelAndValue);
    ok(t + 'the trigger mirrors select.disabled (disabled = trigger disabled)', r.disabledSyncsOn && r.disabledSyncsOff, JSON.stringify({ on: r.disabledSyncsOn, off: r.disabledSyncsOff }));
    ok(t + 'disabling the provider control while open closes the popup (no stale aria-expanded)', r.openedForDisableTest && r.closedOnDisable, JSON.stringify({ opened: r.openedForDisableTest, closed: r.closedOnDisable }));
    ok(t + 'closed: aria-expanded=false and the list is hidden', r.collapsed);
    ok(t + 'the select change listener re-renders the trigger to the current selection (flips to OpenAI and back to Claude)',
      /GPT|OpenAI/i.test(r.triggerLabelOpenai) && /Claude/.test(r.triggerLabelClosed),
      JSON.stringify({ openai: r.triggerLabelOpenai, closed: r.triggerLabelClosed }));
    ok(t + 'closed: the trigger shows a mark', r.triggerHasMark);
    ok(t + 'click opens the listbox', r.openedAfterClick);
    ok(t + 'opening sets an active option (aria-activedescendant)', r.activeOnOpen);
    ok(t + 'ArrowDown moves the active option and updates aria-activedescendant', r.arrowMoved);
    ok(t + 'Enter syncs the hidden select value to the active option', r.selectSynced, JSON.stringify(r.selectSynced));
    ok(t + 'Enter fires the native select change (all existing handlers keep working)', r.changeFired);
    ok(t + 'Enter closes the listbox', r.closedAfterEnter);
    ok(t + 'a coming-soon option is aria-disabled', r.disabledIsDisabled);
    ok(t + 'a coming-soon option is NOT selectable', r.disabledNotSelectable);
    ok(t + 'Grok/xai renders its real Grok mark, not the letter chip (#3708)', r.grokChip);
    ok(t + 'Esc closes the listbox', r.reopened && r.escClosed);
    ok(t + 'Esc returns focus to the trigger', r.escRefocus);
    ok(t + 'a no-dispatch programmatic value change re-renders the trigger (value-setter wrap)',
      /GPT|OpenAI/i.test(r.progFrom) && /Claude/i.test(r.progLabel) && !/GPT|OpenAI/i.test(r.progLabel),
      JSON.stringify({ from: r.progFrom, to: r.progLabel }));
    ok(t + 'a value change WHILE THE POPUP IS OPEN updates the trigger and option aria-selected',
      r.openedForStale && /GPT|OpenAI/i.test(r.openLabel) && r.openAriaSelected,
      JSON.stringify({ opened: r.openedForStale, label: r.openLabel, ariaSelected: r.openAriaSelected }));
    ok(t + 'no option name is truncated in the open list (the popup autosizes to the widest row)',
      r.noTruncatedNames, JSON.stringify(r.truncatedNames));

    if (pageErrors.length) problems.push(t + 'pageerror: ' + pageErrors.join(' | '));
    const shot = nodePath.join(require('node:os').tmpdir(), 'provider-combobox-' + theme + '-' + selId + '.png');
    try { await page.screenshot({ path: shot }); shots.push(shot); } catch { /* screenshot best-effort */ }
    await page.close();
  }
  }

  // #1040 2b reauth-hide contract (#acct-provider-pick only): the "Sign in again" screen
  // decides the provider for you, so acctReauthChrome hides the chooser. It now hides the whole
  // #acct-provider-field container; hiding only the <label> and native <select> (the prior code)
  // left the enhanceProviderSelect .pcombo widget - a SIBLING of the select, inside the field -
  // on screen and operable, so a Claude reauth could be steered to OpenAI. Drive the REAL
  // acctReauthChrome against the REAL enhanced DOM with the dialog open, so this is rendered
  // geometry. The unit test cannot see this: its stub never runs enhanceProviderSelect, so no
  // widget exists there to leak.
  {
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    await page.goto(PAGE);
    const r = await page.evaluate(() => {
      const modal = document.getElementById('acct-add-modal');
      const field = document.getElementById('acct-provider-field');
      const select = document.getElementById('acct-provider-pick');
      const wrap = select && select.parentNode.querySelector('.pcombo');
      if (!modal || !field || !select || !wrap) return { fatal: 'no #acct-add-modal / #acct-provider-field / #acct-provider-pick / .pcombo widget' };
      if (typeof acctReauthChrome !== 'function') return { fatal: 'acctReauthChrome is not a global function' };
      const trigger = wrap.querySelector('.pcombo-trigger');
      // The widget lives INSIDE the field container, so the container's hidden state governs it.
      const widgetInField = field.contains(wrap);
      modal.hidden = false; // open the dialog so offsetParent reflects real rendering
      acctReauthChrome(true, 'her@example.com');
      const hiddenOnReauth = field.hidden === true && trigger.offsetParent === null;
      acctReauthChrome(false);
      const shownOnAdd = field.hidden === false && trigger.offsetParent !== null;
      return { widgetInField, hiddenOnReauth, shownOnAdd };
    });
    if (r.fatal) problems.push('[reauth] ' + r.fatal);
    else {
      ok('[reauth] the .pcombo widget lives inside #acct-provider-field (the container governs its visibility)', r.widgetInField);
      ok('[reauth] acctReauthChrome(true) hides the whole chooser, widget included (not just the native select)', r.hiddenOnReauth, JSON.stringify(r.hiddenOnReauth));
      ok('[reauth] acctReauthChrome(false) restores the chooser for a normal Add', r.shownOnAdd, JSON.stringify(r.shownOnAdd));
    }
    if (pageErrors.length) problems.push('[reauth] pageerror: ' + pageErrors.join(' | '));
    await page.close();
  }

  // A REAL mouse pick in the Add-a-provider dialog keeps the dialog open (0.6.95, Windows,
  // Settings > AI Models: "when I try to add Grok or Gemini it flashes for a second and then
  // goes away"). The widget used to commit on MOUSEDOWN, which hid the list while the button
  // was still down; the mouseup then landed on the dialog's backdrop, the browser sent the
  // click to the element holding both (the backdrop), and its click handler closed the dialog.
  // Only options drawn past the dialog's bottom edge were hit, which in the 0.6.95 layout was
  // Gemini and Grok (and OpenAI); which sit past it now is printed per pick (see pastEdge
  // below). Every other assertion in this file picks by keyboard or synthetic events, which is
  // why none of them saw it: this one presses the real mouse (page.click) on the option.
  /* Which options sit past the dialog's bottom edge depends on the dialog's height, and that moves
     (#2234's help link under the picker made it taller, which brought Gemini inside it). So each
     pick is still made with the real mouse and must keep the dialog open, and the non-vacuous
     condition is that AT LEAST ONE picked option sits past the edge: if the dialog grows until none
     does, this fails rather than passing on a geometry that can no longer reproduce the bug. */
  const pastEdge = [];
  for (const [val, label] of [['google', 'Gemini'], ['xai', 'Grok']]) {
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    await page.goto(PAGE);
    const t = '[add-dialog mouse pick][' + label + '] ';
    const setup = await page.evaluate(() => {
      // The tool is missing, so the pick opens the download step (the operator's fresh machine).
      const enc = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
      window.fetch = async (url) => {
        const u = String(url);
        if (/\/api\/runners(\?|$)/.test(u)) return enc({ runners: { gemini: { present: false, job: null }, grok: { present: false, job: null } } });
        if (/\/api\/accounts(\?|$)/.test(u)) return enc({ accounts: [] });
        // #3874: Gemini on a Google subscription not offered here, so Gemini's pick goes on to the download.
        if (/\/api\/antigravity(\?|$)/.test(u)) return enc({ enabled: true, supported: false, installed: false });
        return enc({});
      };
      if (typeof openAcctAdd !== 'function') return { fatal: 'openAcctAdd is not a global function' };
      openAcctAdd();
      return { open: !document.getElementById('acct-add-modal').hidden };
    });
    if (setup.fatal) { problems.push(t + setup.fatal); await page.close(); continue; }
    await page.click('#acct-provider-field .pcombo-trigger');
    const geo = await page.evaluate((v) => {
      const li = document.querySelector('#acct-provider-field .pcombo-opt[data-value="' + v + '"]');
      const d = document.getElementById('acct-add-dialog').getBoundingClientRect();
      if (!li || li.offsetParent === null) return { listOpen: false };
      const b = li.getBoundingClientRect();
      return { listOpen: true, belowDialog: b.top + b.height / 2 > d.bottom, optMid: Math.round(b.top + b.height / 2), dialogTop: Math.round(d.top), dialogBottom: Math.round(d.bottom), vh: innerHeight };
    }, val);
    ok(t + 'the list opens with the option in it', geo.listOpen, JSON.stringify(geo));
    // The margin, every run: how far each option sits from the edge, so a shrinking one is seen early.
    console.log('NOTE  ' + t + 'geometry ' + JSON.stringify(geo));
    if (geo.listOpen && geo.belowDialog) pastEdge.push(label);
    await page.click('#acct-provider-field .pcombo-opt[data-value="' + val + '"]');
    await page.waitForTimeout(600);
    const after = await page.evaluate(() => ({
      modalOpen: !document.getElementById('acct-add-modal').hidden,
      picked: document.getElementById('acct-provider-pick').value,
      install: !document.getElementById('acct-keyed-install').hidden,
    }));
    ok(t + 'a mouse pick keeps the Add-a-provider dialog open', after.modalOpen, JSON.stringify(after));
    ok(t + 'the mouse pick selects the provider', after.picked === val, JSON.stringify(after));
    ok(t + 'the dialog goes on to the download step for the missing tool', after.install, JSON.stringify(after));
    if (pageErrors.length) problems.push(t + 'pageerror: ' + pageErrors.join(' | '));
    await page.close();
  }
  // Non-vacuous: at least one mouse pick above was on an option drawn past the dialog's bottom edge,
  // the geometry the bug needed (the case that closed it).
  ok('[add-dialog mouse pick] at least one picked option sits past the dialog\'s bottom edge', pastEdge.length > 0, JSON.stringify(pastEdge));

  // #1040 2b: #create-provider is the ONLY enhanced select in a fixed-width (18rem) stepped
  // flex row (#cstep-name .msteps .frow), elbow-aligned with #create-account / #create-model.
  // enhanceProviderSelect clips the native select and inserts a .pcombo with no width of its
  // own, so without the scoped 18rem rule the widget sizes to its content and the provider row
  // stops lining up with the rows beneath it (a pixel-alignment regression Josh has flagged on
  // this screen). Assert the enhanced trigger width matches the sibling #create-model select.
  {
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    await page.goto(PAGE);
    const r = await page.evaluate(() => {
      const sel = document.getElementById('create-provider');
      const model = document.getElementById('create-model');
      const wrap = sel && sel.parentNode.querySelector('.pcombo');
      if (!sel || !model || !wrap) return { fatal: 'no #create-provider / #create-model / .pcombo widget' };
      // Un-hide the create panel + every hidden ancestor so the stepped row is laid out.
      for (let p = sel; p && p !== document.body; p = p.parentNode) {
        if (p.hasAttribute && p.hasAttribute('hidden')) p.hidden = false;
        if (p.style && p.style.display === 'none') p.style.display = '';
      }
      const trigger = wrap.querySelector('.pcombo-trigger');
      const tw = Math.round(trigger.getBoundingClientRect().width);
      const mw = Math.round(model.getBoundingClientRect().width);
      return { tw, mw };
    });
    if (r.fatal) problems.push('[create-width] ' + r.fatal);
    else {
      // Row parity: the widget width tracks the sibling 18rem select (within 2px), and is
      // clearly wider than a content-sized trigger would be (> 200px), so a collapsed/
      // content-sized widget (the bug this rule fixes) reds rather than passing.
      ok('[create-width] the #create-provider combobox widget matches the stepped-row width of #create-model (not content-sized)',
        Math.abs(r.tw - r.mw) <= 2 && r.tw > 200, JSON.stringify(r));
    }
    if (pageErrors.length) problems.push('[create-width] pageerror: ' + pageErrors.join(' | '));
    await page.close();
  }

  await browser.close();
  if (problems.length) {
    console.error('render-provider-combobox-1040: ' + problems.length + ' problem(s)');
    for (const p of problems) console.error('  FAIL  ' + p);
    process.exit(1);
  }
  console.log('render-provider-combobox-1040: the #d-provider, #acct-provider-pick and #create-provider logo comboboxes keep the native select as source of truth, open/navigate/select/close by keyboard, sync + fire change, disable coming-soon rows, show the real Grok mark (#3708), and re-render on a programmatic change; and the reauth screen hides the whole #acct-provider-pick chooser (widget included). Screenshots: ' + shots.join(', '));
})();
