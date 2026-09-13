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

## Iteration 1 challenge-review update (surface completion)
The blind reviewer correctly caught that I had missed SAME-SURFACE siblings on the AI Models
Settings account/connect surface (the `acct*` functions) - leaving them lowercase reproduced the
very inconsistency the card exists to fix, beside the strings I had just capitalized. Fixed 5 more:
- `we could not change that` (acct share handler, 18217 throw + 18224 String) -> capitalized.
- `we could not start that install` (acctOpenaiInstall, 18685) -> capitalized.
- `we could not start that sign-in` (acctOpenaiSubConnected, 19998 + 20004) -> capitalized.

Refined scope line: the fix now covers the whole AI Models **Settings** account/connect surface
(all `acct*` raw-rendered fallbacks). Still DELIBERATELY OUT:
- The `fr*` first-run ONBOARDING duplicates (`frOpenaiSubConnected`/`frOpenaiSubWatch`/`frEnterSubmit`,
  44804 sign-in + 44864 install + 44984 add) carry identical strings but are a different surface
  (onboarding, not Settings), so they are out of THIS card's Settings lane and left as a follow-up.
  FOLLOW-UP DIRECTION (measured): fr* is NOT uniform-lowercase - its THROW fallbacks (44804/44864/44984)
  are lowercase while its CATCH fallbacks (44811/44877/44989) are ALREADY capitalized on origin/main.
  So fr* already carries the same throw/catch split this card fixed on acct*, and the follow-up is to
  capitalize the three fr* THROWS to MATCH their catches (which reduces inconsistency), not to leave
  them lowercase.
- `unknownWhy` (17630) is a `because`-value fallback (capitalized downstream by the display, same
  idiom as pjSentence), correctly left lowercase.
- plusSay relay (29932/29933), tasks/notes (36xxx), friends (43290): other surfaces, out of lane.

## Iteration 2 challenge-review correction (conjunctive defect I created)
Sonnet review caught that my FIRST commit's `replace_all` on 'we could not add that account' also hit
line 44984 - which is in `frEnterSubmit`, the `fr*` ONBOARDING wizard, NOT the acct* Settings surface.
So I had capitalized onboarding's "add account" throw while (iteration 1) deliberately leaving
onboarding's sign-in/install throws lowercase: a fresh inconsistency ON the onboarding surface, the
exact drift the card fights, relocated. REVERTED 44984 back to lowercase, restoring onboarding to its
exact pre-branch state (all three fr* throws lowercase). The change now touches ONLY the AI Models
Settings acct* surface, as the scope line states. Onboarding remains a documented follow-up, untouched.

## Iteration 4 challenge-review update (last same-surface sibling + exhaustive sweep)
Sonnet review found a third missed same-surface sibling: line 18102, the disconnect/delete confirm
handler's blocking-agents fallback `'agents are set up to run on this account.'`, which renders raw
(String() concatenated with a capitalized `' Press again to...'` continuation) so it read lowercase at
the sentence lead. Capitalized to `'Agents are set up to run on this account.'`.

To stop finding these one per round, I then swept the ENTIRE acct* range (17400-20300). 18102 was the
only remaining raw-rendered TOAST/error-MESSAGE fallback. The other lowercase literals in range were
verified and correctly left, on these (measured) grounds:
- Status-badge "Why" family: `noneWhy` (17629), `unknownWhy` (17630) - and their siblings
  connectedWhy/workingWhy/rejectedWhy/unverifiedWhy (17642-17653). ALL SIX are lowercase-leading by
  design. They render via `esc()` (14438, which ONLY HTML-escapes, does NOT capitalize) into a
  status-badge tooltip/label, a different UI idiom from the toast messages this card targets;
  capitalizing one would break the family's deliberate consistency. (Correcting my earlier note: these
  are NOT "capitalized downstream" - they render raw. The exclusion stands on the family idiom, not on
  a downstream capitalizer.)
- `because`-value fallback: refused-import `'it could not be copied'` (19273) is inserted after the
  literal `', because '`, so lowercase is correct.
- Mid-sentence CONTINUATION fragments concatenated after a leading clause, lowercase correct:
  `'are signed in as '` (17548), `'there will not appear any more.'` (17797, in a title= tooltip),
  `'once you add this account again under the same name.'` (18097).
