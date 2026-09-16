# #3034 - default Kosmos setup-assistant agent (auto-created on first-run)

Branch: `setup-assistant-3034` * card: joshualeestone/kosmos#3034 * handed cross-lane by Splinter as the queue-dry fill, with a CONSERVATIVE/minimal/reversible mandate (first-run-visible, investor-scrutiny neighborhood).

## What Josh wants (and what he already resolved)
Auto-create a default "Kosmos setup assistant" agent when a new user finishes
onboarding (hits "Giddy Up"), pre-existing on their Agents screen, named after the
user with the user's avatar, a distinct helper role, pre-loaded with setup
guidance. In the card's own comment Josh RESOLVED the open questions: it is a
**LIVE** agent running on **one of the user's own models**, and **burning their
quota is explicitly acceptable** ("they're giving us access to one of their
models"). So there is no money carve-out to protect - Josh ruled it fine.

Help-"bubble" (bottom-right persistent chat) is explicitly **phase 2, parked** -
NOT built here.

## Design (mine, per Josh's make-your-best-call ruling; every call reversible + documented)
- **Seam:** the server-side `POST /api/first-run/complete` `if (ok)` block, right
  after the existing welcome-home seed. That block is already the idempotent,
  best-effort, once-ever, swallow-all home (a seed failure "must not turn a done
  onboarding into an error"). Server-side (not client) so it runs regardless of
  which onboarding exit was taken.
- **New module `engine/setup-assistant.js`** with an injectable `createAgent` so
  the logic is unit-testable without launching a real agent. Owns a once-ever
  flag (`store.ROOT/setup-assistant.json`), mirroring projects.js welcome-seed.
- **New role `setup`** in engine/roles.js, `menu: false` (like `own`) so it is
  NEVER offered in the normal create flow. Brief = a concise, accurate Kosmos
  setup guide; it explicitly tells the assistant NOT to invent buttons/screens it
  is unsure of (kosmos#120 discipline on first-run-visible copy).
- **Name = the user's own name** (Josh: "we would name it My Name (Josh)"). If
  the About-you step was skipped so there is no saved name, SKIP the assistant
  rather than invent one.
- **Avatar = the user's picture**, copied onto the agent best-effort
  (`you.picturePath()` -> `store.saveAvatar`). No picture -> default initials
  avatar. Never fatal.
- **Model/account = the user's default connected account** (createAgent with no
  model/account). Josh: their own model, quota-burn accepted.

## Fragilities handled (from the terrain map)
- **No account connected at Giddy-Up** (the wizard's model step is skippable): a
  live agent cannot run without one. CORRECTION caught by blind review: I first
  believed `createAgent` would REFUSE in this case -- it does not. createAgent's
  account/model refusal only fires for an explicitly-passed unknown account (we
  pass none); its own refusal is keyed on the RUNNER BINARY (Claude Code) being
  installed. With Claude Code installed but no account connected, createAgent
  would SUCCEED and launch a KeepAlive (ThrottleInterval 30) agent that then
  loops on auth failure. So we now GATE the seed on a connected Claude account
  (`accounts.list()`, a fast config read, NOT the slow live probe) and seed
  nothing when there is none -- no flag, no churn, onboarding unaffected.
  LIMITATION (documented): a user who skipped account connection, or connected
  only OpenAI (we default to the Claude provider), gets no assistant in v1.
  Follow-up: seed on the connected provider, or on first account-connect.
- **Must not block onboarding:** the whole hook is in the existing swallow-all
  `if (ok)` block; the module never throws (createAgent-throws is caught too).
- **Idempotency:** once-ever flag, written only after a real create, so a repeat
  completion POST or a refusal never double-creates.
- **No agent-count limit exists** (verified); the assistant increments the
  telemetry `createdCount` beacon like any agent, which is fine.

## Two decisions a reviewer will (rightly) probe
1. **Synchronous create latency.** The seed runs synchronously in the completion
   handler before the response, matching the existing welcome seed. `createAgent`
   here does the FAST runner-runnable check + launchctl bootstrap (~1s), NOT the
   slower live `claude -p` auth probe (that probe lives in the /api/create ROUTE,
   not in createAgent). So Giddy-Up gains ~1s once, at a one-time action. Kept
   synchronous for clean flag/failure semantics; if the latency proves bad,
   moving the seed to after sendJson (fire-and-forget) is the follow-up.
2. **Account gate is the fast config check, not the route's live-auth probe.**
   We gate on `accounts.list()` (connected-account config read), not the slow
   live `claude -p` probe the /api/create route uses. So an installed-but-EXPIRED
   token could still slip through (config says connected, the token is dead) and
   create an assistant whose live turns then fail auth -- the board surfaces that
   as auth_failed, recoverable by reconnecting, and it is a reasonable nudge from
   a setup helper. Adding the live probe would reintroduce multi-second latency at
   Giddy-Up; not worth it for a minimal helper. The common no-account case is
   fully handled by the fast gate; only the rarer expired-token case degrades to
   auth_failed. AND that case is near-impossible at the seed's ONLY trigger point:
   this fires at first-run completion, minutes after the account was connected
   during onboarding, so a token present-in-config is overwhelmingly live right
   then. Config-presence ~= liveness at first-run, which is why the fast gate is
   the right call here rather than a general liveness probe. Documented.

## Reversibility
Fully additive: a normal deletable agent, one flag file, one menu:false role. The
user can delete the assistant like any agent; nothing here is irreversible.

## Verification
- `engine.setup-assistant-3034.test.js` (new, 8 tests): role exists + menu:false +
  excluded from the create menu; POSITIVE create (named after user, role setup);
  and biting CONTROLS - no user name (no create), no model / createAgent REFUSES
  (no seed, no flag), createAgent throws (swallowed), once-ever guard (no double
  create), avatar copied / absent both handled.
- 476 role/first-run-adjacent tests (roles, server, role-picker, win-cli-parity,
  server.projects) pass unchanged.
- Full validation suite via the challenge-loop 6.0 gate.
