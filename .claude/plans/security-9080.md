# security-9080: publish the security contact (kosmos#9080)

## Goal
Publish where to report a security problem: SECURITY.md at the kosmos repo root (public repo), and
/.well-known/security.txt on installkosmos.com (chaoskosmos-site, its own PR).

## Decisions
- One address, security@installkosmos.com (an alias of hello@, tested 11-25 12:25 under #6600).
- No response time is promised, only that we acknowledge. No bounty, no credit-by-name promise,
  no legal safe-harbour wording: each is a promise nobody has said we can keep.
- No known weakness is described or hinted at.
- security.txt: Contact, Expires just under a year out (2027-11-20; RFC 9116 advises under a year), Policy pointing at SECURITY.md on
  GitHub main, Canonical, Preferred-Languages. RFC 9116 requires Contact and Expires.
- The site deploys itself minutes after a push to its main (.github/workflows/site-deploy.yml,
  kosmos#5589). So merge the kosmos PR FIRST and confirm the Policy URL answers 200, then merge the
  site PR; otherwise installkosmos.com would briefly serve a policy link that 404s.

## Done when
SECURITY.md is on main, and curl of https://installkosmos.com/.well-known/security.txt returns
the file, read from outside after the site deploy runs.
