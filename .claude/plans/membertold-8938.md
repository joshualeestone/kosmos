# membertold-8938: a company member's own Kosmos says it is the company's (kosmos#8938)

Source: the live Cloud member walk for #7973 (11-23, Testville Municipal). A member's own screens barely named the company.

## Done when
On a company's work Kosmos, the member sees, on their own computer: the company named at the setup welcome and in the
You menu; what the company's daily report holds and what it never holds; and which AI providers the company does not
allow, before connecting one. A family, a Kosmos in no company, and a company with no provider list see no change.

## Items (card numbering)
1. Setup welcome adds "This is your work Kosmos for (company)." under Josh's words (kept verbatim); the You menu adds
   "Work Kosmos for (company)" under the member line. One reader, workOrgPaint(), from /api/org, at most once a minute.
   Company only. The sentence goes through plusOrgIn like every "your work Kosmos" (web.familysay-6251 counts it).
   Dropped: the model step's "Your agents run on your own subscription" is TRUE for a member, so it stays.
2. Settings, Kosmos+, under "Your company": one line listing what the report holds (engine/orgrollup.js build():
   agents, providers, models, status, projects and their token use, last active, tokens and cost, last backup, policy
   state; plus #5683's blocked/flagged events), that it goes daily and on change, and that chats, files and keys never
   do. Company only, and only while this Kosmos reports (st.reporting).
3. /api/org adds allowedProviderNames (orgpolicy.current().providers_allowed mapped through providerName, the menus'
   words, so the two Gemini rows stay distinct; screen-only branch; only while a list is in force; current() so a read
   applies nothing). Add a provider shows one line under its intro: "Your company (or family) allows only X and Y
   for agents on this computer. Agents cannot use any other provider here." Words only, by design (challenge round 1):
   marking the options themselves raced the code that owns them (Meta Muse, the vendor switches, Windows Qwen),
   could not represent the Gemini subscription and key rows separately, and could strand a sign-in in flight.
4. NOT in this PR: Sign in again returning the member to the invite sheet. The #8728 return mechanism is built around
   the Claude sign-in; extending it is its own change, after this merges.

## Tests
- web.membertold-8938.test.js: lifts acctPolicyNoteText, plusOrgSees, workOrgShow/workOrgPaint, pins the server field.
- docs/browser-checks/render-membertold-8938.js: hermetic, all four surfaces plus family / none / no-list controls.
- web.reauth-1492 stubs the new openAcctAdd callee; web.familysay-6251 counts the new wrapped sentence.

## Weakest premise
That "anything Kosmos blocked or flagged" is in every board's daily report: #5683's events are built, not yet seen on
production.
