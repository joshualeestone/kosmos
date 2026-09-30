# codexhooksui-4607: the person answers Codex's "Hooks need review" from the board

Card: kosmos#4607 (follow-up to #4589, merged as PR #4689). Josh does not use a terminal.

## Done looks like
With untrusted hooks present, the person answers the dialog from the agent page (Continue without them, or Trust all
of them), no terminal, and the dialog leaves its screen. The same answer attempted with an agent token, or through
any message path (chat, `kosmos msg`, a room post, a task line), is refused (tested both ways). A stale button (the
dialog gone or changed) presses nothing. NOT claimed: that no local agent can ever reach the route (see Residual).

## Keys (measured 2026-09-30 on a live pane, Codex 0.149.1, an isolated CODEX_HOME, a scratch project with one
## `true` Stop hook and one `true` SubagentStop hook; every key sent only after its screen's footer was on screen)
- MENU (footer "Press enter to confirm or esc to go back"): `2` = Trust all and continue, acts at once (no Enter),
  lands on the prompt, and writes `[hooks.state."<file>:<event>:0:0"] trusted_hash` per hook into CODEX_HOME's
  config.toml. `3` = Continue without trusting, lands on the prompt, config unchanged. `1` opens the TABLE.
- TABLE (footer "Press t to trust all; enter to review hooks; esc to close"): `t` trusts every hook (both hashes
  written) and STAYS on the table with a new footer "Press enter to view hooks; esc to close"; Esc from there lands
  on the prompt. Esc from the table before trusting lands on the prompt with nothing trusted. Enter opens a HOOK.
- HOOK (footer "Press t to trust; esc to go back"): Esc returns to the TABLE.
- A key sent the instant a screen draws is dropped (measured twice: a `2` before the menu drew, a `t` as the table
  drew). So each step re-reads, lets the screen settle, and confirms the expected screen before the next key.
- Real ~/.codex is shared by every Codex agent on a box: trusting writes there, which is why the route is for the
  person (within the limits stated under Residual).

## Design (as said on the card at 13:10, with the measured keys)
- engine/chat.js `answerCodexHooks(session, choice, roster)`, choice `trust` | `skip` | `close` (the open list only), following
  `answerGeminiQuotaStop`: a fresh `status.capturePane` read immediately before each key; act only on a screen
  `status.codexHookReview` recognises; then confirm the screen changed as measured.
  - trust: MENU -> the digit beside "Trust all and continue". TABLE -> `t`, confirm the "view hooks" footer, then Esc.
    HOOK -> Esc to TABLE, then as TABLE.
  - skip: MENU -> the digit beside "Continue without trusting". TABLE -> Esc. HOOK -> Esc to TABLE, then Esc.
  - Round 1: menu digits are read from the option text on the same read that precedes the key (a reordered menu got
    Trust for Continue before); a missing option presses nothing. One answer per agent at a time (two surfaces
    answering at once typed the second key into the composer). The trusted-but-open list (a dropped Escape after `t`)
    reads as needs-you, is refused by #4589's message floor, and takes only Close (Escape).
  - Done when the dialog is gone from a fresh read; otherwise it says what it saw and stops (no retry loop).
  - These keys bypass #4589's refusal only inside this function; the message path's floor is unchanged.
- Route `POST /api/agent/<name>/codex-hooks { choice }`: the person's board credential only (as #2808's grant),
  refused for an agent token. No chat, msg, post or task path reaches it.
- Page (the agent page's needs-you box, where the folder-trust recovery lives): the label, a summary of only what the
  screen said (count, events, source) plus "Trusting covers every hook Codex lists", and two buttons: Continue without
  them (the main one, the safe choice) and Trust all of them. The open list shows only Close the list. "Done" says what
  was seen (its screen stopped asking), not what Codex does next.

## Residual (review round 1, stated rather than overclaimed)
The route refuses an agent token and a caller with no browser headers, and it is not an agent-token route. That is
advisory: a local process with the board token can send browser headers, and an agent's own CLI can read the board
token until #4491 lands. An unsandboxed agent gains nothing by it (it could write ~/.codex/config.toml [hooks.state]
itself). A sandboxed agent that can read the token and reach the board but not write outside its folder would gain
it; Codex's default sandbox denies network, so that needs a loosened sandbox. #4491 closes it at the gate.

## Weakest premise
That 0.149.1's screens and keys hold for the Codex the person runs. A newer Codex (0.159.2 exists) may word the
dialog differently; then codexHookReview reads nothing, the card shows no buttons, and nothing is pressed (fails
closed), but the feature is absent until re-measured.

## Incident, recorded here so it is not lost
While measuring, a startup "Update available" menu (not the hooks dialog) took a `1` sent after a timeout and ran
`npm install -g @openai/codex`: the shared Codex went 0.149.1 -> 0.159.2 at 02:12. No Codex was running. Restored to
0.149.1 at 02:14 (`npm install -g @openai/codex@0.149.1`, verified). Every later key was gated on its screen text,
and the isolated home sets `check_for_update_on_startup = false`.
