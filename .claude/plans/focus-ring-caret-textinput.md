# Drop the dark focus stroke on the text composer (Josh 0.6.47 item 6.01.26; Mona's ruling (a))

Branch: `focus-ring-caret-textinput`. Repo: agent-workforce (kosmos). Owner: Angel.

## Decision (mine, per Josh's standing "decide it yourself" ruling)
Josh raised the composer's focus stroke AGAIN in his 0.6.47 live test ("the black inner
stroke when you click into a text box") after the kosmos#1303 D softening. His newer feedback
supersedes that softening. Mona ruled (a): for the TEXT COMPOSER specifically, drop the dark
focus border; the blinking caret is the "box is on" signal.

**What I rejected:** keeping the softened ring (the #1303 D "SOFTENED, NOT DELETED" note). It
loses to Josh's newer, explicit feedback that the stroke is still unwanted.

**Weakest premise (named so it can be overturned in a sentence):** that the text caret alone is
a sufficient focus indicator. It satisfies WCAG 2.4.7 Focus Visible (Level AA, which accepts the
text cursor for a text field), so our AA floor holds; it does NOT satisfy 2.4.13 Focus Appearance
(area/contrast), but that is Level AAA. A thin caret is a documented tradeoff below AA, not a
failure of it. **What would change my mind:** if the caret were suppressed in any theme, or if
Josh/Mona want an AAA-strength indicator, restore a soft (non-dark) focus treatment.

## Definition of done
- Clicking/tabbing into the composer no longer paints the near-black focus border or the 3px halo.
- The composer keeps its resting 1px --k-rule border on focus; the caret is the focus signal.
- Non-text controls (buttons, links) keep their own focus indicators untouched (this rule was the
  composer's alone).
- WCAG 2.4.7 AA preserved (caret = visible focus indicator).

## Changes
- `web/index.html`: removed `.composerbox:focus-within { border-color: var(--k-ink-2); box-shadow: ... }`
  and rewrote the rationale comment (the #1303 D reversal + the WCAG analysis).
- `web.focus-ring-1303d.test.js`: inverted to pin the new intent -- the dark stroke is gone (a
  re-added `--k-ink-2` border / `0 0 0 3px` halo FAILS), the caret is not hidden, the resting
  border is untouched.
- `docs/browser-checks/render-composer-reset.js`: added a real focus-style assertion (focus the
  composer, read the container's computed style: box-shadow none, border not near-black, caret
  not transparent). Satisfies the #1720 browser-check gate (modified existing check).

## Verify
- `node --test web.focus-ring-1303d.test.js` (3/3).
- `NODE_PATH=$HOME/work/pw-runtime/node_modules node docs/browser-checks/render-composer-reset.js` (9/9).
- Before/after screenshots captured (focused composer: dark ring gone).
- FULL `run-tests.sh` on the box; /challenge-loop before PR.
