# #7045 part 1 (iPhone): a company's own sign-in, native, in Apple's sheet

Follow-up to #7042 (slice 5a), iPhone plan #6838 slice 5. Relay half: kosmos-relay branch ssoapp-7045 (`/v1/sso/begin`
takes `app=1`; the callback then returns to the fixed `kosmos-signin://sso`).

## Measured (08:1x 10-24)
- sso.rs callback ends at `<base>/signin#sso_grant=ksso1_...&email=...` (or `?sso_error=<word>`).
- No associated-domains entitlement; login.kosmosplus.com/.well-known/apple-app-site-association is 404; the app is iOS
  16+. So Apple's sheet can finish only on an app-only scheme, which needs no association (the relay half adds it).

## Finished looks like
1. An address whose company REQUIRES its own sign-in opens Apple's sheet straight from the email step (no code is
   coming); one whose company OFFERS it shows "Sign in with your company's account instead" on the code step.
2. The sheet's return: a grant (with the email the provider vouched for) is spent at /v1/signin/verify in place of
   the code, with this iPhone's own device proof, and the steps after are 5a's. A refusal shows the web page's own
   sentence on the email step. Closing the sheet changes nothing.
3. A first company sign-in, which makes the account (terms_required), goes to the web page, where the terms are.
4. Only Kosmos+'s own begin path on the coordinator is ever opened, kept byte for byte with `&app=1` appended.
5. Logic tests and shots (code step with the link, a refusal), light and dark.

## Rejected
- Universal links / the iOS 17.4 https callback: an association file on Kosmos+ and an Apple capability, and iOS 16
  would be dropped.
- prefersEphemeralWebBrowserSession: an ephemeral sheet loses the person's company sign-in in Safari, so they would
  type their company password every time.

## Weakest premise
That the relay half deploys before this ships: until it does, the coordinator ignores `app=1` and returns to the web
page, so Apple's sheet never sees its scheme and the person closes it (nothing breaks; the company sign-in just does
not finish in the app). Kept in order by the release, not by code.

## Not in this part
Passkeys (need the Associated Domains capability and an association file), and setting up a second step (enrol).

## STOPPED 08:2x: the relay half is unsafe (blind review)
The custom-scheme return lets any app that registers `kosmos-signin` receive a grant from a begin link an attacker
builds (the attacker picks the device, so the binding does not help; PKCE does not either, the attacker starts the
flow). The safe return is an https callback on login.kosmosplus.com (ASWebAuthenticationSession .https, iOS 17.4+),
which needs the Associated Domains capability and an apple-app-site-association file on Kosmos+; the coordinator then
needs no change. This branch's parsing, refusal sentences and terms hand-over carry over; only the return address
changes (companyReturn would accept https://login.kosmosplus.com/signin#sso_grant=... from the sheet, and begin
would not send app=1). Fixed here meanwhile: busy no longer drops while the sheet is open.

## RESUMED 08:4x: the safe version (Baron added Associated Domains, profile GL45W8GF57, #7045 comment 6384749125)
- The app's entitlement: `webcredentials:login.kosmosplus.com` (Baron: safe to merge now).
- Kosmos+ serves /.well-known/apple-app-site-association, webcredentials only (kosmos-relay branch aasa-7045).
- Apple's sheet finishes on Kosmos+'s existing /signin https return (ASWebAuthenticationSession `.https(host:path:)`,
  iOS 17.4+), which it hands only to the associated app. No `app=1`, no coordinator change to sign-in.
- Below iOS 17.4 the company sign-in is the web page's (the app offers no sheet there).
- companyReturn accepts only https on the coordinator's host and port, path /signin. Tests: another host, another
  path, http, and the old custom scheme are all refused.
- Weakest premise now: that the sheet's https callback completes on the 302 to /signin (Apple's docs: the session
  completes when it navigates to a URL matching the callback). Not seen on a device yet.
