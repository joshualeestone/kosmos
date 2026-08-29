'use strict';

/**
 * #1476: A TEST MAY NOT PIN A CSS DECLARATION THAT A LATER RULE OVERRIDES.
 *
 * 🛑 THE DEFECT, MEASURED ON MAIN BOTH WAYS BEFORE THIS EXISTED:
 *
 *   delete the LATER  .pjcard-h rule -> the layout actually changes -> GREEN
 *   delete the EARLIER .pjcard-h rule -> no visual effect at all    -> RED
 *
 * ⇒ Green when the thing it names breaks, red on a no-op. Exactly inverted, and
 * two assertions were in that state (Vivienne, found by a blind reviewer).
 *
 * ⭐ WHY A GUARD RATHER THAN TWO FIXES. The proof method those assertions passed
 * operates entirely on rule TEXT: corrupt the property, append a declaration,
 * and the same against the old form. **All four arms ask whether the assertion
 * tracks the text. None asks whether that rule GOVERNS.** So an assertion can
 * pass every arm and still be blind to the behaviour it names. That gap does not
 * close by fixing two files.
 *
 * ⚠️ WHAT THIS DOES NOT DO, stated so nobody over-trusts a green. It compares
 * declarations of the SAME selector text in the SAME conditional scope. It does
 * not model specificity, so a different selector that also matches the element
 * is invisible to it, and it does not read multi-line rules. It catches exactly
 * the shape that bit us and says nothing about the rest.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { duplicatedSelectors, effective } = require('./test-support/cascade');

const PAGE = fs.readFileSync('web/index.html', 'utf8');

/* Test sources carry pinned rules as regex literals, so `\{` and `\.` are
   escaped. Dropping backslashes makes the pinned text comparable to the
   stylesheet's own. */
const unescape = (s) => s.replace(/\\/g, '');

const declaredProps = (decls) => decls.split(';').map((d) => d.trim()).filter(Boolean)
  .map((d) => [d.slice(0, d.indexOf(':')).trim(), d.slice(d.indexOf(':') + 1).trim()]);

test('no test pins a CSS declaration that a later rule in the same scope overrides', () => {
  const dup = duplicatedSelectors(PAGE);
  const files = fs.readdirSync('.').filter((f) => f.endsWith('.test.js'));

  /* POPULATION FLOORS. A sweep that reads nothing also finds nothing, and this
     one would then report the codebase clean forever. Both numbers are well
     under what the tree carries (30 and 194 when written). */
  assert.ok(dup.size >= 10, `expected the stylesheet to declare many selectors twice, saw ${dup.size}`);
  assert.ok(files.length >= 50, `expected to sweep the test suite, saw ${files.length} files`);

  const findings = [];
  for (const f of files) {
    if (f === 'web.cascade-shadowed-pins-1476.test.js') continue;
    const src = unescape(fs.readFileSync(f, 'utf8'));
    for (const [selector, decls] of dup) {
      for (let i = 0; i < decls.length - 1; i += 1) {
        if (!src.includes(`${selector} { ${decls[i]} }`)) continue;
        /* Pinning an earlier rule is only WRONG when a property it names is
           actually overridden. A later rule that sets different properties
           leaves the pin governing, and flagging that would be noise. */
        for (const [prop, value] of declaredProps(decls[i])) {
          const wins = effective(PAGE, selector, prop);
          if (wins !== null && wins !== value) {
            findings.push(`${f}: pins "${prop}: ${value}" on "${selector}", but "${prop}: ${wins}" governs`);
          }
        }
      }
    }
  }

  assert.deepEqual(findings, [],
    'this assertion is GREEN when the behaviour it names breaks and RED on a no-op, '
    + 'because it pins a rule a later one overrides. Assert the effective value '
    + 'instead: `effective(PAGE, selector, prop)` from test-support/cascade. Do not '
    + 'fix it by re-anchoring the closing brace, which is orthogonal and re-arms #1310.');
});
