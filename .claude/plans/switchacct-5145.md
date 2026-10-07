# #5145: after a provider switch, "Right now" names the account the agent landed on

## Problem
Since #5101 review 5 (122d46e94) the bracket in "Right now: <provider> (<account>)" is rebuilt from the NEW account.
With no account sent (no picker shown), the page had nothing to name, so the bracket was empty
("Right now: OpenAI Codex"), though the engine had landed the agent on its first account for that provider.

## The call
- `server.js` provider route: the `changed` answer carries `accountDir` = `path.resolve(acct.dir)` (acct = the account
  the route's own sentence names: `wrote.openaiAccount || wrote.account`), null when the engine named none (a Claude
  switch nobody picked for, Antigravity, a dry-run). An engine partial returns earlier and carries none.
- `web/index.html` `chooseSwitchedAccount(want, sentDir, out, accounts, mainClaudeDir)` decides what the page records:
  Claude: the pick, else a listed landed account, else nothing when the route named an unlisted one, else main.
  Others: a listed landed account wins over the sent row; an unlisted landed account records nothing, even when it is
  what was sent (no row could show it); with no landed account, the sent row. A landed dir matches a row after
  normalising separators, a trailing separator and a drive letter's case, and the row's own stored dir is recorded. A partial that carries accountDir (restart failed)
  never reaches the recording step (the page records only when the agent moved), so that branch is unreachable.

## Rejected
- Re-reading /api/accounts and guessing the provider's first account on the page: a second derivation of the
  engine's choice; the route already knows the answer.

## Weakest premise
That `acct.dir` is the account the agent will actually run on. It is what the route already names in its sentence
("It runs on your Gemini account"), so the page and the sentence now agree; if the engine's choice and the
sentence ever diverge, both are wrong together.

## Tests
- `server.switch-provider-google-xai-3296.test.js`: +4 (Gemini default; a named account with a control; a Claude switch
  with no pick -> null; Grok default) and `server.switch-account-1373.test.js`: +1 (OpenAI). Sabotage (field
  removed): all 3 red.
- Browser checks: `render-autohello-switch-2716` arm 11b2 (the route names an account; Right now reads "OpenAI Codex
  (work@example.com)" and the agent is recorded on it); arm 11b unchanged is the control (no accountDir -> no
  bracket). 31/31. `render-switch-claude-5091`: the route also names the main account and Right now still names the
  PICK (b@example.com). Sabotage (page fallback removed): exactly the two 11b2 checks red.

## Review log
- Review 1 (opus, blind): 1 B, 2 W, 3 N. B: the Gemini/Grok computed default ("this computer's own key") is not a
  listed row; recording it made the page say the account was gone ("cannot run") -> the page uses accountDir only when
  ACCOUNTS has that row (arm 11b3). W1: for non-Claude, the engine's landed account now wins over the sent row (codex
  can fall back from an unpicked unknown row). W2: OpenAI and Grok route tests added. N1: accountDir is path.resolve'd.
  N2/N3: comments made true. Sabotage (listed-row test removed): 11b3's "NOT recorded" check reds; its "no bracket"
  check passes either way (with no row there is never a bracket), so the account check is the guard, stated here.
  Meta tests (reviewer): 514 files, 7428 tests, 0 fail. Server: 22/22. 2716: 32/32.
- Review 2 (sonnet, blind): 0 B, 4 W, 3 N. W1 a landed account missing from a stale ACCOUNTS fell back to the sent
  row (an account the agent is not on) -> chooseSwitchedAccount: an unlisted landed account records NOTHING unless
  it is exactly what was sent; for Claude, nothing instead of main. W4 the precedence lived inline and untested at node
  level -> extracted into chooseSwitchedAccount (web/index.html), table test web.switch-landed-5145.test.js (14);
  sabotage (sent-before-landed for non-Claude) -> exactly 2 rows red. W3/N2 comments made true (the Gemini/Grok
  default IS a row once a key exists; Antigravity names none). N1 rows compared as stored: a dir matching no row
  records nothing (the safe direction). N3 the 11b3 bracket check is not a guard (stated in review 1).
  W2 DECIDED OUT OF SCOPE: acctParenthetical renders name||email||label, and Gemini/Grok rows carry only keyTail, so
  their bracket is empty on EVERY surface (reopen too), not just after a switch; adding a keyTail rung changes every
  place acctParenthetical paints, so it is its own card (filed separately, linked on #5145).
- Review 3 (opus, blind): 0 B, 0 W, 3 N => CONVERGED. N1 the #5145 function had split acctParenthetical from its #2225
  comment -> moved below it. N2/N3 plan text made true (above). Meta tests (reviewer): 553 files, 7930 tests, 0 fail.

## Re-review (2026-10-04, fresh loop after the hold lifted)
- Round 1: a landed dir is matched to a listed row ignoring trailing separators, and the row's own stored dir is
  recorded (an env-override default could be stored with a trailing slash).
- Round 2: on Windows the match also unifies separators and lower-cases a drive letter (only the letter: a folder in
  another case is still a different row). An unlisted landed dir now records nothing, even when it equals what was
  sent, since no row could show it. The table test has 18 rows plus the wiring test (21 rows after round 6).
- Round 4: the comment no longer claims every record names a row (a Claude pick is recorded as sent, as before this
  card). Kept, with reasons: ACCOUNTS is read once after the switch (a list dropped during the restart wait records
  nothing, the safe direction, and re-fetching would add a live sweep to every switch); the route sends
  path.resolve(acct.dir) and the page normalises it (round 1's call; the stored-string alternative would need every
  engine's row builder in the route). The earlier "table test (14)" is superseded by the 18 rows above.
- Round 5: a partial records no landed account inside chooseSwitchedAccount itself (it was only kept out by the caller's moved check); two table rows pin it.
- Round 6: a Claude pick is recorded as its listed row's own dir when it matches one (else as sent), so the exact-match "Right now" lookup finds it on Windows spellings too.
- Round 7: the comment above the recording step states the one Claude exception (a stale list records nothing, not main). The in-function partial guard (round 5) is a deliberate backstop for a branch the caller's moved check makes unreachable today; keep it.
