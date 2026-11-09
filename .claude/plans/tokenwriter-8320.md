# tokenwriter-8320: edit provenance for token-carrying (non-Claude) agents

Card: kosmos#8320 (child of #8298 item 4).

## Problem
The Codex, Gemini, Grok and Antigravity bridges already call POST /api/undo/keep before every edit, with the undo
switch on or off, and send their agent token on it (plus the board token unless KOSMOS_AGENT_TOKEN_ONLY=1). The route
records the writer through undo.agentFor(cwd, session), which knows only Claude transcript ids and the agent's own
folder. A non-Claude agent editing in a project folder matched neither, so nothing was recorded. The route's `only`
is null whenever the board token is valid, so the token never reached the record.

## Change
- engine/undo.js `tokenWriter(caller)`: the agent the caller's own token names, when Kosmos has a profile for it (its
  name, or its key while no second name holds tokens under that key). Null otherwise.
- server.js /api/undo/keep: the record asks tokenWriter(agentTokenCaller(req)) first, then agentFor as before.
- Copy path (undo.keep) unchanged.

## Tests
- server.tokenwriter-8320.test.js: bridge-shaped call names the token's agent (control: board token alone names
  nobody); token beats the folder lookup; a token for no profile names nobody; tokenWriter unit arms.
- server.filewho-5812.test.js review-1 case: xia's own token on wen's session is now recorded as xia (still never wen).
- 6 mutation arms, all red (scratchpad mut8320.py).

## Not in this slice
Meta (#7535) has no edit hook; later slice.
