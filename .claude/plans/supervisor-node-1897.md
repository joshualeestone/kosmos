# Plan: supervisor-node-1897 -- fix the supervisor's node resolution (#1897)

## Problem

On an installed Kosmos, `bin/agent-supervisor.sh` never mints `KOSMOS_AGENT_TOKEN`,
so no agent ever receives a sender token on any launch. The empty token store is
the steady state, not a first-run artifact. Confirmed present in the shipped
0.6.21/0.6.22 artifact on a machine running a real install; invisible on this
build host by construction (no installed supervisor here, and a checkout mints
via the PATH node).

## Root cause

This is kosmos#1139 one variable over. #1139 taught the supervisor where the
ENGINE lives via an `engine-path` pointer file that resolves in the installed
layout. The NODE path in the same mint block was left derived the old broken way:

- `_app="$(cd "$(dirname "$0")/.." && pwd)"` is SUPPORT_DIR for every real agent
  (the supervisor is installed to `SUPPORT_DIR/bin`), so the first node candidate
  `"$_app/../runtime/bin/node"` resolved to `~/Library/Application Support/runtime/bin/node`,
  which does not exist.
- The agent's launchd PATH is only `/usr/bin:/bin:/usr/sbin:/sbin` and carries no
  node, so the second candidate `command -v node` was also empty.
- Both candidates empty => the mint loop finds nothing executable => `mint` never
  runs => token silently absent (the mint is deliberately best-effort: "a missing
  token costs attribution; a broken launch costs the fleet").

## Fix (one line)

Derive node from `$_eng` -- the engine directory the pointer already resolves
correctly (`KOSMOS_HOME/app/engine`) -- as `"$_eng/../../runtime/bin/node"`.
`install/setup.sh` lays `runtime` beside `app` (`for part in bin app runtime`),
so this is correct in the installed layout AND in the bundle
(`app/engine/../../runtime == bundle/runtime`). A source checkout has no sibling
runtime and still falls through to the PATH node.

`$_eng` is guaranteed non-empty at the point the node loop uses it (the `for _n`
loop is inside `if [ -n "$_eng" ]`).

## Test

Add an SB3 arm to `tools/test-supervisor-env.sh` that reproduces production:
`engine-path` resolves, the bundled node sits beside `app` the way the installer
lays it out, and PATH is stripped to the launchd set with no node on it. The
existing #1139 arm passed only because `command -v node` found node on the TEST's
PATH -- the one fallback a real agent lacks. The new arm mints via a stub
`sendertoken.js` returning a fixed hex token, so it proves node resolution WITHOUT
minting a real credential. Two-sided control: NO TOKEN on the old `$_app`
supervisor, TOKEN MINTED on the fixed one, both reaching `new-session` so the arm
isolates node resolution alone.

## Scope

Bare-name binary resolution lapses in exactly two shell wrappers: this one, and
`scripts/slack-relay-start.sh` (already fixed via plist). The JavaScript resolves
tmux explicitly across five engine modules. Tracked as the class in kosmos#1911.
This change scopes to the one wrapper.

## Verification

Only a machine running an installed Kosmos can verify the remedy. Routed to the
second Mac (via Splinter) once merged and served: token store zero before, a
token present after an agent launch.
