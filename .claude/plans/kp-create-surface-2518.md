# Plan: kp-create-surface-2518 -- surface-map coverage for the KP create journey (#2518)

## Why

Follow-up to the connect+trust batch (PR #2544). #2518's gate only guards a browser-check once it
declares its `// Browser-check-surface:` tokens; ~106 checks remain unannotated, including the
create-an-agent journey (the core KP flow after connect). An unannotated create check stales silently
on a web/index.html change until the next cut. This adds the create journey (2 checks; a 3rd, create-form,
was dropped in review -- see below).

## The batch (no-browser, tokens verified ASSERTED so a rename REDS the check)

- `render-createnav-2190.js`  -> `made-head create-msg`
  (#2190 create -> PROGRESS 'made' screen vs error routes BACK: made-head names the agent (asserted:
   `/tester/.test(created.madeHead)` L101), create-msg is the error message beside the field (asserted:
   `/that name will not work/.test(refused.createMsg)` L116))
- `render-create-made.js`     -> `made-mark cstep-made`
  (the last made-screen: made-mark is the drawing-mark settle/assertion L68/138, cstep-made is the on-screen
   made step asserted L133/143/162)

Data-only: one `// Browser-check-surface:` comment on line 1 (Baron's #2539 convention). No check logic.

## DROPPED / DEFERRED (found by blind review -- documented, not silently skipped)

- `render-create-form.js` -> `create-account-row`: DROPPED. The token looked asserted but the only check
  reading it (L295-297) is `seen.acctRowHidden ? seen.acctElbowPainted === false : true`, fed by
  `acctRowHidden: id('create-account-row') ? ...hidden : null` (L149). A rename/removal makes the lookup
  null -> the ternary falls to its `true` default and the check PASSES UNCONDITIONALLY (even with the real
  orphan-elbow regression present). So the annotation would give false confidence. FOLLOW-UP: a real
  fail-open bug in the CHECK -- fix the ternary to fail-closed (precondition `id(...) !== null`, or default
  false), THEN annotate. Out of scope for a data-only annotation batch.
- `render-createnav-2190.js` has no top-level `.catch` (its siblings do). made-head/create-msg are genuinely
  asserted and a rename still reds the check (getElementById(...).textContent throws on null -> non-zero exit
  on this repo's pinned node), so the annotation's contract HOLDS -- but via an unlabelled crash, not a clean
  FAIL line. FOLLOW-UP (diagnostics quality, pre-existing check code): add the sibling `.catch`. Not a blocker.

## Acceptance

- #2529 dead-annotation meta-guard green (all 5 tokens live in web/index.html).
- `tools/bc-surface-map.sh map` emits the 3 checks with their tokens.
- Gate test + helper suite green; full node suite + test:shell green.
- Bounded batch; the rest of the KP journey (sign-in, openai connect, plus/pay, badge/liveness) is a
  clean follow-up. (render-board-signin-403-2023 keys on the generic #pj-list shared by many checks, so
  it wants a text-based or more-distinctive token, not a naive pj-list annotation -- deferred, noted.)
