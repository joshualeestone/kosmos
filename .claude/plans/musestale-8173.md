# kosmos#8173: a Muse sign-in last seen working weeks ago reads "not confirmed since <date>", not green

## The defect
server.js built the Muse row from musestatus.lastSeenWorking() (a finished turn or Kosmos's own sign-in, kept on
disk) and made it `badge: 'working'` whenever such a record existed, at any age. The page drew a green "Signed in ·
confirmed 18 days ago" with "so it is working". A Muse sign-in that died after its last turn read green until an
agent tried it: the Muse half of #8159, and worse than Grok's (green, not amber).

## The call
musestatus.connectionFor(seen, now) (pure): seen within 3 days, green as before; older, `signed_in_unverified` with
`notConfirmedSince: seen.at`; never seen, amber as before. Same field and line as #8161, so `kosmos accounts`, the
board summary and the create picker already handle it. The page's Muse row gets its own amber "Not confirmed since
<date>" pill (it renders its own row), with Sign in again still there. accountline's no-email wording ("adds the
Grok account again") now applies to a Grok subscription only; a Muse row signs in again. Nothing runs a Muse turn.

## Rejected
- Running a Muse turn to check: costs the person's Meta account (the card's "no sign-in spent").
- Reading Muse's own auth.json for a date: its shape is not documented, and on a Mac the credential is in the
  Keychain; the seen-working record is Kosmos's own and already trusted by signedIn().
- Changing Claude: it already has refreshTokenExpiresAt (claudeloginlive), with "login good until" and "Login
  expired"; only an early revocation is left, and only a paid Check now turn can see that. Stated on the card.

## Weakest premise
Three days. Muse's token lifetime is not measured; a long-unused sign-in may still work, so the words never say
expired. A person who uses Muse weekly sees "not confirmed since" between uses, which is true.

## Verification
engine/musestatus.stale-8173.test.js (6 tests: the card's case, a 1 h control, the 3-day line both sides, never
seen, a future reading, the server wiring, the CLI line for Muse and the Grok control, the page branch order).
Mutants: threshold Infinity (2 fail), the accountline condition reverted (1 fail). 472 related files, 4272 tests,
0 fail. docs/browser-checks/render-muse-signin-3939.js gains the stale pill (run through queued-heavy).
