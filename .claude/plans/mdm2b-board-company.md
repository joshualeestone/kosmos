# mdm2b-board-company: a managed Mac sets itself up through its company's sign-in (kosmos#5628 slice 2b)

kosmos#5628 (MDM zero-touch enrollment). Slice 1 (relay #330: the device flow /v1/sso/setup/start, approve, status
and /v1/setup/complete with sso_setup) and slice 2a (relay #331: the tunnel's setup company-start, company-status and
complete --sso-setup, secret on stdin) are live. This is the board's half: engine and routes. No page uses the routes
yet (the first-launch screen is slice 2b-ui), so this ships dormant.

## Done looks like
On a Mac whose MDM installed the Kosmos profile (com.installkosmos.kosmos, OrgSlug), the board can: say so
(GET /api/remote/managed), start a company setup for an email (POST /api/remote/company/start: the approval page
address and the code to match), report whether the person approved it (POST /api/remote/company/status), and finish
it with a name, the terms and a second step when asked (POST /api/remote/company/complete). The setup secret stays in
engine memory and only ever reaches the tunnel on stdin.

## Change
engine/remote.js: managed-profile read (plutil, first plist with a valid OrgSlug, cached 30s); companyStart /
companyStatus / companyComplete with single flight, the epoch rules Forget and sign-out already use, the setup clock,
and runSetupComplete shared with the code path. server.js: the four routes. Tests in engine/remote.test.js (10) and
server.test.js (a route test with a fake tunnel).

## Decisions (each on record in its review commit)
- The profile's CoordinatorURL is not read: the board's coordinator is its own; a profile cannot repoint it.
- The secret is engine memory only: a board restart means start again.
- The approval address must be https on the coordinator's own origin.
- An older tunnel without these verbs says "update Kosmos" (start) and ends the setup with that reason (status).
- The server decides whether a setup lives: 120s grace on the local clock before approval; after a refused finish
  one status ask, and a gone setup is cleared.
- An Off pressed while the finish runs stands (the in-app register's offEpoch rule).
- A reinstall recognised by its name changes nothing (no email recorded, nothing switched on): the board cannot
  prove which account owns the identity on disk (review 10, replacing reviews 5, 7 and 9).
- Weakest premise: the recognised-reinstall rule means a Mac whose settings were reset is switched on by hand in
  Settings; if that proves common, the fix is a server-side owner check, not a local one.
