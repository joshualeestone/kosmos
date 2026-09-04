# Plan: refuse a create on a provider with no account signed in (#2145)

## Context
Surfaced while completing the OpenAI-only create-agent cluster (the "finding #3" residual
after #2097 shipped the provider-aware default). On a machine with a runnable runner but
ZERO accounts for the chosen provider, `createAgentInner` with no `accountDir` leaves
`configDir` null and CREATES on the empty default config — an agent that 401s on its first
call. This is the #1903 incident shape reached by a MISSING account rather than a dead one,
which #1903's liveness gate cannot see (there is no account to probe).

`accountConnectable` (the server-side gate the create route calls before `createAgent`)
returned `{ok:true}` for a missing account on the written-in-a-comment assumption that
`createAgentInner` would refuse it — but it does not. Proven with a sandbox repro; proven
reachable after #2097 (the wizard defaults to OpenAI, a user opens the provider menu, picks
Anthropic, and Creates with the account row empty).

## Change
`engine/create.js` `accountConnectable`, both provider arms symmetrically:
- a SPECIFIED-but-unknown dir still returns `{ok:true}` and delegates to `createAgentInner`
  (`REFUSE_ACCOUNT`) — the #1903/#1315 asymmetry preserved;
- a create with NO account chosen (dir null) AND no default account for that provider is
  refused with a "sign in from Settings" message, offering the other provider only when it
  is connected (the pill-door rule the runner refusal already follows);
- the openai arm additionally fails open under a CODEX_HOME override, because a created
  no-account default OpenAI agent runs on the real ~/.codex, which the managed home
  `openai.list()` reads says nothing about (mirrors the existing `codexHomeOverridden()`
  guard; the Claude arm has no analogue because only codex has the home split).
- Refuses only on a `list()` that RETURNED empty — a confirmed "no account", never the
  #1916 fail-open case.

Two server create-route suites gain a signed-in default Claude account fixture, because
their sandbox HOME is empty and the route now (correctly) refuses a create on a machine with
no account — a real machine that creates a Claude agent has one. The refusal lives in
`accountConnectable` (not `createAgentInner`) because the 158 createAgentInner unit tests
create Claude agents with empty sandbox accounts and would otherwise break; the server-side
gate is the right seam and its own comment already documented the (false) assumption.

## Verification
- `engine/create.no-account-2145.test.js`: 7 cases + a CONTROL; negative control confirmed
  the refusal cases red on origin/main while the delegation, present-account, and
  override-fail-open cases discriminate correctly.
- #1903 suite 14/14, base create suite 146/146, server suites 256/256 + 134/134, full suite
  green. Challenge-loop 2 iterations, converged.

## Decisions / rejected
- **Rejected: client-side gray-out of the Anthropic option** (finding #3's original
  suggestion): contradicts this file's documented philosophy (greying is reserved for
  coming-soon providers, not account state), only covers the wizard (not the API/imports),
  and Josh asked for the smart default (#2097), not a gray-out. An engine-side refusal is
  robust across all callers and precedented by #1903.
- **Weakest premise:** the refusal keys on "no DEFAULT account" for the no-dir case; a rare
  machine with only a labelled account and no default still correctly refuses (the agent
  would run on the empty default config) but the copy says "no account", slightly imprecise
  in that unusual config. Behavior is correct; left as a NIT.
