# config-sandbox-negctl-1143 (kosmos#1143)

## Problem
Card #1143: "The config-root sandbox misses direct invocations, and the accounts
mechanism is unscoped." Its done-condition item 3 asks for a control proving the
sandbox can fail: seed a fake config root and assert the check sees THAT account
and not the operator's.

## Liveness measurement (a card is a snapshot)
Measured on origin/main before building. The card's other two concerns are
already closed since it was filed:
- The accounts board (tools/browser-checks.sh sb4) is booted with
  `AGENT_WORKFORCE_HOME="$sb4/home"` and seeds two fixture accounts
  (main@example.com, walk@example.com). HOME is a valid sandbox seam
  (engine/status.js honours it), so the check reads fixtures, not the operator.
- engine/status.js `sandboxIsInconsistent()` (#1500) is a runtime backstop:
  any process that declares itself a fixture (DATA under a temp root) but has a
  real HOME gets an empty config root, not the operator's machine.
- Zero junk /tmp kosmos-* entries exist (the "~15 junk entries" are gone).

What remained genuinely unmet: item 3. Every accounts-list assertion in
render-accounts-openai.js was OPEN-WORLD (`some` group is OpenAI, both seeded
Claude rows present), so a regressed sandbox that leaked the operator's real
Claude accounts as EXTRA rows would pass all of them silently. The runtime
backstop cannot catch this (it can only fire for a fixture, never distinguish a
real production board), so the read must be caught at the check whose subject is
the accounts list.

## Change
Add two retry-safe negative controls to
docs/browser-checks/render-accounts-openai.js, right after the account groups
are read:
1. no email outside the seeded example.com domain renders (a real operator
   account carries a real domain: this is item 3's "not the operator's").
2. the non-OpenAI group holds exactly the two seeded Claude accounts (catches a
   leaked account that carries no oauthAccount email, which the domain line
   would miss).

Both key on the Claude side, which the walk never adds to, so the flaky-retry's
second OpenAI add cannot make them false. Also makes a DIRECT invocation against
a real board fail loud instead of asserting green against the operator's data.

## Verification
- render-accounts-openai runs green with both controls: no foreign email, Claude
  group exactly the two fixtures.
- Proven the control CAN fail: temporarily seeding a `.claude-operatorleak`
  account (josh@book.io) into the sandbox home made both controls RED
  (`["josh@book.io"]` caught; a third Claude row detected), exit 1, on both
  attempts. Perturbation reverted.

## Weakest premise
That an operator leak worth catching arrives as an account carrying an
oauthAccount email (the realistic case: ~/.claude and ~/.claude-account-* on
this fleet all carry one). A leaked dir with NO account record would evade the
domain line; the count control is the backstop for that, but a leak that both
lacks an email AND lands only in the OpenAI group would evade both. Not
reachable today (leaked Claude dirs land in the Claude group).

What would change my mind: a measured leak shape that lands outside the Claude
group, or a decision that the broader authoring-time lint (option 3's lint arm)
is wanted despite every current harness already holding the seam.
