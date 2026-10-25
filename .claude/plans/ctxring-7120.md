# ctxring-7120: the context ring in the native Agents list (#7120, gap in #6838)

## Finished looks like
On main, each agent in the iPhone Agents list wears the board's context ring round its avatar (lrowRing): a track and
an arc of the percent from 12 o'clock, green under 60, amber from 60, red from 80 (the board's WARM and NEARLY_FULL),
nothing when the percent is unknown; VoiceOver hears "memory N%" or "memory Full" in the row's label. LogicTests cover
the parse, the bands and the words with a broken-copy control; shots in light and dark.

## The board (web/index.html, main)
- pctOf(ctx): ctx.percent when Number.isFinite, else null. memBand: >= 80 high, >= 60 warn, else ok, null for null.
- lrowRing: viewBox 34, r 15.5, stroke 2.5, aria-hidden; .gf ok #2f7d5a, warn #d97528 (5 on the big gauge), high
  #b3261e (dark #ff8c82); .gt track rgba(20,22,26,.10) (dark rgba(245,245,244,.14)).
- memPrint: "Full" when context.overCeiling === true, else pct + "%".

## Build
1. BoardLogic: Agent.contextPercent and contextFull from /api/status's context; Board.contextPercent (finite numbers,
   never a boolean), isRealTrue (a JSON true, never a 1), MemBand, memBand, memoryWords.
2. AgentsView: AgentAvatar takes an optional memoryPercent (default nil, so Today, Projects and the room are unchanged)
   and draws the ring outside the picture; AgentRow passes it and adds the words to its label; Palette ring colours.
3. Sample data (DEBUG): four sample agents carry a context percent across the bands.

## Decided, not missed
- Agents list only. Today, the Projects members and the room avatars share AgentAvatar but are left without the ring
  here (the parameter defaults to nil); each can opt in later.
- The board's list ring is aria-hidden and says nothing; the phone's row label adds "memory N%" so a VoiceOver user is
  not left without what the ring shows. Weakest premise: the board's word is "Memory", which the phone keeps.
- One stroke weight (2.5) in every band, as the board's small rings keep (it sets .lring .gf.warn/.high back to 2.5;
  the thicker 5 and 6 are its big gauge's).
- A list that is not updating draws the arc in Palette.secondary, the colour its words take then (opaque: a
  translucent quiet arc blended into the track in dark, seen in the shots).
- The percent is held to 0...100 on reading (the engine caps it there).
- In a list that is not updating, VoiceOver still hears "memory N%", followed in the same label by "not updating", as
  the row's word is; the arc is drawn quiet.
- Shots at the default size and at the largest accessibility size (AX5) in ~/work/design-shots/kosmos-7120/.
- The not-updating list's quiet arcs are in the shots (agents-stale-light/dark, KOSMOS_SAMPLE_STALE=1, Debug only):
  the arc still reads as a gauge over the fainter track.
- Parity left as is: the status dot sits over the ring as on the board's list; at exactly 0% the phone draws the
  bare track where the board's round cap draws a dot.
- Proportions follow the board's list-row ring on the computer (lrowRing in the consolidated rail: a 2.5 stroke a
  little outside the picture); the phone web board draws a heavier ring with a wider gap round a bigger face. The
  native row keeps its 40 pt avatar, so the lighter ring fits it.
