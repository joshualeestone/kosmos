# Plan: #2531 Settings copy consistency (renettilley)

## Card
#2531 - Settings copy consistency: removal-verb drift + error-message capitalization.
Mona Lisa's Settings copy review (found against 0.6.49 source). Low severity, copy-only.

## What I found when I measured current source (a card is a snapshot)
The card named two sub-fixes. Measuring current `web/index.html`:

1. **Removal-verb drift (button "Disconnect" arming to "Remove it?"): ALREADY FIXED.**
   The #2264 refactor made ONE handler for both Disconnect (data-forget) and Delete-and-remove
   (data-remove), reading the confirm wording off the button so they cannot drift:
   `const CONFIRM = isRemove ? 'Delete for good?' : 'Disconnect?';`. The disconnect button now
   arms to "Disconnect?" (reuses its own resting verb) - exactly the card's recommendation. There
   is NO live armed label reading "Remove it?" (all such hits are comments). No action.

2. **The card's Styles/Advanced lowercase examples are GONE.** "save the style" no longer exists in
   source; no lowercase `we could not ...` errors remain in the Advanced/Styles code range. Already
   cleaned up since 0.6.49. No action.

3. **What IS still live: AI Models account-error fallbacks that render RAW.** The correct idiom in
   this file is `pjSentence(x.because || 'we could not X')` - pjSentence capitalizes the lowercase
   `because` reason, so those lowercase fallbacks are CORRECT. The bug is the account-error fallbacks
   that are assigned directly to `textContent` or thrown as an `Error` message and shown via
   `String(err.message)`, bypassing pjSentence and rendering lowercase, while their capitalized
   siblings (`'We could not add that account.'`, 65 `'We could not ...'` siblings) sit right beside
   them.

## The change (6 string literals, web/index.html)
Capitalize + add a period to the raw-rendered AI Models account-error fallbacks so they match their
already-capitalized siblings:
- `we could not tell which provider that account belongs to, so nothing was changed` -> capitalized + period (17976, direct textContent)
- `we could not remove that account` -> `We could not remove that account.` (18119 throw, 18170 String fallback)
- `we could not add that account` -> `We could not add that account.` (19781, 19849, 44984 throws; matches the already-capitalized catch fallbacks at 19801/19867/44989)

## Scope decision (I decided; Josh's standing ruling - no Kosmos call goes to him to unblock)
Scoped to the AI Models account-error surface the card names. DELIBERATELY OUT of scope, with reasons:
- The "You"/profile picture fallbacks (26625/26637/26642/26716) and the tasks/notes/friends fallbacks
  (36xxx/43xxx) are lowercase too, but they are different surfaces outside a Settings copy review,
  and several are shown via a path I did not trace end-to-end. Widening into them turns a contained
  copy fix into a file-wide error-flow refactor in a 17k-line hot file.
- Full inventory left as a comment on #2531 so the wider pass is a one-comment follow-up, not a
  rediscovery.

**Weakest premise:** that "across Settings" means the AI Models account surface specifically, not
every lowercase error sentence app-wide. If Mona Lisa/Josh intended the app-wide sweep, this is
narrower - but the app-wide version is a different (larger, riskier) change than a copy card, and the
inventory comment makes the rest cheap to pick up.

## Verification
- No test or browser-check asserts the OLD lowercase strings (the one grep hit is a `/* */` rationale
  comment in web.ask-first-1683.test.js, not an assertion - left untouched).
- Account/disconnect module tests green: 23/23 (web.ask-first-1683, server.forget-openai-1372,
  web.disconnect-stop-2570).
- web/ change trips the #1720 browser-check gate; satisfied with a `Browser-check:` commit trailer
  (copy-only error strings on fault paths not exercisable without server fault injection; no layout
  or selector change).

## Not doing
- Not rebuilding sub-fix #1 (already fixed).
- Not touching the Styles/Advanced strings (already gone).
- Not touching pjSentence (it is correct; capitalizing there would double-capitalize the routed ones).
