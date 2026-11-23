# membertold-8938: a company member's own Kosmos says it is the company's (kosmos#8938)

Source: the live Cloud member walk for #7973 (11-23, Testville Municipal). A member's own screens barely named the company.

## Done when
On a company's work Kosmos, the member sees, on their own computer: the company named at the setup welcome and in the
You menu; what the company's daily report holds and what it never holds; and which AI providers the company does not
allow, before connecting one. A family, a Kosmos in no company, and a company with no provider list see no change.

## Items (card numbering)
1. Setup welcome adds "This is your work Kosmos for (company)." under Josh's words (kept verbatim); the You menu adds
   "Work Kosmos for (company)" under the member line (only for a Kosmos+ member, where that line shows). One reader, workOrgPaint(), from /api/org, at most once a minute.
   Company only. The sentence goes through plusOrgIn like every "your work Kosmos" (web.familysay-6251 counts it).
   Dropped: the model step's "Your agents run on your own subscription" is TRUE for a member, so it stays.
2. Settings, Kosmos+, under "Your company": the company's own words as accepted on this computer, "Reported to your
   company: <report lines>. Your company may back up: <backsUp lines>. Never sent: <never lines>." (/api/org
   reportWords: acceptedConsent().reports and .backsUp, and the new orgenroll.acceptedNever()). rememberConsent now
   keeps the never lines it was handed (it kept reports and backsUp only); a computer that joined before this keeps
   none until its words are accepted again, and then shows no "Never sent" part (round 3). Company only, and only while this Kosmos reports. Challenge round 2 showed a
   hand-written list overstates what a company with narrower words receives; the accepted words are what the board
   reports by, so they are true by construction.
3. /api/org adds allowedProviderNames (orgpolicy.current().providers_allowed mapped through providerName, the menus'
   words, so the two Gemini rows stay distinct; screen-only branch; only while a list is in force; current() so a read
   applies nothing; ids with no menu name are left out). Add a provider shows one line under its intro: "Your company
   (or family) allows only X and Y for new agents on this computer." (new: running agents are not stopped). Words only, by design (challenge round 1):
   marking the options themselves raced the code that owns them (Meta Muse, the vendor switches, Windows Qwen),
   could not represent the Gemini subscription and key rows separately, and could strand a sign-in in flight.
4. NOT in this PR: Sign in again returning the member to the invite sheet. The #8728 return mechanism is built around
   the Claude sign-in; extending it is its own change, after this merges.

## Tests
- web.membertold-8938.test.js: lifts acctPolicyNoteText, plusOrgSees, workOrgShow/workOrgPaint, pins the server field.
- docs/browser-checks/render-membertold-8938.js: hermetic, all four surfaces plus family / none / no-list controls.
- web.reauth-1492 stubs the new openAcctAdd callee; web.familysay-6251 counts the new wrapped sentence.

## Weakest premise
That the accepted report words are a complete account of what reaches the company: the board reports by them
(orgrollup consults acceptedConsent), but the blocked-or-flagged events of #5683 travel on their own route.
