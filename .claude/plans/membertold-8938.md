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
2. Settings, Kosmos+, under "Your company": one line listing the daily report's contents (engine/orgrollup.js build()
   fields, plus the blocked/flagged events of #5683) and that chats, files and keys are never in it. Company only.
3. /api/org adds providersAllowed (orgpolicy.inForce().providers_allowed, screen-only branch, only while a list is in
   force). Add a provider marks every provider the company leaves out "not allowed by your company" (disabled, data-off
   for the visible list) and restores exactly what it marked when the list widens. Only Add a provider: the create
   pickers already refuse at create (#5534) and list only connected providers.
4. NOT in this PR: Sign in again returning the member to the invite sheet. The #8728 return mechanism is built around
   the Claude sign-in; extending it is its own change, after this merges.

## Tests
- web.membertold-8938.test.js: lifts acctPolicyApply, plusOrgSees, workOrgShow/workOrgPaint (mutation controls).
- docs/browser-checks/render-membertold-8938.js: hermetic, all four surfaces plus family / none / no-list controls.
- web.reauth-1492 stubs the new openAcctAdd callee; web.familysay-6251 counts the new wrapped sentence.

## Weakest premise
That "anything Kosmos blocked or flagged" is in every board's daily report: #5683's events are built, not yet seen on
production.
