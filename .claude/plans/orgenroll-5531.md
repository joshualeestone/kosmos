# orgenroll-5531: enroll one work Kosmos into a company, with consent before anything binds (#5531, Enterprise E0.2)

Umbrella #5529 (read its Decisions first). Coordinator side: #5530 (E0.1, PigeonPete), contract v1.2 in
kosmos-relay `.claude/plans/orgs-5530.md`, agreed 2026-10-07 between the two owners.

## The contract the board builds against (Mac-signed POSTs, through the tunnel's mac-request)
- `/v1/mac/org/redeem {code}`: a PREVIEW. Returns `{org, role, consent: {reports, backsUp, readers, never}}`. Uses no code
  and makes no membership.
- `/v1/mac/org/enroll {code?, world, accepted: true}`: uses the code and makes the membership and the enrollment in one
  step. An existing member moves the enrollment with no code. With a code but already in that company: 409
  `org_already_member`, code not spent.
- `/v1/mac/org/leave {}`, and `/v1/mac/org/status {}` -> `{member:false}` or `{member:true, org, role, enrolled:{computer,world}|null}`.
- Public error codes: org_code_unknown, org_code_used, org_code_expired, org_other_org, org_wrong_domain,
  org_not_accepted, org_bad_world, org_not_member, org_last_admin, org_already_member.
- The tunnel's signing allowlist gains the four paths in the relay PR, so a board can call them only once a shipped app
  carries that connector.

## What this branch builds
- `engine/orgenroll.js`:
  - `worldId()` is an opaque random id per world, kept in that world's own data root (owner-only file). It is never
    the world's name.
  - `preview(code)` binds nothing. A malformed code is refused without a request. An empty consent, or one with no
    reader, is refused, so the page never offers Join on it.
  - `enroll(code, accepted)` sends NOTHING unless `accepted === true`. It records the enrollment only when the company
    confirms THIS world's id. On `org_already_member` it retries once without the code.
  - `leave()` clears the record first, so the world stops even when the request fails.
  - `refresh()` runs on start and daily. It clears the record on `member:false`, or when the company names another
    world. An unreachable coordinator changes nothing.
  - `isEnrolledHere()` is the gate for every later sender (E0.3 telemetry, E0.6 backup).
  - The public error codes become plain sentences.
- `server.js`:
  - `GET /api/org` reports this world's record. It never hands the world id to the page, and a record naming another
    world reads as not enrolled.
  - `POST /api/org/preview`, `/api/org/enroll` and `/api/org/leave` are person-only (`isViaScreen`).
  - On start and daily, only a world WITH an enrollment calls status. A world that never joined sends nothing.
- `web/index.html`: a "Your company" block in the connected Kosmos+ panel (only a connected computer can sign).
  - A join code field, then Check code, which shows the company and the four consent lists as text.
  - Join with this Kosmos / Not now.
  - Once joined: the work-Kosmos line, and a Leave that asks first.
  - The 5-second repaint reads /api/org at most once a minute, and never mid-consent.

## Decided
- "Declining sends nothing at all" (the card): the decline itself makes no request. The preview before it sends only
  the code, and binds nothing (contract v1.2). Rejected: a preview carried inside the code, read with no request. It
  needs a signature the board can verify, a larger change, and it buys only that the coordinator never sees the code
  looked at.
- The block lives in the connected Kosmos+ panel. Joining is a signed request, so an unconnected computer cannot join.
  The block shows only when this computer is enrolled in Kosmos+.
- Weakest premise: that `because` from a failed signed request carries the coordinator's `org_*` code. The tunnel's last
  stderr line is assumed to include the body. If it does not, the person sees the raw line, and the already-member retry
  does not fire. That is checked once Pete's routes are on a dev coordinator.

## Tests
- `engine/orgenroll-5531.test.js`:
  - The done-when: two worlds; enrolling one sends nothing about the other, and every request is a contract POST.
  - Declining sends no request.
  - Malformed codes and empty consent.
  - Confirmation of this world.
  - Refresh on member:false, on another world, and when the coordinator is unreachable.
  - Leave when the request fails.
  - File modes, error wording, and the already-member retry with its control.
  - Mutations of the accepted check and of refresh's world match each turn it red.
- `server.orgenroll-5531.test.js`: agents refused (removing the guard turns it red), decline and preview from the
  screen, and GET /api/org.
- `docs/browser-checks/render-orgenroll-5531.js` O1 to O6, on the real page. Rendering the consent as markup turns O2 red.

## Not done here
- The join link (`login.kosmosplus.com/org/join#code=...`) opening the board: the code is typed or pasted for now.
- A live round trip against Pete's coordinator: it waits on his dev branch and on a connector that carries the paths.
