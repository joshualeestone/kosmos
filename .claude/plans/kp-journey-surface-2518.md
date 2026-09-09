# Plan: kp-journey-surface-2518 -- surface-map coverage for the KP connect + trust journey (#2518)

## Why

#2518's surface->check gate only guards a browser-check once that check declares its
`// Browser-check-surface:` tokens. Measured: 131 checks, 21 annotated, 110 not -- and MANY of the
unannotated ones are the launch-critical KP journey (sign-in / connect / create / first-run / trust).
An unannotated KP-journey check can be staled by a web/index.html change with no PR-time signal (it
reds only at the next cut). Splinter routed me this coverage slice (Baron grew batches #2529/#2539;
he has moved to env-versioning/#2519). This is the no-browser, headless half: add the annotations.

## The batch (no-browser: 4 checks, the KP connect + trust journey)

Each token is a DISTINCTIVE DOM id the check keys on AND present (whole-token) in web/index.html
(verified against the #2529 dead-annotation meta-guard, which reds on any dead token):

- `render-claude-connect-choice-2433.js`  -> `acct-claude-go acct-claude-key-step`
  (the connect subscription-vs-api-key choice; the #2420 connect flow whose engine I built)
- `render-trust-restart-0644.js`           -> `d-trust-restart d-trust-restart-msg`
  (the one-click trust-and-restart born-online fallback; the #2129 route whose engine I built)
- `render-firstrun-connect-fires.js`       -> `fr-llm-connect fr-claude-confirm`
  (the first-run connect pane trigger + confirm)
- `render-firstrun-connect-box-2187.js`    -> `fr-ctitle`
  (the first-run connect box title)

Data-only: each annotation is a single `// Browser-check-surface:` comment on line 1 (Baron's #2539
convention), before `'use strict'`. No check LOGIC changes; the check files stay valid JS.

## Scope / what this is NOT

- BOUNDED to the connect+trust journey (4 checks), not all 110 unannotated -- incremental, the way
  #2529 (+6) and #2539 (+13) grew it. The rest of the KP journey (sign-in board, create, openai
  connect, pay/plus) is a clean follow-up batch.
- The map + gate are UNCHANGED (I own the query helper; this only feeds it data). The shared-parse-fn
  extraction is a separate, sequenced follow-up (drift is already mutation-guarded).

## Acceptance

- #2529 dead-annotation meta-guard green (all 4 tokens live in web/index.html).
- `tools/bc-surface-map.sh map` emits the 4 checks with their tokens.
- The gate test + my helper's suite stay green; full node suite + test:shell green.
