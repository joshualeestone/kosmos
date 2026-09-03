# import-msg-1939 — name the wrong KIND of file, not a missing field

## Problem (kosmos#1939)
Import (`agentfile.js:203`) rejects any headerless file with *"this is not a Kosmos
agent file: it has no header."* A `CLAUDE.md` is agent instructions, not a Kosmos
**export**, so it can never pass — but the message names a missing FIELD, which reads as
*"my file is right, something is wrong with it"* and invites a retry. A real user
(Josh, fresh install, 2026-09-03) pressed "Bring it in" on his agent's `CLAUDE.md`
repeatedly because the message never told him it was the wrong KIND of file.

Pairs with #1938 (the disk scan): adoption declines to offer a not-yet-discovered agent,
and import declines to accept its `CLAUDE.md`. Between them a new user with an agent that
already exists on the machine has no route.

## Fix (engine-only; the frontend already shows `because` verbatim)
`engine/agentfile.js`, at the `!m` (no-frontmatter) branch:
- Detect the near-miss with a local `INTRODUCES` regex mirroring `discover.js`
  (`/^[ \t]*(?:#+[ \t]*)?You are\s/mi`). It deliberately does NOT require a readable
  name — the plain `You are lilnacho` form names nobody to `identityFromText` yet is
  plainly instructions, and that is exactly the file this is for (card #3).
- When it matches, return a distinct message naming the wrong KIND of file and where the
  right one comes from: *"this looks like an agent's instructions (a CLAUDE.md), not a
  Kosmos agent file. A Kosmos agent file is one you export from another Kosmos install…"*
- A file that does NOT introduce an agent still gets the generic "no header" message, so
  the two are distinguishable (card #4).
- Still `ok:false` — a REDIRECT, never accept-anyway. Import is a **trust boundary** (a
  browsed-to file's provenance is unknown: download, email, anything); the disk scan
  (#1938) is not (the file is already on the machine, in a location we chose to look in).
  Accept-anyway would move a trust decision onto the riskier surface.

⚠️ **No pointer to the disk scan yet.** The route that would let a person add an
on-machine agent by finding it is #1938 and is not built, so this copy must not send them
somewhere that does not exist. When #1938 lands, this message should point at the scan.
(This is the #1938-dependent copy enhancement Splinter and I agreed to note here rather
than ship early.)

## Tests (each refusal paired with a control that can pass — the file's own discipline)
`engine/agentfile.import.test.js`:
- A `CLAUDE.md` that introduces an agent → message names the kind + says "export", NOT
  "no header"; control: a random document still gets "no header"; the two differ. Proven
  to red when `INTRODUCES` is neutralised.
- The plain `You are lilnacho` form (identityFromText returns null) still gets the
  redirect — near-miss detection reads INTRODUCES, not a readable name.
- Existing "#1652 … no header" test still passes (its fixture is a real document).

## Definition of done
- `node --test` green.
- The message reaches the user unchanged: server `/api/agent-import` returns
  `because: parsed.because` (server.js:5303) and the import UI renders `data.because`
  (web/index.html importMsg) — verified by reading both; no frontend change.
