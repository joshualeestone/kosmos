# The roster can hold an agent with no pane (#1112 phase 1)

**Branch:** `paneless-roster-1112`
**Card:** #1112, phase 1 of three. Addresses, does not close.
**Author:** Baron Draxum, 2026-08-27

## The problem

The board's idea of an agent is a tmux pane. `snapshot()` in `engine/status.js`
builds its list from `tmux list-panes -a`, so on a machine with no tmux there is
nothing to list, and every other question about an agent is downstream of that.

#1124 already built the identification half: `sendertoken.resolveName` reads a
token from disk with no roster involved, and `liveness` records that something
holding that credential was alive at a moment. `resolveAgentSender` in
`server.js` joins them, so a paneless agent can already speak.

It cannot yet APPEAR. The report it is now allowed to make lands on a board that
has no row to put it in.

## What finished looks like

The card's own done-condition: a paneless, token-identified agent appears on the
board and can report `blocked`, proven here against a fake agent. Additive by
construction, pinned in both directions.

## The shape

1. `sendertoken.keys()` exposes the store's existing reading of "which agents
   hold a token" for the whole set rather than one at a time. Held tokens only.
2. `snapshot()` adds a card for each such key that has no pane and a beat inside
   the liveness window. Merged in `snapshot()` and nowhere else, because
   `safeRoster()` is `snapshot()` plus a removal filter and the summary counts
   are computed over the same array. Two derivations of the fleet is this file's
   own worst habit.
3. `panelessCard()` shapes the row. Pane cards gain `paneless: false` so both
   kinds answer the question.

## The safety argument, which is the point of the change

- **A credential alone must not manufacture presence.** Both a held token and a
  fresh beat are required. A token on its own would keep a card for an agent
  that exited hours ago, the one failure a pane never had: a dead pane vanishes.
- **No Mac agent can reach this path.** `liveness.alive()` returns `null` for
  "no record" and `null` is not `true`.
- **The pane wins on a tie**, deduped on the safeKey'd name.
- **Revoking cuts it off**, because `keys()` lists held tokens only.
- **`target: null` is load-bearing.** No pane means nowhere to type.
  `chat.deliver`, `chat.screen` and `messages` all guard `if (!card.target)`, so
  a paneless card takes a refusal path that already exists. Null and never `''`:
  two routes match a reporting process with `c.target === body.from_pane` behind
  a `typeof ... === 'string'` gate, so `''` would be matched by `from_pane: ""`.

## What we do not know is null, not a default

No transcript here for a process on another machine, so no context and no model.
No launch record here, so `neverRecorded` is false rather than a true that would
say "made before Kosmos kept records" about an agent this Mac never made.

⚠️ **Flagged rather than decided:** `runner` is null because the token store does
not record one, and `web/index.html` reads a null runner as Anthropic. That is a
display fallback inherited, not a claim made, and what a Windows agent actually
runs is a phase 2 question.

## Testing

`engine/status.paneless-roster.test.js`, 8 tests, every arm with its opposite.
The three absences are each asserted against a Mac control on the same board, so
an absence cannot come from a board that was empty for an unrelated reason. The
count exclusion asserts the count fires at all before asserting it did not move.

Full suite at time of writing: 2560 passed, 0 failed.

## Out of scope

Phase 2 (the bind, remote token issuance) and phase 3 (the actual port) are not
touched. Nothing here opens the loopback bind, and that ordering is deliberate:
the roster must be able to list what the bind would let in.
