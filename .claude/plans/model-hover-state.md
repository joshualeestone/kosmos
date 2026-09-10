# Plan: rollover highlight on the connectable model rows

Branch: `model-hover-state`
Repo: `joshualeestone/kosmos` (worktree `agent-workforce-model-hover-2`)
Author: Mona Lisa (design/content), 2026-09-10
Source: direct ask from Josh in the monalisa channel (1545167231951044749), 2026-09-10:
"A really small card... a mouseover state. Right now I'm mouseover OpenAI but I don't have
any indicator that I have a rollover state. I can see the active one is Anthropic but I don't
get any sort of feedback when I mouse over other active ones." Not a filed GitHub card; Josh
asked to capture and build it (he confirmed it does not need to jump the queue).

## Problem

On the first-run "Choose a model." screen (`#fr-pane-5` in `web/index.html`), the connectable
provider rows (`.llm.on` — Claude and GPT) have no hover feedback. Only the connected provider
shows any state (its Connect button turns green). Mousing over the other working rows gives no
cue that they are interactive, so a person cannot tell the row responds.

## Decision

Add a hover/focus-within highlight to `.llm.on` (connectable) rows only:

- gold border (`var(--gold)`),
- a faint gold wash (`rgba(214,166,46,.06)`, which is `--gold` at low alpha, matching the
  raw-rgba pattern `.llm.off` already uses),
- a soft lift (`box-shadow: 0 1px 6px rgba(20,22,26,.06)`),
- a `.12s` transition on the base `.llm` rule so hover in/out animates smoothly.

`:focus-within` mirrors the hover so a keyboard user tabbing to the Connect button gets the
same cue.

## What was rejected and why

- **A hover on every `.llm` row, including `.llm.off` (Coming soon):** rejected. Those rows are
  not actionable. A hover affordance on a row that cannot be acted on promises a click it
  cannot honour, which is worse than no affordance.
- **`cursor: pointer` on the whole row:** rejected. Only the `.connect-b` button is a click
  target — there is no row-level click handler (confirmed: no `closest('.llm')` / row listener
  in the file). A pointer cursor on the row would falsely imply the whole row clicks. The row
  highlight draws the eye to the row and its Connect button without over-promising.
- **A "selected" toggle state:** out of scope. Josh asked for hover feedback, not a new
  selection model; the connected provider already carries its own state via the green button.

## Weakest premise

That a row-highlight (rather than, say, a button-only emphasis) is the feedback Josh wants.
His words describe mousing over the row and wanting a rollover, so a row highlight is the
direct read; if he prefers the feedback concentrated on the Connect button instead, that is a
one-line follow-up. Easily reversible.

## Scope / risk

CSS-only. No markup change, no served string, no DOM change, no JS. Light-theme screen (the
`.llm` background is `#fff`). Verified the look with a static repro screenshot (a bot session
cannot drive an interactive Playwright hover). Full node suite green (5763 tests, 0 fail);
both browser-check gates pass (coarse via a `Browser-check:` trailer, surface gate clean).
