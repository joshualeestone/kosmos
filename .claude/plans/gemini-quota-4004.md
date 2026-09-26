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
- engine/accountproblem.js: a Gemini daily limit says Josh's words: "Google's free daily limit for <name>'s API key
  is used up, so it has stopped. It resets at midnight Pacific time, or add billing to the key in Google AI Studio,
  or use Google Gemini (Google subscription) instead." notify:true (firm), so the manager is told too.
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
