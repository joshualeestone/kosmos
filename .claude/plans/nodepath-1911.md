# nodepath-1911 - shell wrappers resolve node explicitly, never bare (#1911)

## The class (not two bugs)
A Kosmos-only host has no Homebrew: node/tmux exist ONLY in the Kosmos bundle, and the
launchd PATH is just /usr/bin:/bin:/usr/sbin:/sbin. The discriminator (from the card):
Kosmos's JS already resolves these explicitly in ~5 engine modules; the lapse is in
SHELL WRAPPERS. A bounded sweep of shell wrappers is finishable; "audit all tooling" is
not.

## State when picked up (measured, not assumed)
- Manifestation 1 (#1897, agent-supervisor.sh mint): already FIXED (bundled node from
  $_eng). #1897 is CLOSED.
- Manifestation 2 (slack-relay-start.sh): not in agent-workforce (cross-machine relay,
  fixed via the launchd plist EnvironmentVariables per the card).
- NEW miss found on measure: agent-supervisor.sh's codex-dismiss shim used a BARE `node`
  ("node \"$DISMISS\" ... || true") while the mint carefully resolved the bundled node.
  On a Kosmos-only host that bare call silently no-ops and a codex agent hits the update
  prompt the shim exists to dismiss.

## Fix (this repo)
Resolve node ONCE into NODE_BIN right after $_eng (bundled `$_eng/../../runtime/bin/node`
if present, else PATH node, each tested -x), and use it at BOTH call-sites - the mint and
the dismiss. The shared resolver Splinter named: one resolution, both callers, so the
next shell wrapper cannot repeat it. Preserves #1897 (the mint still needs $_eng+node;
no engine -> no token, the control the test asserts).

## Tests
tools/test-supervisor-env.sh: existing #1897 launchd-PATH+bundled-node arm still mints
(guards the mint refactor); NEW #1911 arm - RUNNER=codex + bundled node + PATH stripped +
a marker-writing dismiss stub asserts the shim RAN via the resolved node (fails on the old
bare-node line).

## Not in this repo / follow-up
The runbook line the card asks for lives in docs/onboard-orchestrator-slack.md, which is in
**claude-setup**, not agent-workforce - a separate small doc PR (the cross-machine relay's
onboarding). The relay-side fix already shipped via the plist.

## Weakest premise
NODE_BIN is resolved in the mint block and reused at the dismiss (same `if [ -z "$adopt" ]`
scope, verified). If a future refactor moves the dismiss out of that scope, NODE_BIN would
be unset there; the `[ -n "${NODE_BIN:-}" ]` guard degrades to the prior best-effort skip
rather than erroring. Real-Mac behavior (registry, launchd PATH) is exercised by the
PATH-stripped test arm, not just a dev box.
