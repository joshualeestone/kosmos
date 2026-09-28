# #3939 slice 3c-2: the AI Models account row for Meta Muse

## What finished looks like
With Muse turned on (AGENT_WORKFORCE_MUSE=1, a Mac), installed, and signed in (GET
/api/muse signedIn, which slice 3c-1 made trustworthy), Settings, AI Models lists a
"Meta" group with one row: "Meta account" with the tag "through Muse Code on this computer", a muted
"Signed in" (Kosmos's record, not a live check), and a "Sign in again" that opens Add a
provider on Meta's sign-in step. The row never behaves as a Claude account anywhere on
the page. Flag off, not installed, or not signed in: no row, the page exactly as today.

## Decisions
- Server: /api/accounts adds the row beside the Gemini-subscription row (agySub), in its
  own try: provider 'meta', providerName 'Meta', authMode 'muse', dir null, email null,
  connection { state 'connected', checkedLive false, badge 'signed_in_unverified' }.
- Provider id 'meta', not 'muse': it is the id every Meta menu option, PROVIDER_ORDER and
  the provider logo already use. acctProvider matches authMode 'muse' as well, so a future
  Meta API-key row stays distinguishable.
- acctProvider returns 'meta' for it, and for the menu's own 'meta' value (the create form maps its
  chosen provider through acctProvider; without that, choosing Meta once 3c-3 enables it would list
  Claude accounts). That alone keeps it out of the create-agent Claude
  picker, the "has Claude" checks and Claude grouping (the survey found each of those
  would otherwise take it as Claude through the 'anthropic' fallback).
- acctRowHtml gets a Muse branch before the Claude builder (as #3998's Gemini row does):
  no Check now, no history link, no Disconnect/Delete. Only "Sign in again".
- No Remove in this slice: unlike Antigravity there is no Kosmos-side forget, and signing
  Muse out would touch a Keychain credential shared by every Muse run on the Mac. Decided
  to leave it out rather than invent one; a person signs out in Muse itself.
- switchKeyedWord names it 'Meta Muse', never the OpenAI fallback. accountQualifiers is left as is:
  the row has no email or folder, so it skips the row, and its short names carry a test pin (#2634).
- engine/connections.js (text agents read) is NOT changed yet: Muse is off by default, and
  that text is the spec's; it changes with the slice that makes Muse selectable.

## Not in this slice
The create-agent option and running an agent on Muse (3c-3), the first-run guided row.

## Weakest premise
That no other page path reads a.provider === 'anthropic' implicitly through a route this
survey missed. The browser check runs the create form's own resetCreateProvider and
fillCreateAccounts on its real elements (round 2): with Muse + OpenAI it starts on OpenAI,
and with Muse + a Claude row that has no shared history (the fallback case) the Claude
picker lists only the Claude row. Both arms go red when acctProvider forgets Meta.

## Review round 1 (opus): 0 blockers, 6 warnings, 5 nits, all addressed
- W1: "not available" went into a hidden element. It now goes into #acct-add-pick-say
  beside the picker (role=status), and the check requires it to be visible.
- W2/W3: a late /api/muse answer took over a provider picked meanwhile, or drove a
  freshly reopened dialog. A visit counter (openAcctAdd/closeAcctAdd bump it) and "the
  picker still empty" guard it; both races are browser-check arms.
- W4: the row's explanation claimed only "the last time Kosmos saw it work"; it now names
  all three sources the answer comes from.
- W5: the Connections box counted Meta Muse as "thinking for your agents". It is left out
  until an agent can run on it (3c-3), and with only Muse the box says "Meta Muse is signed
  in, but no agent can run on it yet" rather than the false "Nothing is connected yet".
- W6: the server test could not see the row dropped from the response; it now requires
  `...museSub]` in the sendJson line.
- N1: the function moved below acctGeminiSignInAgain, so #3998's comment sits on its own
  function again. N2: a throw is said beside the picker. N3: a live answer clears a stale
  "not available". N4: Sign in again waits on the open's own /api/muse read.
- N5 (for 3c-3, recorded here): once the create form's Meta option is enabled,
  fillCreateAccounts would list this row as an option with an empty value and its empty
  fallback would speak of "the Meta Muse key"; vendorPicksModel('meta') is false. 3c-3
  must give Meta its own create branch, as #3998 did for the Gemini subscription.
- Two eval-sliced tests (web.reauth-1492, web.connect-success-1656) were given the new
  names (ACCT_ADD_VISIT, ACCT_MUSE_ASKING, acctAddPickSay), as slice 3b did for its helpers.

## Review round 2 (sonnet): 0 blockers, 1 warning, 2 nits
- WARNING FIXED: the plan claimed the browser check exercised the create-agent picker; it
  did not (only a unit-level predicate). It now does, through the form's own functions and
  elements, including the no-shared-history fallback where the leak would show (a blank
  option). Both arms were red under the acctProvider mutation.
- NITs ACCEPTED: the per-request require mirrors agySub's; the order of the 'meta' check
  in acctProvider is moot while ACCT_KEYED_ROUTE has no 'meta' (the authMode check stays
  first for a future Meta key).

## Review round 3 (opus): 0 blockers, 3 warnings, 5 nits
- W1 FIXED: with a sign-in already under way (openAcctAdd keeps its provider picked), the
  "picker still empty" guard made Sign in again silent. It now compares against the picker
  as it was right after opening, and when a sign-in is under way it says "Finish or stop the
  sign-in that is under way first, then sign in to Meta again." Browser-check arm.
- W2 FIXED: the status line was un-hidden and filled in one step, which a screen reader may
  not announce. It now stays in the tree, empty (CSS :empty takes its margin), per #3948.
- W3 FIXED: the server row is now tested through the real /api/accounts route
  (server.runners.test.js, darwin): off, on, a refusal after the sign-in drops it, a later
  sign-in lists it again, not installed drops it.
- N1: any provider choice clears the line. N2: the check's Claude-actions selector uses
  real attribute names. N3: the unit test asserts the move picker excludes the row. N4:
  README row describes the 3c-2 arms. N5 (web tests reading a relative path): pre-existing,
  noted; run them from the repo root.

## Review round 4 (sonnet): 0 blockers, 2 warnings, 2 nits
- W1 FIXED: the "under way" line outlived the sign-in it named when that sign-in failed
  (reproduced). acctFlowPaint's flow-ended point clears it (as museAsk clears a stale
  "not available"). Browser-check arm.
- W2 FIXED: the round-3 CSS was inert (the page reset gives every element no margin) and
  its comment overstated it. It now adds the gap while the line speaks
  (:not(:empty) { margin: 10px 0 0 }), measured by getComputedStyle both ways.
- N3: commented that the move picker's Claude arm excludes the row by memoryShared, not
  by provider. N4 ACCEPTED: the 3 s fallback reads the option's last answer, the same as
  the Gemini row's accepted #3998 behaviour.

## Review round 5 (opus): 1 blocker, 0 warnings, 2 nits
- BLOCKER FIXED: round 4 gave acctFlowPaint two new names (MUSE_BUSY, acctAddPickSay) and
  web.connect-success-1656.test.js lifts acctFlowPaint with a stub page, so it went red.
  Round 1's note that the sliced tests were updated had become false. Its stub now carries
  the element and both names. Lesson taken: after ANY change to a lifted function, run
  every web.*.test.js, not only the files touched (2018/2018 now).
- N1 FIXED: with the picker moved off a running Claude sign-in (its step and Stop hidden),
  Sign in again now puts Claude's step back on screen before the "under way" line speaks.
- N2 FIXED: going back to "Choose a provider" clears the line too.

## Review round 6 (sonnet): 0 blockers, 1 warning, 2 nits
- WARNING FIXED: with the picker moved off a running Claude sign-in, Sign in again put its
  step back but left focus on the page behind the dialog (#1918): openAcctAdd had tried to
  focus Stop while it was still hidden. Focus is now placed after the step shows, by
  openAcctAdd's own rule (the code field if it shows, else Stop), and falls back to the
  provider picker if that control cannot take focus (its panel not painted yet).
  The check now reaches the state as a person does (a flow painted as running, the picker
  moved by its own change event, the dialog closed) and asserts focus inside the dialog in
  both cases. Debugging note: an early version of the unpainted arm failed only because it
  ran its cleanup and its press in one step right after the previous arm; separating them
  made it pass 3/3 (traced with focus events, the fallback itself was correct).
- N1: commented why a non-empty picker here always means Claude's sign-in. N2 ACCEPTED:
  role=status with aria-live=polite is redundant but matches the page's pattern.

## Review round 7 (opus): 0 blockers, 2 warnings, 2 nits
- W1 FIXED: with the picker set back to "Choose a provider" mid-sign-in, Sign in again
  laid Meta's step over a running Claude sign-in, and a later poll then stopped the Muse
  sign-in the person had started (reproduced). "Under way" is now decided as openAcctAdd
  decides it (frConnActive of ACCT_FLOW_LAST), never from the picker. Arm, including
  that no Muse stop is sent.
- W2 FIXED: the "under way" line was written in the same step the dialog appeared, so it
  might not be announced. It is written a moment later (60 ms), for this visit only. Arm:
  empty in the same step, present after.
- N1 FIXED: the moved arm asserts exactly Stop, and a new arm asserts the code field at the
  sign-in's code step. N2 FIXED: the old busy arm reaches its state through the page's own
  functions (a painted flow, picker left on Claude) and asserts the step shows and Stop has
  focus.

## Review round 8 (sonnet): 1 blocker, 0 warnings, 1 nit
- BLOCKER FIXED: round 7's delayed "under way" write re-checked only the visit, so a Stop,
  the sign-in's end, or another provider picked inside those 60 ms was overwritten by a
  stale line; the provider case never healed (the poll dedupes an unchanged phase).
  Reproduced by the reviewer with the real 1 s poll. The write now re-checks a sign-in is
  still running and the picker is still on Claude, as the other branch checks after its
  wait. Two arms (a provider picked, the sign-in ended, both inside the moment); each goes
  red with its re-check removed.
- NIT FIXED: the plan's copy matched to the shipped row (name "Meta account", tag "through
  Muse Code on this computer", the Gemini subscription row's shape).

## Review round 9 (opus): 0 blockers, 2 warnings, 2 nits
Reviewer ran the real 1 s poll (acctFlowWatch) with /api/connect stubbed: the round-8
re-checks hold, repeated same-phase polls leave the line, a failed phase and Stop clear it.
- W1 FIXED: the round-4 "line goes when the sign-in fails" arm had come to follow an arm
  that already emptied the line, so it could not fail (proved by deleting the clear). It now
  makes its own state and asserts the line is there first; the same mutation now fails it.
- W2 FIXED (slice 3b code, reached from this slice): Meta picked in the picker beside a
  running Claude sign-in let that sign-in's next poll put Claude back and stop the Muse
  sign-in the person had started. The change handler now stays on Claude and says so, as
  Sign in again does. Arm, including that nothing of Muse's is started or stopped as the
  Claude sign-in moves on.
- NITs FIXED: the row's tooltip says "signing in again" (pressing only opens the step);
  the line names the Claude sign-in ("Finish or stop the Claude sign-in first, then sign in
  to Meta again.").

## Review round 10 (sonnet): 0 blockers, 1 warning, 0 nits
- WARNING FIXED: Meta picked through the REAL logo picker during a Claude sign-in left
  focus on the picker's own button (the widget closes after the change handler and
  refocuses itself), two tabs from the Stop the line asks for. My arm drove a synthetic
  change event, which is why it never saw this. One focus rule now serves both paths
  (acctFocusRunningSignin: code field, else Stop, else the picker); the picker path defers
  it past the widget's own refocus. The arm now clicks through the real widget and asserts
  Stop; both "never focused" and "focused too early" mutations fail it.
