# geminidemand-4034: a Gemini agent waiting on its other numbered questions says it needs you

Card: joshualeestone/kosmos#4034 (filed from #4004). Measurements and the decision are on the card.

## Measured (Gemini CLI 0.61.0, this Mac, fake key, local fake endpoint, private tmux socket)
- 404 NOT_FOUND: after about 860 requests in 5 seconds, the same box as #4004's with
  'Model "<model>" was not found or is invalid.' over "1. Keep trying / 2. Stop"; it waits there. The board read unknown.
- 503 overloaded: no question; Gemini retries with backoff (22 requests in 2.5 minutes), spinner up (reads working).
- 429 with MODEL_CAPACITY_EXHAUSTED and no RetryInfo: no question; about 15,000 requests in 3 minutes, spinner up.
  Not claimed for Google's real capacity error (the fake sends no retry delay).
- The "experiencing high demand" box could not be drawn with these answers; its words are Gemini's source text.

## Change
- engine/status.js `geminiQuestionReading`: the question box by its shape (a box top, a message, numbered options
  ending in Stop, nothing after but the box edge), returning Gemini's first line. In classify, after #4004's
  usage-limit reading: NEEDS_YOU, "Gemini is waiting on a question: <its first line>". No key is pressed and
  `quotaDialog` is not set, so #4004's Stop sweep does not answer it.

## Decided
- Show needs_you, press nothing. Rejected Keep trying: it cannot find a missing model, and its retry is a burst of
  hundreds of requests; for high demand there is no captured screen to anchor a keypress to. Rejected Stop: it
  hides the reason behind an error line and the agent still cannot work.

## Weakest premise
- The high-demand box is recognised from source text. What would change it: a captured high-demand screen whose
  box has a different shape.

## Tests
- engine/geminidemand-4034.test.js: the captured not-found screen reads needs_you with Gemini's words; the
  high-demand variant (three options) too; controls: a usage limit stays rate_limited with quotaDialog, a quoted box
  with a working screen below is not a question, a box with no Stop option is not one. Red with the arm disabled.

## Review round 1 (Sonnet), what changed
- Stop is found among the options wherever it sits, through geminiStopKey (the one parser of that row, as
  geminiQuotaReading uses), not only as the last option. Tested, red before.
- Only Gemini's remedy hints ("/model to switch models.", "/stats model for usage details") are left out of the
  message; a first line that starts with a slash is still the message. Tested, red before.
- The shared GEMINI_LIMIT_ROWS window is stated in the comment: a box taller than it is not read, as for a usage limit.
