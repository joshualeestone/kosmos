# healthline-5959: one health line on the agent's page (#5959 slice 2)

Card: joshualeestone/kosmos#5959, item 2 of the Windows agents' QA report: "One Agent health line on each card:
signed in or not, quota, last successful turn time."

## The call
"Last seen working" is weaker than the card's "last successful turn time": for Claude it is the last sweep that read
the pane working (a short turn between sweeps is not seen); for Codex, Gemini and Grok it is a finished turn's time.
- **Engine.** `engine/observed.js` keeps the newest OK per (provider, agent) in its own map (`lastOk`), so a later
  rejection, which overwrites the latest reading, does not erase when the agent last worked; an older OK read late
  never moves it backwards. Every pane card of ours carries `lastWorked` (`status.js lastWorkedOf`), read under the
  provider the observation arms filed it under (`observedProviderOf`, from the same `paneObservedKinds` the arms use):
  `{ at: ISO, why: null }` when seen, `{ at: null, why: 'not_seen' }` when its runner is observed but nothing was seen
  since the board started, `{ at: null, why: 'no_source' }` for Antigravity and Muse (no observation exists).
  Null for a pane that is not ours and for a paneless card.
- **Page.** `healthLine(a, now)` builds "Sign-in: ... · Usage: ... · Last seen working: <clock time>" and paints
  `#d-health` under Runs on, in the agent page's AI Settings section, from `paintDetailState`, which the page's open and
  its poll both call, so the line follows the state pill. Sign-in and usage say only
  what the card's state shows ("no problem showing" / "no limit showing" otherwise), hedged with "looks like" for a
  screen reading as the state sentence is (#215). A problem the state shows is always said; "no problem" only for an
  agent Kosmos has seen work within the last hour, in a state it reads, and for sign-in only on Claude (`runner ===
  'claude'`): a Codex 401 loop reads as working
  and the other runners' sign-in report is written by the Windows supervisor alone; usage "no limit" only for Claude,
  Codex and Gemini, whose limits the board reads (nothing reads a Grok limit yet), and not beside a refused sign-in. A clock time, not "N minutes ago",
  which would age between polls.

## Rejected
- **On the board card itself.** #855 (Josh) cut the card's extra lines, and a sign-in or usage problem already shows
  as the card's state. The new fact (last worked) goes beside the model and account it is about.
- **"Signed in" as a positive claim.** Kosmos cannot see a working sign-in without a turn; "no problem seen" is all it
  can honestly say.
- **Reading `observed.read()`'s latest outcome as last-good.** A rejection overwrites it, which loses the time.
- **Reading the per-agent REJECTED reading for the sign-in segment.** For Claude it is recorded only while the card
  itself reads auth_failed, so it adds nothing the state does not; the other runners record no rejection at all.
- **"Last worked".** For Claude the measure is "seen streaming", not a finished turn, so the page says
  "Last seen working".

## Weakest premises
- The Claude arm records an OK on every tick a pane reads WORKING (streaming), so for Claude "last worked" is the
  last time Kosmos saw it streaming, not the end of a completed turn. Codex/Gemini/Grok record the completion time,
  and only when that completion was fresh at a sweep, so a turn that ended before the board started is not seen.
- A Claude pane in its retry loop: a rate limit or a rejected sign-in classifies as such before working chrome, so it
  records no OK. A network retry does not: Claude Code draws working chrome while it retries (status.js STATE
  comment), so the pane reads working and records OKs until the retries run out and it reads connection_lost. In that
  window the line says it was seen working; sign-in and usage are not what is failing there.
- Stopped, restarting, unknown, blocked or connection-lost agents show only the time (connection lost: "no problem
  showing" beside it would read as a clean bill of health). Blocked because a Claude card stays blocked on
  Claude Code's own report of a refused sign-in or a usage cap, where "no problem showing" would be false.
- Windows: a Codex agent there is read through its rollout like any Codex agent. Whether the rollout is found on
  Windows is reasoned from source, not measured; if it is not, the line says "not seen since Kosmos started" where
  "cannot see" would be truer. Windows changes go to Homer.
- The account's own Check-now verdict (Settings, AI Models) is not read here: it is about the account, which may serve
  several agents, and it has its own row. A follow-up could name it on this line.
- A removed agent, or one created under an old name, forgets the name's last-seen time (`observed.forgetAgent`, called
  beside `crashloop.forget` in create, remove and delete-leftover), and so does a provider or account switch, which keeps the name (before and after its restart).
- The time is in the viewer's clock and zone: in a Kosmos+ view of another computer, the viewer's own. Skew between the
  two computers' clocks moves the hour bound and the today/weekday choice by that much.
- In memory: after a board restart every agent reads "Last seen working: not seen since Kosmos started" until its next turn.
- "At a glance" in the ask may mean the board card; if so, the line is one call away (`healthLine` is pure).

## Tests
- `engine/lastworked-5959.test.js`: lastOk survives a rejection and never moves backwards; per-runner card values,
  including a decoy Claude observation filed under a Gemini agent's name, and a stranger's pane.
- `web.healthline-5959.test.js`: the line's words for each case; no line without lastWorked; the paint is wired.
- `docs/browser-checks/render-health-line-5959.js`: three agents' pages on a real board; negative control (paint
  removed) fails all three arms.
- Mutations checked red: the never-backwards guard, the OK-only guard, a provider-blind read, the paint.
