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
(As it stands after review 24. The per-review sections below record how each part got here.)
- `engine/orgenroll.js`:
  - `worldId()` is an opaque random id per world, kept in that world's own data root (owner-only file). It is never
    the world's name.
  - `preview(code)` binds nothing. A malformed code is refused without a request. An empty consent, or one with no
    reader, is refused, so the page never offers Join on it.
  - `enroll(code, accepted)` sends NOTHING unless `accepted === true`. It records the enrollment only when the company
    confirms THIS world's id on THIS computer. On `org_already_member` it does NOT move: the page checks the code
    again and shows the move wording (review 15). A first join it cannot keep (unrecordable, unconfirmed, or bound
    elsewhere after a lost answer) is undone with a leave; a lost answer asks status once (reviews 12, 19, 23).
  - `leave()` clears the record first, so the world stops at once, then asks status: it sends the leave only when the
    company names this world on this computer; otherwise it clears locally and sends nothing. Refused as the last
    admin: the record comes back (still joined), and a refusal of a RETRIED leave is said once on the screen.
    org_not_member: left. No answer: a pending leave, sent again on start and daily. Every ending retires the world id.
  - `refresh()` runs on start and daily. It clears the record on `member:false`, or when the company names another
    world. An unreachable coordinator changes nothing.
  - `isEnrolledHere()` is the gate for every later sender (E0.3 telemetry, E0.6 backup).
  - The public error codes become plain sentences.
- `server.js`:
  - `GET /api/org` reports this world's record to the SCREEN only; any other caller (this board's agents included)
    learns only `enrolled` (review 12). It never hands the world id or org id to the page; a record naming another
    world reads as not enrolled; the stopped and leave-refused notes are handed to the screen once.
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
- Sending `consentHash` on enroll (contract v1.4, kosmos-relay audit-5537): the coordinator serves it from E0.8's
  deploy on. A follow-up then keeps the SERVED hash with the consent and sends it back; until that deploy, nothing new is sent.

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

## Review 10 (blind, sonnet)
- FIXED: leave reads status first. A data folder copied to a second computer carries the record and the world id, so
  the local check passes there, and a leave ends the whole membership by account. The leave is now sent only when the
  company confirms this world on THIS computer; a clear "not here" clears locally and sends nothing; no answer leaves
  the leave pending, asked again on the next pass.
- FIXED (board side): the enrollment keeps a hash of the consent words the screen was shown (`consentHash`, sha256 of
  the four lists as cleaned), carried from the preview ticket into the record and kept by refresh. Sending it to the
  company on enroll is a contract change, asked of PigeonPete for v1.4; until then it is checkable on this side only.
- DUPLICATES: the local gate on a copied folder (review 3; the coordinator refuses a signer that is not the enrolled
  computer, org_not_enrolled); agents reading the company name (review 4, decided); isViaScreen (review 2); the raw
  failure line in the local log (review 6, measured local only).
- WORDING: the comments now say the ids are never sent to the page, not that they "stay in the engine" (the files are
  in the world's data root).
- AGREED with PigeonPete for v1.4 (lands in his audit-5537 PR; the board sends nothing until he says it is on a
  branch): the coordinator SERVES `consentHash` beside `consent` in redeem and status, and enroll takes it back
  (409 `org_consent_changed` when the words changed since the preview). Follow-up for the board, not this branch:
  keep and send the SERVED hash instead of the local one, and if cleaning changed any served line, refuse to offer
  Join rather than show words other than the ones hashed.

## Review 11 (blind, opus)
- FIXED (both from review 10's leave change): a leave that ends only on this computer (`localOnly`: the company enrolls
  another world or computer) no longer says "You left"; it says the person is still in the company and to leave from
  the work Kosmos (browser check O9). That branch also retires this world's id, as refresh does for the same answer:
  the two now read one helper, `statusVerdict` ('here', 'gone', 'notHere', 'unclear'), so they cannot drift again.
- FIXED: a failed join puts its ticket back only if no newer screen has fetched one meanwhile (test holds the first
  join at the coordinator while a second screen previews). The ticket lifetime and the daily interval are named
  constants (`ORG_TICKET_MS`, `ORG_REFRESH_MS`). CLAUDE.md's Where to Find Things has a row for company enrollment.

## Review 12 (blind, sonnet)
- FIXED: a join the company accepted but this Kosmos could not record (its data folder not writable) is undone at
  once: the leave is sent, or left pending for the next pass. Before, the company held an enrollment this Kosmos would
  never report under and never show Leave for.
- CHANGED (a repeat finding, now closed rather than decided): any caller that is not the screen, this board's agents
  included, learns only whether this Kosmos is enrolled, not which company. The consent words name the company's
  readers, not this board's agents.
- FIXED: the org routes send the page an allow-list of fields, so a field added to the engine's answer later is not
  sent by default. The local log line also has long hex ids (the world id) replaced, beside the join code.
- WORDING: the route comment now says what isViaScreen enforces (an agent token is refused; browser headers are
  trusted), not that an agent "must never" join.
- DEDUP: isViaScreen as the only person check (review 2).

## Review 13 (blind, opus)
- CORRECTED (a claim of mine, measured): the Kosmos+ signing key lives in the world's data root (`<root>/remote`,
  engine/remote.js), so a FULL copy of the data folder carries it and is the same signer to the company. `thisComputer`
  then cannot tell the copy apart; it catches a world id copied without the key, or a key re-registered on the second
  computer. The comments now say exactly that, and PigeonPete is asked what `thisComputer` is computed from.
- FIXED (from review 12): a record that cannot be written after the company accepted is retried once; then a FIRST
  join is undone with a leave, but a MOVE is not (a leave would end a membership the person already had). Each case
  says only what happened ("undone", "could not be undone yet", or "your company now names this Kosmos").
- FIXED: the hint and Not now no longer say "sends only the code": the check goes through this Kosmos's Kosmos+
  connection, so the company learns which account checked it; what is true is that nothing joins and none of this
  Kosmos's data is sent. A HEAD no longer uses up the one-time stopped note. The log scrub also removes email
  addresses. The module header names the Kosmos+ signer beside the opaque id.
- DEFERRED: preview is not serialized with enroll, leave and refresh. It only reads (redeem, and status for a member),
  so it cannot write a record back over a leave; a later writer from preview must join the queue.

## Review 14 (blind, sonnet)
- FIXED: the consent always shows this Kosmos's own promise under Never ("Your other Kosmoses on this computer are not
  part of this, and none of their data is sent"), whatever the company's list says; an empty list no longer hides
  the exclusions (browser check O10).
- FIXED: a record whose world id file is gone is stale: refresh clears it and asks nothing. An id file that exists
  but cannot be read is left alone, as review 9 required (that test now makes the file unreadable rather than
  deleting it, so the two cases are tested apart).
- NOT A DEFECT, measured and now pinned: a page on another website cannot preview, join or leave. crossSiteWrite runs
  before every route and refuses a POST whose Origin is another site; a browser always sends Origin on a cross-site
  POST. A server test sends the attack shape (cross-site, text/plain) to all three routes; disabling the guard turns
  it red.
- DUPLICATE: the consent hash is kept only on this side until v1.4 deploys (review 10; in Not done here).
- NOTED: an agent can learn whether this Kosmos is enrolled (a yes or no), not which company.

## Review 15 (blind, opus): CONVERGED (NITs only)
- Taken anyway, because each changes what a person reads: the one-time stopped note replaces whatever line is on
  screen instead of being used up unseen (O8 now starts with a line showing); and an enroll refused as
  org_already_member (the person joined from another Kosmos since the preview) no longer moves the enrollment on
  first-join words: the page checks the code again, and the preview then shows the move wording.
- The design-shot fixture no longer repeats "your other Kosmoses" in the company's list, since the board now states
  it itself; PigeonPete is asked to drop it from the coordinator's default list.
- Not taken: scrubbing company names from the local log (it stays on this computer, decided in review 6). Whether
  that log file is shared between this person's Kosmoses was not measured; if it is, another Kosmos's agents could
  read a company name there. Recorded as a known residual.

## Review 17 (on c678010ed, after the full browser checks)
- A first join this Kosmos could not record, whose undo leave also failed, left a pending leave with no record. A later
  pass refused as the last admin cleared it, leaving neither, so this Kosmos never asked again while the company named
  it as the work Kosmos. Now the record is rebuilt from the status answer that just confirmed this world; if it cannot
  be written, the leave stays pending so the next pass asks again (this also covers a failed restore of an existing
  record). Pinned in both arms (each mutation reddens its own assertion).
- render-plus-blue-1615 again counts every #plus-flow field except the one known dark one (#plus-org-code), with the
  control that it is dark: the painted-white count let a near-white field through.
- Messages shown on the page are full sentences.

## Review 18
- A local-only leave (no record here, no pending leave) cleared the record but kept the world id, so a later daily pass
  that found the company naming this world wrote the enrollment back with no consent shown here. It now retires the id,
  as every other ending does. Pinned by a test where the record is gone and the id survives (my first version of the
  test reused a world whose id an earlier pass had already retired, so the mutation did not redden it; rewritten).
- Kept: refresh re-adopting a MOVE that could not be written (intended). Such a record carries no consentHash, and the
  rollup (E0.3) stays dormant without one, so a re-adopted enrollment never reports.

## Review 19
- An enroll with no answer (a tunnel timeout) said "Nothing was joined" though the company may have bound this world.
  It now asks status once: bound here is recorded as the join the person accepted; not bound says nothing was joined;
  an unclear answer says it is not known yet. Two server tests had a fake coordinator that named this world even when
  no enroll went through; they now answer as a real one does.
- A first join the company accepted but did not confirm for this Kosmos (thisComputer not true, or a broken answer)
  is undone with a leave, through the same routine as an unrecordable one (undoFirstJoin). A move is never undone.
- The page's Leave changes the view only on a real outcome (ok, or pending). A refusal before anything was done (the
  route's "not your work Kosmos", the screen check's { error }) keeps the joined view and shows the refusal. Browser
  check O11 pins both; mutating the condition back reddens it.
- Each engine fix is pinned; each mutation reddens its own assertion.

## Review 20
- Kept (decided at review 18): refresh re-adopts an enrollment the company names here when no record is local. That is
  the recovery for a move that could not be written; such a record has no consentHash, so the rollup stays dormant.
  Only server.js's orgEnrollRefresh calls refresh, and only with a record or a pending leave.
- Deferred, decided: one consent ticket for the board. A second screen's preview replaces the first's ticket, and the
  first screen's Join is then refused with org_ticket ("check the code again"): it fails closed with a clear sentence
  and binds nothing. Keying tickets per screen is a follow-up if a second screen (the remote page) ever holds a consent.

## Review 21
- An undo of this Kosmos's own first join that could not be sent was never sent: its retry asked status, which named
  this world on another computer (the reason for the undo), read that as notHere, and cleared locally. The pending file
  now records `undo`, and a pending undo is sent while the account is a member at all. Pinned.
- A person's pending leave, refused later as the last admin, quietly turned back into a reporting enrollment. That
  retry now leaves a one-time note (org-leave-refused.json); GET /api/org hands it to the screen once (screen only, as
  stoppedFor), and the page says the leave was refused and this Kosmos reports again. A refusal the person reads at
  once leaves no note. Pinned in the engine, the server (once only) and the page (O12, as text).
- "Joining was undone" now says the code is used up; a move with no answer that did not land says the work Kosmos did
  not move (not "nothing was joined").

## Review 22
- A stale record cleared because the world id file is gone now leaves the one-time "stopped" note, as the company's own
  stop does, so the screen says this Kosmos stopped reporting. Pinned.
- Kept (decided at reviews 18 and 20): refresh writes the record the company confirms here; one board-wide ticket.

## Review 23 (three fixes to lines review 21 and 19 wrote)
- A pending undo is sent only while the company names THIS world (any computer) or no world. Enrolled as another
  world, the membership is one the person set up since from another Kosmos: cleared here, nothing sent. Pinned.
- An undo refused as the last admin writes no record unless the company named this world HERE; the undo stays pending
  and no "reports again" note is left. Pinned.
- A first join whose answer was lost, which status shows bound to this world on another computer, is undone (not
  "nothing was joined"), as the answered path does. Pinned.
- An undone join returns org_code_used, so the route keeps no ticket for the spent code. Pinned.
- Not done (nit): a retried leave that resolves local-only leaves no note.

## After convergence: the full validation's two guards (2026-10-08)
- tools/test-connector-verbs.sh pins the mac-request callers so a new one re-decides the gate-closed rule. Re-decided
  for engine/orgenroll.js: an older connector refuses the org routes, the engine reads a failure with no public code,
  and the page says checking the code did not go through and nothing is joined. Joining a company never worked before
  these connectors, so nothing that works today breaks. 27/27 with the eighth caller.
- render-fields measured #plus-org-code (the panel's always-dark field) off its navy card, the known wizard artifact
  ("recessed in light, raised in dark"). Skipped by name, as the wizard's are; render-plus-blue-1615 and
  render-plus-signin-3478 pin its fill and text colour on the real tab.

## Review 25 (on the post-convergence guards; found a gap my review 19 left)
- A join with no answer and an unclear status said "not known yet" but kept nothing: no record, no pending marker, so
  nothing ever asked again while the company might hold this world. Now an owner-only marker (org-join-unknown.json,
  with the consent hash shown) makes the next start or daily pass ask once: bound here is recorded with that hash, a
  first join bound elsewhere is undone, not bound clears it, unclear keeps it. server.js's daily refresh runs while it
  exists. Pinned (each mutation reddens).
- That answer and "could not be undone yet" now carry codes (org_join_unknown, org_undo_pending): the route keeps no
  ticket for a code that may be spent, and the page goes back to the code field, so "Not now" can no longer say
  nothing was joined. Browser check O14 pins both.
- Kept (nits): the page keys "joined" on the org name too (the screen always gets it); a refused join leaves its world
  id (sent once, harmless); a daily log line while Kosmos+ is off. Plan name without timestamp (decided at review 9).

## Review 26
- "This screen will show what it learns" promised more than a daily pass: while org-join-unknown.json exists, the
  server now asks every 2 minutes (ORG_UNSURE_MS; only while the marker exists, so a world that never joined still
  sends nothing), and the sentence says "in a few minutes". A start() source pin holds the interval at 5 minutes or
  less; setting it to a day reddens it.
- Kept (nits): an undo refused as the last admin after an unknown join is retried daily without a note (narrow);
  the small marker files are written directly (a torn write reads as no marker); repeated inline requires.

## Review 27 (four more in the uncertain-join paths reviews 19 and 25 built)
- A refusal made on this computer before anything was sent (not connected to Kosmos+, a register or Forget out, no
  Kosmos+ here) was treated as "outcome unknown". engine/remote.js now marks those `notSent` (additive field), as does
  signed() when Kosmos+ is absent; enroll then says nothing was sent so nothing was joined, keeps the ticket and writes
  no marker. Pinned (no marker, status never asked).
- After a timeout, a status read at once can come before the company saved the join. Every timeout not confirmed here
  (or bound elsewhere and undone) is now UNKNOWN with the marker, settled by the 2-minute follow-up. The server test's
  "passing failure" became a not-sent refusal (the ticket kept); a timeout keeps no ticket (pinned).
- The "your leave was refused" note is written only for the person's own leave, never for an undo. Pinned.
- mayReport(): enrolled here AND a consentHash recorded here. The gate for every sender (stated at the function);
  isEnrolledHere stays "is this the work Kosmos". A re-adopted record may not send. Pinned.
- A marker left beside a record is cleared on the next pass. The data-folder message is a full sentence.

## Review 28
- refresh copied the old record's consentHash onto a record rebuilt for ANOTHER world (a copied or restored folder),
  so mayReport passed for a world never shown consent. The hash is carried only when the old record names this world.
- namesThisWorld counted "member, no world enrolled" as this world's join. That is also what the company shows while
  the same account's join from another computer is landing, and an undo then would end it. Only this world's id counts
  now (the timed-out path then stays UNKNOWN and is settled later). Both pinned; each mutation reddens.
- Kept (nits): a re-adopted record shows as joined though it may not report (no sender exists yet; E0.3 decides how
  to show it); no Leave while a join is unknown (consistent: nothing is recorded); the stopped note is said once.

## Review 29
- The 2-minute timer counts from board start, so a settle could run seconds after the timeout and take "not bound" as
  final: the read review 27 guarded against. A marker is settled as NOT made only once it is SETTLE_AFTER_MS (2 min)
  old; "made here" is still recorded at once. Pinned (a fresh marker survives a member:false answer; an aged one is
  cleared); removing the age gate reddens it.
- The "not known yet" sentence promised the screen would show what the follow-up learns, but only "joined" shows.
  It now says: if joining went through, this screen will show it.
- The fast follow-up stops after a day (an unclear marker that long, say Kosmos+ off, falls back to the daily pass).
- A second Check while one is out no longer clears the message first.

## Review 30
- A marker whose time could not be read never settled (its age was NaN) and the fast follow-up polled it forever.
  An unreadable time now counts as old (settled on the first clear answer), and the fast follow-up skips it (the daily
  pass remains). Pinned; the NaN mutation reddens it. Two stranded comments moved onto their functions.
