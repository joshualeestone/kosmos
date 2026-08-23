# remote-tunnel: the engine side of "Use Kosmos from anywhere"

The relay half of the remote-access plan (Josh-Brain, kosmos-remote-access-
and-push-plan-2026-08-23) is built and working in the kosmos-relay repo:
relay, coordinator, tunnel binary, live end to end tonight. The plan says
agent-workforce receives exactly one thing from that team, as a PR: the
Mac-side client's engine seam. This branch is that PR.

## What finished looks like

engine/remote.js supervises one kosmos-tunnel child and is the only thing
in the app that ever starts it:

- Off by default; the Settings switch is the only starter, same rule as
  ping and notify.
- Enrolment (email in, code in, state dir out) shells out to the binary's
  setup subcommands. No crypto in the app: keypair, pin and CSR live in
  the binary, tested against the coordinator's signed contracts in its
  own repo.
- Status is a closed list (off, connecting, up with the address,
  restarting) and every not-up state carries a because sentence a person
  reads next to the switch. Unknown never renders as fine: the binary
  writes a status file atomically on every state change, and a missing or
  dead-pid file is a process problem said in words, not a shrug.
- The child dies with the board (exit and SIGTERM/SIGINT reaps), restarts
  with backoff after a crash, and a SIGKILLed board's orphan is displaced
  at the relay by its replacement (newest connection wins), so no #156
  shape survives.
- Env seams for everything a test needs to fake: the binary, the relay
  address, the coordinator URL, the state dir, the extra CA. The suite
  runs a fake binary through every path and never reaches a network.
- No baked-in relay address: the domain is Josh's open decision, and a
  wrong default would be an outbound call nobody chose. Until it is set
  (env or stored setting), the state is off with the reason in words.

## What this PR does not do

The Settings surface (the switch, the address line, the standing
sentence) is the Kosmos team's per the plan, so no web/ or server.js
changes here. The module's exports (read, setOn, setRelay, status,
setupStart, setupComplete, ensure) are the seam that surface drives.
Standing receipts and the lapsed-account sentence arrive with the
coordinator's paywall work, which Josh sequenced last.

## Tests

engine/remote.test.js, sandboxed data root, fake binary through the env
seam: off-by-default spawns nothing; on-but-not-enrolled says why; the
email and code steps drive the right argv and surface the binary's last
sentence on failure; a completed enrolment brings the tunnel up with the
address; the switch off kills the child; a crashing child renders
restarting with a because, never fine; enrolled with no relay configured
refuses to spawn and says why.

## Review bound

Two rounds maximum: one new engine module plus its test file, no other
file touched. The risks to hunt are process lifetime (orphans, ghost
restarts after an intentional stop) and any path where a failure could
render as fine.
