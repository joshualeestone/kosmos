'use strict';
/**
 * kosmos#1040 2b: the provider logo combobox (enhanceProviderSelect), over BOTH remaining
 * provider selects (#d-provider, the switch dialog; #acct-provider-pick, the Add-a-provider
 * screen). Drives the SHIPPED widget in the real page and asserts the WAI-ARIA combobox
 * contract: the native <select> stays the source of truth (hidden, still in the DOM with its
 * options), the trigger shows the selected mark+label, open/close + keyboard nav +
 * Enter-select sync the hidden select's .value and fire `change`, Esc closes and refocuses,
 * a coming-soon option is aria-disabled and NOT selectable, Grok gets an initial-letter chip
 * (no wrong-brand mark), and a programmatic value change re-renders the trigger. Both themes,
 * plus a screenshot. It also checks the #acct-provider-pick reauth-hide contract: the
 * "Sign in again" screen hides the whole chooser container, widget included. This is the CI
 * browser-checks (Playwright) verification of the a11y CONTRACT; a real screen-reader pass is
 * the human follow-up no Playwright can do.
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
        disabledLi.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        disabledNotSelectable = select.value === before; // committing a disabled option is a no-op
      }

      // Grok/xai option renders an initial-letter chip, never a cloned brand mark.
      const grokLi = Array.from(list.children).find((li) => li.dataset.value === 'xai');
      const grokChip = !!(grokLi && grokLi.querySelector('.pcombo-chip') && !grokLi.querySelector('svg'));

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
    ok(t + 'Grok/xai renders an initial-letter chip, not a brand mark', r.grokChip);
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

  await browser.close();
  if (problems.length) {
    console.error('render-provider-combobox-1040: ' + problems.length + ' problem(s)');
    for (const p of problems) console.error('  FAIL  ' + p);
    process.exit(1);
  }
  console.log('render-provider-combobox-1040: the #d-provider and #acct-provider-pick logo comboboxes keep the native select as source of truth, open/navigate/select/close by keyboard, sync + fire change, disable coming-soon rows, fall back to a chip for Grok, and re-render on a programmatic change; and the reauth screen hides the whole #acct-provider-pick chooser (widget included). Screenshots: ' + shots.join(', '));
})();
