# gemini-quota-4004: a Gemini agent on its daily quota never hangs, and says so

Card: joshualeestone/kosmos#4004 (Josh, 2026-09-26 11:55, a diagnosis by his Gemini-Sub agent on Mac 0.6.97).

## Reproduced (2026-09-26, this Mac)
Gemini CLI 0.61.0, the supervisor's flags (`--approval-mode yolo --skip-trust -m gemini-2.5-flash`), an API-key
sign-in, and GOOGLE_GEMINI_BASE_URL pointed at a local fake answering Google's free-tier daily-quota 429
(QuotaFailure quotaId GenerateRequestsPerDayPerProjectPerModel-FreeTier). No real key. After one message the pane
shows Gemini's ProQuotaDialog, "Usage limit reached for gemini-2.5-flash." with "1. Keep trying / 2. Stop", and waits
forever. For a daily ("terminal") quota the CLI always asks in interactive mode; errorVerbosity=low only skips it
for retryable limits; no flag or setting avoids it. The `2` key answers Stop: the pane shows
"✕ [API Error: You have exhausted your daily quota on this model.]" and returns to its prompt, alive, so the next
message after the reset works (item 4 with no restart). The board read the question as `unknown` and the error as
`idle`.

## Change
- engine/status.js: `geminiQuotaReading` (the question with its options, or the quota error as the newest thing on
  screen) and a Gemini arm in classify: RATE_LIMITED, firm (limitFrom 'gemini', so Gemini's automatic end-of-turn
  idle cannot contradict it, as for Codex), with `quotaDialog` when the question is up. `capturePane` exported.
- engine/accountproblem.js: a Gemini daily limit says the card's words, minus "free" (round 6): "Google's daily limit
  for <name>'s API key is used up, so it has stopped. It resets at midnight Pacific time. To raise it, add billing to
  the key in Google AI Studio, or use Google Gemini (Google subscription) instead." notify:true (firm), so the manager is told too.
- engine/chat.js `answerGeminiQuotaStop`: through keysAllowed; re-reads the pane, and presses the number printed
  beside "Stop" only if the question is on screen now.
- engine/geminiquota.js + server.js: a ~1-minute sweep answers Stop for a Gemini card waiting on the question, at
  most once a minute per agent; gated on live execution; brake AGENT_WORKFORCE_GEMINI_QUOTA_OFF=1.

## Decided
- Detect and answer, because the CLI has no way to not ask. Stop, because retrying cannot clear a daily limit.
- The key is read off the screen (the number beside Stop), not fixed: a daily limit can show "Switch to <model> /
  [Upgrade for higher limits] / Stop" as well as "Keep trying / Stop".
- Review round 1 (Opus): the rules are anchored to Gemini's own shapes (the dialog must end the screen with only its
  box edge after the options; the error must be Gemini's `✕ [API Error:` line; the empty composer is not a newer
  turn), because an agent can show these words in tool output while working. The card carries `quotaDialog` and the
  sweep keys on it (not on a sentence). The question on screen stands over any report (a blocked turn cannot be
  working through it).
- "Midnight Pacific" is Google's documented reset for free-tier daily limits; the screen does not give a time.
- The Settings account row (red/amber) belongs to #3997, which owns those rows; not duplicated here.

- Review round 2: one parser of the Stop row (status.geminiStopKey) for the reading and the key; the card carries
  limitFrom and the wording keys on it. Deferred: the setup guide's hosted-fallback limit sentence (web asbFallbackWords)
  stays generic; it belongs with #3997's account wording. A two-digit option number is untested (dialogs have 2-3).

- Review round 3: the error line counts only with Gemini's composer after it and no spinner below (a quoted error in
  tool output does not). The question alone is worded neutrally ("reached a Google usage limit"): Gemini shows the
  same question for other limits (a billed key's cap, a model with no free quota); the free-daily wording with the
  midnight Pacific reset is for Gemini's own "exhausted your daily quota" line. Deferred: an Ink-wrapped error line on
  a pane narrower than ~70 columns is missed (falls back to idle); no backoff when an answer keeps failing (one log
  line a minute); no test that a non-Gemini card is refused (the runner check is one line in answerGeminiQuotaStop).

- Review round 4 (Opus): tests added for the automatic-report arm (Gemini's bridge ending the failed turn; CONTROL: the
  agent's own report), and a snapshot test that the board card itself carries quotaDialog and limitFrom into the sweep
  and the manager notice. Each half of the newer-turn check, the composer requirement and the 14-row window have their
  own fixture (the turn drawn above the composer, as Gemini draws it). The Gemini block moved above the #3723 comment,
  which describes the Codex markers. All seven perturbed red. Deferred: the "API key" wording is wrong for a
  default-account Gemini agent that inherited the operator's own Google login (geminisettings never clobbers an
  existing auth type); the Google subscription path runs on Antigravity, not this runner, so that is an edge of the
  default account, and belongs with #3997's account wording.

- Review round 5 (Sonnet): a quota box with no Stop option is not the question (control); the question-up line says
  the agent stopped at Gemini's question, not that Kosmos is answering it (the sweep can be switched off).
- Review round 6 (Opus, checked against the Gemini CLI 0.61.0 source): "exhausted your daily quota" is printed for ANY
  daily quota, billed keys included, so "free" is dropped and billing is advice ("To raise it"). The per-agent wait is
  55s under the one-minute tick so jitter cannot stretch a retry to two minutes. The sweep's record cleanup has a test.
  Noted, not this card: a message sent in the up-to-a-minute before the answer lands in Gemini's question (existing).

## Weakest premise
- Matching Gemini's words on screen: a future CLI can reword them. The reading then falls back to today's behaviour
  (unknown/idle), and the sweep presses nothing, since it needs the question recognised.
- The key press was measured by hand in a real pane (the `2` key), not by the sweep end to end in a live pane.

## Tests (engine/geminiquota-4004.test.js; each rule perturbed red)
- The two real screens classify rate_limited (question / after Stop); CONTROLS: a newer turn after the error, and a
  Claude pane with the same words.
- The wording; CONTROL: a non-daily Gemini limit keeps the general wording.
- The sweep answers only a Gemini card waiting on the question, and not twice within a minute.
- answerGeminiQuotaStop presses the number beside Stop when the question is up, and nothing when it is not.
