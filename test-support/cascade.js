'use strict';

/**
 * Which CSS rule actually GOVERNS (#1476).
 *
 * 🛑 THE DEFECT THIS EXISTS FOR: `web/index.html` declares some selectors more
 * than once, and a text assertion pinned to an EARLIER declaration is green
 * when the behaviour breaks and red on a no-op. Measured on main, both arms:
 *
 *   delete the LATER  .pjcard-h rule  -> behaviour CHANGES -> assertion GREEN
 *   delete the EARLIER .pjcard-h rule -> no visual effect  -> assertion RED
 *
 * ⭐ The limit that let it through, in the card's words: a text pin proves the
 * assertion tracks the TEXT. It does not prove the assertion guards the
 * BEHAVIOUR. Perturbing the rule you named cannot tell you another rule was
 * overriding it.
 *
 * ⚠️ SCOPE, STATED SO NOBODY OVER-TRUSTS IT. This reads SINGLE-LINE rules from
 * the page's `<style>` blocks: 1104 of them, which is the form this stylesheet
 * is written in. It does NOT parse multi-line rules, media queries as separate
 * cascades, specificity, or inline styles. It answers exactly one question --
 * "of the rules written with THIS EXACT SELECTOR TEXT, which declaration of
 * this property comes last" -- which is the question the #1476 assertions got
 * wrong. It is not a CSS engine and must not be described as one.
 */

/** The page's stylesheet text, script blocks excluded.
    ⚠️ Not cosmetic: `index.html` carries ~32k lines including JavaScript, and a
    naive rule sweep over the whole file matches `} catch` and `if (!res.ok)`.
    Measured: 73 "duplicated selectors" before this scoping, 51 after. */
function cssText(page) {
  return [...String(page).matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
}

const RULE = /^[ \t]*([^\n{}/][^\n{}]*)\{([^{}\n]*)\}[ \t]*$/;

/**
 * Every single-line rule in source order, as { selector, decls, scope }.
 *
 * 🛑 `scope` IS LOAD-BEARING AND WAS NOT IN THE FIRST VERSION OF THIS FILE.
 * Without it, a selector written once at full width and again inside
 * `@media (max-width: 52rem)` reads as "declared twice, the later one wins" --
 * which is FALSE. They govern at different widths and neither supersedes the
 * other.
 *
 * ⚠️ Measured: the scope-blind version reported TWO defects that are ordinary
 * responsive overrides (`.pj-list:not(.asgrid) .pj-row .pjpill` at 56rem vs
 * 52rem, and `#panel-settings .dbody` at base vs 60rem vs 56rem). Shipping it
 * would have put a red on two correct tests, and a guard that misfires on
 * correct code gets deleted -- which is this suite's own stated reason for
 * pinning conventions rather than parsing.
 */
function rules(page) {
  const out = [];
  const stack = [];
  for (const line of cssText(page).split('\n')) {
    const at = line.match(/@(media|supports|container)[^{]*\{/);
    if (at) {
      /* A conditional block opens. Its condition IS the scope of everything
         inside it, and blocks can nest. */
      stack.push(at[0].replace(/\s*\{$/, '').trim());
      /* An `@media (...) { sel { ... } }` written entirely on ONE line opens and
         closes in the same line, so it must not leak into the lines below. */
      if ((line.match(/\}/g) || []).length >= (line.match(/\{/g) || []).length) stack.pop();
    } else if (/^\s*\}\s*$/.test(line)) {
      stack.pop();
    }
    const m = line.match(RULE);
    if (m && !/^@/.test(m[1].trim())) {
      out.push({ selector: m[1].trim(), decls: m[2].trim(), scope: stack.join(' && ') });
    }
  }
  return out;
}

/** The declarations written for one exact selector, in source order. */
function declarationsFor(page, selector, scope) {
  return rules(page)
    .filter((r) => r.selector === selector && (scope === undefined || r.scope === scope))
    .map((r) => r.decls);
}

/**
 * The value that WINS for `prop` under `selector`, or null if never set.
 * Later declaration wins, which is the whole point.
 */
function effective(page, selector, prop) {
  const want = new RegExp('(?:^|;)\\s*' + prop.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*:\\s*([^;]+)');
  let value = null;
  for (const decls of declarationsFor(page, selector)) {
    const m = decls.match(want);
    if (m) value = m[1].trim();
  }
  return value;
}

/**
 * Selectors written more than once, as Map<selector, decls[]>.
 *
 * 📌 Keyframe steps are excluded. `0%`, `50%`, `from` and `to` recur across
 * separate `@keyframes` blocks, where each block is its own scope, so they are
 * duplicates of the TEXT and not of a cascade. Including them would make a
 * sweep noisy in a way that teaches people to ignore it.
 */
const KEYFRAME_STEP = /^(?:from|to|\d+%(?:\s*,\s*\d+%)*)$/i;

function duplicatedSelectors(page) {
  /* Keyed on selector AND scope: two rules only compete if they apply at the
     same time. */
  const by = new Map();
  for (const r of rules(page)) {
    if (KEYFRAME_STEP.test(r.selector)) continue;
    const key = r.selector + '\u0000' + r.scope;
    if (!by.has(key)) by.set(key, { selector: r.selector, scope: r.scope, decls: [] });
    by.get(key).decls.push(r.decls);
  }
  return new Map([...by.values()].filter((v) => v.decls.length > 1)
    .map((v) => [v.selector, v.decls]));
}

module.exports = { cssText, rules, declarationsFor, effective, duplicatedSelectors };
