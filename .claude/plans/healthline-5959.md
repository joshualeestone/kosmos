# healthline-5959: one health line on the agent's page (#5959 slice 2)

Card: joshualeestone/kosmos#5959, item 2 of the Windows agents' QA report: "One Agent health line on each card:
signed in or not, quota, last successful turn time."

## The call
- **Engine.** `engine/observed.js` keeps the newest OK per (provider, agent) in its own map (`lastOk`), so a later
  rejection, which overwrites the latest reading, does not erase when the agent last worked; an older OK read late
  never moves it backwards. Every pane card of ours carries `lastWorked` (`status.js lastWorkedOf`):
  `{ at: ISO, why: null }` when seen, `{ at: null, why: 'not_seen' }` when its runner is observed but nothing was seen
  since the board started, `{ at: null, why: 'no_source' }` for Antigravity and Muse (no observation exists).
  Null for a pane that is not ours and for a paneless card.
- **Page.** `healthLine(a, now)` builds "Sign-in: ... · Usage: ... · Last worked: ..." and paints `#d-health` under
  Runs on, in the agent page's AI Settings section, repainted with the page so one agent's line never stands on
  another's. Sign-in and usage say only what the card's state shows ("no problem seen" / "no limit seen" otherwise).

## Rejected
- **On the board card itself.** #855 (Josh) cut the card's extra lines, and a sign-in or usage problem already shows
  as the card's state. The new fact (last worked) goes beside the model and account it is about.
- **"Signed in" as a positive claim.** Kosmos cannot see a working sign-in without a turn; "no problem seen" is all it
  can honestly say.
- **Reading `observed.read()`'s latest outcome as last-good.** A rejection overwrites it, which loses the time.

## Weakest premises
- The Claude arm records an OK on every tick a pane reads WORKING (streaming), so for Claude "last worked" is the
  last time Kosmos saw it streaming, not the end of a completed turn. Codex/Gemini/Grok record the completion time,
  and only when that completion was fresh at a sweep, so a turn that ended before the board started is not seen.
- In memory: after a board restart every agent reads "not seen since Kosmos started" until its next turn.
- "At a glance" in the ask may mean the board card; if so, the line is one call away (`healthLine` is pure).

## Tests
- `engine/lastworked-5959.test.js`: lastOk survives a rejection and never moves backwards; per-runner card values,
  including a decoy Claude observation filed under a Gemini agent's name, and a stranger's pane.
- `web.healthline-5959.test.js`: the line's words for each case; no line without lastWorked; the paint is wired.
- `docs/browser-checks/render-health-line-5959.js`: three agents' pages on a real board; negative control (paint
  removed) fails all three arms.
- Mutations checked red: the never-backwards guard, the OK-only guard, a provider-blind read, the paint.
