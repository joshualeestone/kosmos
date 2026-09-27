# #3939 slice 3c-2: the AI Models account row for Meta Muse

## What finished looks like
With Muse turned on (AGENT_WORKFORCE_MUSE=1, a Mac), installed, and signed in (GET
/api/muse signedIn, which slice 3c-1 made trustworthy), Settings, AI Models lists a
"Meta" group with one row: "Meta account, through Muse Code on this computer", a muted
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
