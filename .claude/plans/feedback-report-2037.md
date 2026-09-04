# Daily product-feedback report (kosmos#2037)

## What Josh asked for (verbatim, 2026-09-03)

An agent (probably the PM) writes and assembles a **daily report of product feedback** -
what didn't work + suggestions. Decentralized self-learning loop: a million users, a
million agents surfacing friction daily. A **default-checked** install checkbox, framed as
**"send", not "collect"** ("Allow an agent to send a daily note..."). **Store locally
regardless of the switch** - the switch governs transmission only. Anonymity needs a real
definition, not a word: findings name home-dir paths, project/repo/agent names.

## Decisions already made (do not re-litigate)

- **Placement A** (install wizard, "Create your first agent" step), copy decided:
  label "Make Kosmos work better for everyone.", subtext "Allow an agent to send a daily
  note with any system issues or improvements." (design LIVE at
  installkosmos.com/design/feedback-report).
- **Send, not collect.** The subject is the user's agent.
- **Store locally regardless of the switch.** The write is unconditional; the switch gates
  transmission only.
- **Scrub before send, or state plainly what leaves.** Never ship "anonymous" over
  un-scrubbed content (every real hand-written instance carried a home path).
- Bears on #2020 but does NOT settle it (that still needs Josh's own answer).

## Slices, in build order

- **Slice 1 (this branch): the always-on LOCAL report store.** `engine/feedback.js` -
  one markdown file per local day under `<dataRoot>/feedback/YYYY-MM-DD.md`, with a small
  frontmatter header (date, install id, generated_at). Unconditional write (no switch
  read), path-safe date, idempotent per day, read/readBody/list/has. **Reachable via a
  `/api/feedback` route** (GET list+read, POST write) so it is not a "complete, tested,
  unreachable" module (the exact #265 defect this repo's reachability test guards) - the
  agent writes via POST (agent-token auth), the UI/agent reads via GET.
- **Slice 2: the agent-authoring trigger.** A daily prompt/instruction to the PM agent to
  write the report (the "assembles" half). Likely a `kosmos feedback` CLI verb agents call,
  plus the once-a-day cadence.
- **Slice 3: the SEND layer (the sensitive one).** A scrub pass (home paths, names) + a
  gated seam modeled on ping.js/notify.js, transmitting only when the opt-in is on. This
  is where "anonymous" must be earned. Define exactly what leaves before writing it.
- **Slice 4: the opt-in switch + install wiring.** The default-on setting (read/written
  like notify's {on}) and the Placement-A checkbox (design decided) wired into the wizard,
  with the could-not-read privacy treatment (#2037 comment, 2026-09-03 17:27).

## Slice-1 scope + rejected

- **In:** `engine/feedback.js` (store) + `engine/feedback.test.js` + `/api/feedback`
  GET/POST route + route auth (agent-token/board-nonce, matching the sibling write routes).
- **Rejected: land the store module alone.** The reachability test passes on it only
  because `write`/`read`/`list` collide with common words elsewhere (the known name-collision
  blind spot); the module would still be genuinely unreachable. A first slice must stand on
  its own, so it carries a real caller.
- **Rejected: build the send/scrub path now.** It is the sensitive half (privacy, what
  leaves the machine) and deserves its own focused slice with the scrub definition settled
  first. Slice 1 deliberately touches nothing that transmits.
- **Weakest premise:** that the agent authors via the board API (POST) rather than the CLI.
  Both are valid write paths; POST is the one server.js can expose + test now, and the CLI
  verb (slice 2) can call the same module. If Josh/Splinter prefer CLI-only authoring, the
  POST route still serves the UI-read and an agent-token write, so it is not wasted.

## Verification

- `engine/feedback.test.js`: 12 arms (round-trip, always-on write with no other state,
  frontmatter, readBody strips it, idempotent replace, list newest-first, has, null-on-
  missing, local date key, path-traversal refused, default-today). All pass.
- Route tests added with the route.
- Full `node --test` engine suite + test:shell via the challenge-loop validation.
