# Plan: #2917 Memory > Fresh Start — equal-width centered buttons + Memory/Fresh-start 50/50

Branch: `freshstart-2917`. Card: joshualeestone/kosmos#2917 (josh-review, 6.59 QA).
Unblocked when agentnav/#2948 merged (it combined Model+Memory under one nav pill; #2917's
50/50 was deferred until that landed so it is built against the final Memory-panel context).

## Josh's ask (6.59 QA, verbatim intent)
"the three buttons, Compact, Clear, and Restart, I want those to all be the same width...
make Compact and Restart the same width as Clear and center the text for the buttons... fit
these side by side so we could make memory 50% and move up fresh start to be the other 50%
width... underneath the model information when we combine model and memory."

## What was built
1. **Equal-width, centered buttons** (`web/index.html`, `.freshstack .btn`): `width: fit-content`
   -> `width: 100%` + `text-align: center`. All three buttons fill their column, so they are
   equal by construction, with centered labels.
2. **Memory 50% / Fresh start 50% side by side** (`web/index.html`, `#d-sec-memory`): wrapped the
   Memory `.dbox` and the Fresh-start `.dbox` (`#d-fresh`) in a new `.mem-fresh-row` flex row
   (`display:flex; flex-wrap:wrap; gap:18px`), each column `flex: 1 1 260px; min-width: 0`. Wraps
   to a single stacked column when the panel is too narrow for two.
3. **Guard updated** (`docs/browser-checks/render-memory-controls.js`): the existing #2809 guard
   asserted `btn <= container*0.9` (fit-content). That directly contradicts this change, so it was
   replaced with fill-column + equal-width + centered + 50/50 assertions. The guard ships with the
   change.

## Key decision: 100%-of-column, not fit-content-to-widest
Josh said "same width as Clear" (the current widest). But the Restart label is DYNAMIC:
`freshStartLabel` repaints it to "Restart: stop and start <agent-name>", so the widest button
varies per agent. A fit-content-to-widest group would therefore jump width per agent. 100%-of-column
is stable, equal by construction, and makes centered text meaningful (buttons wider than labels).
In the new 50% column this is NOT the full-PAGE bleed Josh rejected in #2809 (that was full width);
it is half that.

**Weakest premise:** 100%-of-column approximates "Clear's width" in the 50% column. If Josh wants
strictly Clear's fit-content width with whitespace around it in the column, that is a one-line
follow-up. The dynamic Restart label is why strict fit-content was not chosen.

## Constraints respected
- Tests pin `#d-restart-agent` as its own element in the memory section (web.restart-reach:52,
  web.agent-nav:41). Kept the two-container structure; did not merge Restart into the Compact/Clear
  stack. Both containers stay inside `#d-sec-memory`.
- Product voice, no em dashes (house rule).

## Verification
- Headless pw-runtime browser-check (render-memory-controls.js): buttons all 466px (equal, filled,
  centered, stacked, no wrap); Memory + Fresh-start both 516px side by side (true 50/50); Compact
  dialog still works; no page errors.
- Full node suite: 7328 tests, 0 fail. web.restart-reach + web.agent-nav: 12/12.
