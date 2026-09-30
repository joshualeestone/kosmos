# enroldead-4698: remove the Kosmos+ pane's unreachable enrol pair

Card: kosmos#4698 (Mona Lisa found it fixing #4694; two blind reviewers confirmed it from the code).

## Call (on the card, 2026-09-30 02:2x CDT)
Remove, not re-gate. paintPlus returns at state 1/2 for every board that is not enrolled, and the
only line that could show #plus-enrol ran after that, so it was always hidden. A board that is on and
not enrolled is exactly the state the state-2 sign-in wizard (#3478) owns, with its own "Email me a
code" on /api/remote/signin-*; a second enrol form there would be two ways to do one thing.

## What changed
- web/index.html: removed the #plus-enrol markup, its show line, the plus-code normaliser, the
  plus-send-code and plus-confirm handlers, the pair's three Enter-map entries, 'plus-name' in the
  name-cleaning loop, and the two code-box sentences only the pair used (sent, slow). Kept
  PLUS_CODE_WORDS asking/refused/noEmail and plusCountdown (the wizard uses them), second-reset (lost
  phone), and the server's setup-start/setup-complete routes (retiring them is separate).
- web.code-box.test.js: now drives the wizard's plusSiRequestCode (the code box a person can reach),
  keeping #729's coverage: asking line, good ask to the code step, cooldown held and released, refusal,
  slow service, empty email. Controls: rewording the refusal fails the refusal test; skipping the
  countdown fails the cooldown test.
- web.plus-wizard-3796.test.js: the name-cleaning and prefill assertions now say plus-name is gone.
- render-plus-signin-enter-0929.js: the arm that showed the pair by hand is gone (and WAITING, and
  the pair's ids from its surface line).

## Found and fixed on the way (own commit)
The wizard read a timeout as a cooldown: "the sign-in service has not answered in 15 seconds"
matches /in (\d+) seconds?/, so the button was held for 15 s and the line counted "has not answered
in 14 seconds" down. plusSiPostRaw now marks a timeout, and plusSiRequestCode starts a countdown only
for a real cooldown. Test pins it; removing the fix fails it.

## Measured
- web.*.test.js (291 files) + tools.browser-checks-wired + browser-checks-pr-select: 2239 of 2239.

## Review iteration 1: NITs only; three taken
- Two comments still described the removed pair (the plus-si-* id note, PLUS_NAME_RULE's "shared
  by plus-confirm"): rewritten.
- The name-cleaning assertion matched exact source whitespace: loosened to the binding's shape.
- Not changed: the harmless 'plus-enrol' stubs in two older tests' element tables; slicing
  plusSiMsg..plusSiPostRaw as one range in the code-box harness (guarded by its markers).

## Review iteration 2 (changes)
- MINOR: paintPlus's "being connected clears a stale SETUP failure" line (#1011) could never fire:
  plus-confirm was the only writer of a setup failure. Removed with its comment. The four #1011
  tests in web.plus-stale.test.js staged that unreachable state by calling plusSay(..., 'setup')
  directly; without the rule they would pass whatever the code did, so they were removed too, with
  a note in the file. PLUS_MSG_KIND is now written and never read; left (plusSay's kind argument is
  passed by its callers).
- Two comments that named plus-confirm or setup-complete as live were updated.
- Web tests: 2204 of 2204 (2208 minus the four #1011 tests).
