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
survey missed. The browser check exercises the create-agent picker with only a Muse row
and an OpenAI row to catch the likeliest miss.
