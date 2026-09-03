# adopt-walk-1531 -- a committed headless browser walk of the adopt prompt

## The card

kosmos#1531: a person who runs Claude in a folder with **no instruction file** is
offered that folder for ADOPTION under a name they type -- headline "Is this one of
your agents?", an empty editable name field, decline in one click. The engine and
UI halves are built and content-verified on `main`
(`engine/discover.adoptable-1531.test.js`, `web/index.html` `adoptRowsHtml` at
~34318, server routes). The card's **one remaining step** is a live ADOPT-PROMPT
browser walk, owned by Renet Tilley, and its close criterion is: "somebody adopts a
folder that has no instruction file and gets a name."

## Why it was parked, and why it is not blocked

The card cited #1769 ("no bot session can run a browser"). #1769 was **rescoped and
closed 09-02** (PR #1854): committed **headless** checks run fine from a launchd bot
via `~/work/pw-runtime`, no MCP; only the interactive Playwright MCP is unavailable.
Smoke-tested here: chromium 151 launched headless, read the DOM, closed clean. So the
walk is doable now.

## The approach

Add `docs/browser-checks/render-adopt-1531.js`, modeled on the sibling
`render-found-undo.js`: launch playwright (headless under `HEADED=0`), intercept every
route the adopt handlers touch with `page.route` (so the real DOM and handlers run
without touching the machine), navigate to the first-run fleet step via
`gotoStepForAnchor('#fr-fleet')`, and drive the `.fr-adopt` rows.

The `.fr-adopt` painter (`adoptRowsHtml`) renders inside `frPaintFound`, reached only
when there is at least one offerable found agent, so the fixture carries one filed
agent alongside two no-instruction folders (one to adopt, one to decline).

### Assertions (the close criterion + Mona Lisa's load-bearing copy points)

1. The prompt heading is a **question**, not a name assertion.
2. The folder path is shown (the only fact an adopt row has); the name field is empty.
3. The name field is an editable text input AND reachable (`elementFromPoint`).
4. The helper line ("What should we call it?") is present.
5. An **empty** name is refused **before the network** (proven by a per-route call
   counter that stays flat).
6. A **typed** name posts `{dir, name}` and registers (button -> "Added", row `.done`).
   This is the card's close criterion.
7. Decline (`.fr-adoptno`) is one blameless click: the right folder is posted, the row
   records it, and Undo appears (no confirm dialog).

The connect mock returns 200 only for `dir === ADOPT_DIR && name.length > 0`, so a
misaddressed or nameless write cannot pass. The register arm (DOM receipt) is checked
separately from the posted-body arm, so a build that posts correctly but fails to
register is caught.

## Wiring

- `tools/browser-checks.sh`: one `run_one "render-adopt-1531" ... "$B8"` on the same
  first-run board `render-found-undo` already boots (no new board boot), plus the
  boot-failure else-list (completing it for `render-scan-board`, `render-first-run`,
  `render-boot-no-flash` too, which were wired but unlisted).
- `docs/browser-checks/README.md`: index row.
- `browser-checks-reason-grep.test.js`: site count 30 -> 31 for the quotable `FAIL`
  line.

No `web/` change, so the #1720 browser-check CI gate needs no trailer.

## Boundaries

- **PR, not self-merge.** Kosmos deploy is Angel / Mona Lisa; this is a check that
  gates the adopt-prompt surface.
- #1629's "browser walk" is NOT built here and should not be: its trust dialog is
  Claude Code's terminal prompt, unreachable by any chromium, and its acceptance is a
  behavioral account-flip test. #1652's import walk is board-walkable but is
  PigeonPete's.

## Verification

Two-iteration challenge loop, converged. 12/12 green headless against a sandboxed
board; the register arm reds under a forced `/api/connect-agent` 400 perturbation
while the posted-body arm holds (a proven control). All four browser-check guards
green; `bash -n` clean. Proof: `.claude/plans/adopt-walk-1531-pre-challenge.md`.
