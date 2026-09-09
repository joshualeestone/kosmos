# Plan: kp-create-surface-2518 -- surface-map coverage for the KP create journey (#2518)

## Why

Follow-up to the connect+trust batch (PR #2544). #2518's gate only guards a browser-check once it
declares its `// Browser-check-surface:` tokens; ~106 checks remain unannotated, including the
create-an-agent journey (the core KP flow after connect). An unannotated create check stales silently
on a web/index.html change until the next cut. This adds the create journey (3 checks).

## The batch (no-browser, tokens verified ASSERTED + present in web/index.html)

Each token is a DOM id the check ASSERTS on (a rename reds the check), verified upfront against the
check's assertion lines (applying the connect batch's lesson: present-in-web is not enough):

- `render-create-form.js`     -> `create-account-row`
  (step 2 of Create; the check's CSS subject `:has(> #create-account-row[hidden])`, asserted L148/153/292)
- `render-createnav-2190.js`  -> `made-head create-msg`
  (#2190 create -> PROGRESS 'made' screen vs error routes BACK: made-head names the agent (asserted L73/100),
   create-msg is the error message beside the field (asserted L72))
- `render-create-made.js`     -> `made-mark cstep-made`
  (the last made-screen: made-mark is the drawing-mark settle/assertion L68/138, cstep-made is the on-screen
   made step asserted L133/143/162)

Data-only: one `// Browser-check-surface:` comment on line 1 (Baron's #2539 convention). No check logic.

## Acceptance

- #2529 dead-annotation meta-guard green (all 5 tokens live in web/index.html).
- `tools/bc-surface-map.sh map` emits the 3 checks with their tokens.
- Gate test + helper suite green; full node suite + test:shell green.
- Bounded batch; the rest of the KP journey (sign-in, openai connect, plus/pay, badge/liveness) is a
  clean follow-up. (render-board-signin-403-2023 keys on the generic #pj-list shared by many checks, so
  it wants a text-based or more-distinctive token, not a naive pj-list annotation -- deferred, noted.)
