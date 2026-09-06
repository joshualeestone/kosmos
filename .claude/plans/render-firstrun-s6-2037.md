# Plan: in-suite Screen-6 consent-switch render check (#2037 + #2020)

## Context
PR-C2 (#2318, merged) wired the install-flow Screen 6 consent switches. Its #1720
browser-check gate was satisfied with a `Browser-check:` trailer that named a
dedicated in-suite Playwright render check as a tracked follow-up. This is that
follow-up: a durable in-suite guard so a future regression of the S6 wiring reds
a check rather than reaching a user.

## What "done" looks like
- A HERMETIC browser check `docs/browser-checks/render-firstrun-s6-2037.js` that
  loads web/index.html over file:// (boots no server), shows Screen 6 via the real
  `frGo(6)`, and asserts on the REAL bound handlers:
  - both `#fr-s6-feedback` and `#fr-s6-createping` are role=switch, default-ON;
  - the pane is reachable/visible;
  - the on-show refresh failing to read leaves both ON (never a false Off);
  - a real click on feedback and a real Space keydown on create-ping each flip
    aria-checked to "false" and PUT their own backend.
- Wired into the runner (tools/browser-checks.sh hermetic loop), indexed in
  docs/browser-checks/README.md, and the reason-grep emit-count test bumped so the
  suite stays consistent.
- Red-capable: on a page with the wiring absent, a click does nothing and no PUT is
  sent, so the check reds.

## Approach
Modeled on `render-firstrun-model-continue-2134.js` (the same hermetic file://
pattern). Emits per-problem `console.error('  FAIL  ' + p)` so the #1720/#1864 gate
can quote its failures (the reason-grep test enforces this). SKIPS cleanly (exit 0
with a SKIPPED line) when playwright is not on NODE_PATH.

## Verification
- Ran headless against the shipped web/index.html (the exact bytes 0.6.38 serves;
  the app runs web/index.html from source): GREEN, all arms. This run also served
  as PR-C2's live code verification.
- Static suite tests pass: browser-checks-reason-grep.test.js (counts bumped
  51->52 / 29->30, verified) and browser-checks-indexed.test.js (README names every
  script).

## Rejected / deferred
- A LIVE native staging install on this shared box to drive the check against a
  running board: setup.sh overwrites /Applications/Kosmos.app + touches launchd on
  the shared 18-agent fleet box, and Josh's install testing is on a separate fresh
  mac. Surfaced to Splinter; not run here. The hermetic file:// check verifies the
  same web/index.html bytes.

## Weakest premise
That file://-loaded web/index.html binds and runs the same as the board-served page
(the switches are static markup present before the inline script, so the top-level
bind resolves them; verified the pane shows and the handlers fire in the headless
run). A board-served run would additionally exercise the real /api persistence,
which server.test.js route round-trips already cover.
