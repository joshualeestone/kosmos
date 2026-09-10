# Plan: kp-openai-surface-2518 -- surface-map coverage for the KP OpenAI-connect journey (#2518)

## Why

Follow-up to the connect+trust (#2544) and create (#2547) batches. Adds the OpenAI-connect journey to
the #2518 surface map so a web/index.html change to those surfaces is caught at the PR gate.

## The batch (no-browser, tokens verified ASSERTED + FAIL-CLOSED)

- `render-firstrun-openai-connectbox-2241.js` -> `fr-openai-msg`
  (#2241: when OpenAI/codex is connected, the first-run OpenAI row paints the gold check-row box into
   #fr-openai-msg. FAIL-CLOSED: L64-65 `const host = getElementById('fr-openai-msg'); if (!host) return
   { error: '#fr-openai-msg is gone from the page' }` -> a rename reds the check.)
- `render-openai-key-step.js` -> `fr-openai-go fr-openai-key`
  (#1207: the OpenAI key step. FAIL-CLOSED: L60 `if (!add || !key) return { incomplete: true }` where
   add=#fr-openai-go, key=#fr-openai-key, and L78 `check('reachable and complete', false, ...)` when
   incomplete -> a rename of either reds the check. These are the "gate only on what every build has"
   elements the check's own L54 comment names.)

Data-only: one `// Browser-check-surface:` comment on line 1 (Baron's #2539 convention). No check logic.

## Acceptance

- #2529 dead-annotation meta-guard green (all 3 tokens live in web/index.html).
- `tools/bc-surface-map.sh map` emits both checks; gate + helper suites green; full suite green.
- Bounded batch; remaining KP journey (sign-in, plus/pay, badge/liveness) = clean follow-up.
