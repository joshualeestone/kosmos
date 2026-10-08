# orgenroll-5531: enroll one work Kosmos into a company, with consent before anything binds (#5531, Enterprise E0.2)

Umbrella #5529 (read its Decisions first). Coordinator side: #5530 (E0.1, PigeonPete), contract v1.3 in
kosmos-relay `.claude/plans/orgs-5530.md`, agreed 2026-10-07 between the two owners.

## The contract the board builds against (Mac-signed POSTs, through the tunnel's mac-request)
- `/v1/mac/org/redeem {code}`: a PREVIEW. Returns `{org, role, consent: {reports, backsUp, readers, never}}`. Uses no code
  and makes no membership.
- `/v1/mac/org/enroll {code?, world, accepted: true}`: uses the code and makes the membership and the enrollment in one
  step. An existing member moves the enrollment with no code. With a code but already in that company: 409
  `org_already_member`, code not spent.
- Review 2 there: status and enroll carry `enrolled.thisComputer`; a world reports only when `enrolled.world` is its id AND
  `thisComputer` is true (a world's id copied to a second Mac with its data must not report there). The preview refuses
  an existing member of that company (409 `org_already_member`); how such a member sees the consent before moving the
  enrollment to a new world: v1.3, status carries the consent for a member; the board shows it and enrolls with no
  code (preview returns move: true).
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
  - `leave()` clears the record first, so the world stops at once. Refused as the last admin (org_last_admin): the record
    comes back (still joined). org_not_member: left. No answer: a pending leave, sent again on start and daily.
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
- `docs/browser-checks/render-orgenroll-5531.js` O1 to O7 (O7: a member moving here), on the real page. Rendering the consent as markup turns O2 red.

## Not done here
- The join link (`login.kosmosplus.com/org/join#code=...`) opening the board: the code is typed or pasted for now.
- A live round trip against Pete's coordinator: it waits on his dev branch and on a connector that carries the paths.

## Review 1 (blind, opus)
- FIXED: leave reconciliation (last admin stays joined; a pending leave is retried); company name and consent lines
  cleaned with engine/externalname.js and bounded; codeOf matches only the public codes (an org_id field is not the
  error); the page throttles failed /api/org reads; a terminal enroll refusal returns to the code field; Mona's 16px.

## Review 2 (blind, sonnet)
- FIXED: a successful enroll clears a pending leave (else the next pass sent the old leave and un-enrolled a person who
  had just joined); enroll, leave and refresh run one at a time (a pass that read "enrolled" before a leave could
  write the record back after it). Both pinned; each mutation reddens.
- DEFERRED: "an agent never joins for the person" is exactly as strong as isViaScreen, the board's check for every
  person-only setting (refuses an agent token; requires browser headers). A per-session screen nonce would be a
  board-wide change, not this card's.

## Review 3 (blind, opus)
- FIXED: a member's move needed no secret, so any screen-shaped request could move an enrollment. `/api/org/preview`
  now hands the screen a one-time ticket (10 minutes), and an accepted `/api/org/enroll` needs it; a missing or made-up
  ticket sends nothing. A pending leave keeps the record it cleared, so a retry refused as the last admin restores it.
  The pending leave says a plain sentence, not the transport's text. The world id is minted through a unique temp
  file, and a read never mints one. The enroll answer no longer carries the world id to the page. Check code and Not
  now cannot run twice while a request is out.
- DOCUMENTED: `isEnrolledHere()` is necessary, not sufficient. A copied data folder still holds the record until the
  next refresh, so the coordinator must also refuse a report from a world it no longer names (E0.3, E0.6), and
  Forget on a world should clear it (a later card).

## Review 4 (blind, sonnet)
- FIXED: a failure with no public code showed the raw tunnel line (a spawn error carries the connector's path, so the
  home folder). It now shows a fixed sentence; the raw line goes to the log, cleaned and bounded. GET /api/org sends
  the company's name and slug only, not its id.
- DECIDED: GET /api/org stays readable by this board's agents. An agent on a work Kosmos reports to that company, so
  which company it is is not a secret from it; the writes stay person-only.

## Review 5 (blind, opus)
- FIXED: the ticket now carries what was previewed (the code, or null for a member's move), and an enroll with a
  different code is refused before anything is sent. The comment says plainly that this is as strong as isViaScreen:
  it guarantees no join skips the consent step, not that the caller is a person. A server test drives the accepting
  arm through a stubbed remote (accepted once, refused on a second use and for another code). Every answer from the
  org routes goes to the page with the company's name and slug only. Refresh's failure text goes through the same
  fixed-sentence path.
- DECIDED: a pending leave is retried on every start and daily with no end. Until the company confirms, the person is
  still a member there, so giving up would leave them listed with nothing reporting. Nothing reports meanwhile.

## Review 6 (blind, sonnet)
- FIXED: an agent reading GET /api/org gets the company's name and slug only (no role, no enrollment date); the
  screen still gets both. Temp files for the world id and the enrollment are unique and removed when a write fails.
- DEFERRED, measured: "the block hides while an enrolled Kosmos keeps reporting". The block shows exactly when this
  computer is connected to Kosmos+, and a computer that is not connected cannot sign anything (engine/remote.js
  macRequest refuses), so a hidden block means nothing can be sent.
- DUPLICATES: a stale record after removal (review 3; the coordinator now refuses it server-side as org_not_enrolled,
  per #5532's contract); isViaScreen as the only person check (review 2).
- DECIDED: a failure's raw line is written to this board's own log, cleaned and bounded. That log stays on this
  computer; nothing in the engine sends it anywhere.

## Review 7 (blind, opus)
- FIXED: a join that failed for a passing reason (no public code) spent the ticket, so every later Join was refused
  and the page kept telling the person to try again. The ticket now survives such a failure, and a refused ticket
  answers `code: 'org_ticket'`, which returns the page to the code field.
- FIXED: one odd status answer (a field missing) ended the enrollment for good, silently. Refresh now stops only on a
  CLEAR answer (not a member; a member enrolled nowhere; enrolled as another world; thisComputer false). Any other
  shape changes nothing, like an unreachable coordinator; the coordinator refuses reports it does not accept
  (org_not_enrolled). When it does stop, the screen says why, once (`stoppedFor`, browser check O8).
- FIXED: GET /api/org gives the role and date only to the screen (isViaScreen), not merely to callers without an
  agent token. Leave is refused unless this is the work Kosmos (or one the company stopped naming, or one with a
  leave unconfirmed), since leaving ends the whole membership. A confirmed leave retires this world's id, so a later
  join never resends the old id (a later join can still be linked by computer and account: every request is signed). The check and README say `{ code, accepted: true, ticket }`.

## Review 8 (blind, sonnet)
- FIXED (both from review 7's changes): leave is sent only from the world the company enrolls, or one whose leave is
  unconfirmed. A world the company stopped naming, or a stale record naming another world, clears locally and sends
  nothing, because the membership may now belong to another world or computer and must not be ended from here. The
  world id is retired whenever an enrollment ends for good (a confirmed leave, or refresh stopping on a clear answer),
  not only on a leave.
- FIXED: a join code is never written to the log, even inside a raw failure line that echoes the request. Not now
  says "only the code was checked", to match the hint above the field.
- DUPLICATE: isViaScreen as the only person check (review 2).

## Review 9 (blind, opus)
- FIXED: the "stopped reporting" note is shown to the screen once and then cleared (it came back on every visit with
  no way to dismiss it). org_bad_world, which says "Try again", keeps the ticket; org_not_accepted returns the page to
  the code field. An unreadable local world id is an unclear answer, not proof the company moved on. The join code is
  kept out of the log in any letter case. A request body the board cannot read says so, instead of blaming the company.
- CORRECTED: retiring the world id stops the old id being sent again; it does not make a later join unlinkable, since
  every request is signed by this computer's Kosmos+ identity. The leave comment now says what the code does.
- DECIDED: one ticket per board process. A preview from a second screen replaces the first screen's ticket, and that
  screen's Join returns it to the code field (org_ticket). Rare, recoverable, and simpler than per-screen state.
- DECIDED: the plan keeps the name `<branch>.md`; the PR hook looks for exactly that file.
