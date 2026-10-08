# rollup-5532: the rollup a work Kosmos sends its company (#5532, Enterprise E0.3, board side)

Umbrella #5529. Coordinator side: PigeonPete, kosmos-relay `.claude/plans/rollup-5532.md` (route
`POST /v1/mac/org/rollup`, Mac-signed; codes org_not_member, org_not_enrolled, org_bad_world, org_rollup_bad,
org_rollup_too_big, replayed). Stacked on #5531 (orgenroll-5531: `isEnrolledHere()`, the world id) and on
usageprice-5532 (the price table). Rebased onto main once both merge.

## What this branch builds
- `engine/orgrollup.js`:
  - `build(input)`, pure: the contract body from plain fields only (names, provider, model, a status word, token
    counts). Every string through externalName, 120 max. At most 200 agents, 200 projects (50 names each), 7 days of
    40 usage rows; the serialized body is trimmed to 56 KB (oldest usage day first, then projects, then agents);
    anything left out, or a partial read, sets `truncated: true`. `costUsd` from engine/usageprice.js, null when a
    model has no published price, never 0.
  - `gather(sources)`: the board's agents (running cards from the status snapshot, then the offline list with
    /api/status's own filter, as `stopped` with no model), minus agents whose removal hides the card; projects with
    members mapped to the names the board shows; usage `byDay` only (never `byFolder`, whose keys are paths); last
    active as the latest per-agent working sample. A partial pane read withholds the offline list, as /api/status does.
  - `tick()`: sends only when `isEnrolledHere()`; daily, and on a change to the agents or projects at most every 10
    minutes; quiet for an hour after a failure; refused as org_not_enrolled or org_not_member, it asks the company at
    once (orgenroll.refresh), which stops this world on a clear answer.
- `server.js`: `orgRollupTick` a minute after start and every 5 minutes, one at a time, and only in the enrolled world.

## Decided
- Status words: the THREE the consent names, "working, waiting or stopped" (review 6; was five). Working: working,
  restarting. Stopped: stopped. Waiting: everything else on the board, so the company is never told an agent hit a
  rate limit, lost its account or connection, or could not be read. AGREED by PigeonPete 2026-10-07 22:09: the
  contract enum is working | waiting | stopped (anything else is org_rollup_bad).
- Provider of a usage row from its model id (claude, gpt/o-series/codex, gemini, grok, llama); unknown is null.
- Weakest premise (measured now, was assumed): usage. It is withheld rather than scoped. Second: gather() repeats /api/status's offline filter (not removed, a folder or a job, not seen, not
  hidden by removal) rather than calling the route, whose 600 lines also build display-only fields. If that filter
  changes in the route, this copy must change with it.

## Review 1 (blind, opus)
- BLOCKER, FIXED by withholding: engine/usage.js reads every Claude config folder on the computer (status.configRoots:
  ~/.claude, ~/.claude-*, CLAUDE_CONFIG_DIR) with no filter by world or agent, so its per-model numbers include the
  person's other Kosmoses, their personal accounts and their sessions outside Kosmos. The rollup now sends
  `usage: []` (with `usageWithheld: true` since contract v1.1; `truncated` stays for real cuts) and does not run the scan at all (which also ends a rescan on every 5-minute
  tick). A test plants another session's transcript, proves the computer-wide reader sees it (control), and proves
  the rollup carries none of it; putting the reader back reddens it.
- Consent: the coordinator's `consent.reports` lines must name what is actually sent. Today that is agent names,
  providers, models and status words; project names and their members; last active. NOT usage, until a reader scoped
  to this world exists. Told to PigeonPete, who owns the words.
- `providerOfModel` is a best guess from the model id (claude, gpt and o-series and codex, gemini, grok, llama);
  unknown is null.
- A record gone between the gate and the read returns "not sent" instead of throwing.

## Review 2 (blind, sonnet)
- FIXED: the offline list now requires `profile: true`. survey() also returns stray rows (a folder in the shared
  workers root that no profile in THIS world accounts for, which can be another Kosmos's agent or any folder someone
  made); those were sent as agents named after the folder.
- FIXED: an agent's model is sent only when it names a known family; the running model is read off a pane.
- MEASURED, not a leak: the status snapshot drops another Kosmos's sessions (status.js, agentNameFromSession answers
  null for another world); activity records live under this world's own data root (activity.js DIR = store.ROOT).
  So agents, projects and last active are this world's. Usage was the one computer-wide reader (review 1).
- Consent words (PigeonPete, kosmos-relay#310): reports = agent names, provider and model, working/waiting/stopped;
  project names and their agents; when you were last active. backsUp is empty until E0.6. When the scoped usage
  reader ships, the words change, the consent hash changes, and v1.4 asks every member to accept again: a board must
  not send usage under an enrollment whose consent hash predates the usage words.

## Review 3 (blind, opus)
- PARTLY FIXED (corrected by review 5): status words left the change signature, but the model stayed in it, and a
  running agent carries a model while a stopped one does not, so starting and stopping still sent changes.
- FIXED: tick() checks the enrollment again right before sending, so a leave that lands while the board is read
  stops the send (the person has been told this Kosmos stopped reporting).
- FIXED, safe by default: tick() sends only when the enrollment records the report lines the person accepted. Records
  written by #5531 do not carry them yet, so NOTHING is sent until a follow-up keeps the accepted lines (from the
  consent shown) with the enrollment. A missing consent is never read as a yes.
- FIXED: a paneless card takes its recorded runner (it was reported as anthropic); archived projects are not reported;
  codex matches only at the start of a model id; the state file is written temp-then-rename; requires at the top.
  CLAUDE.md has a row for the rollup.
- AGREED with PigeonPete (rollup contract v1.1): `usageWithheld: true` while usage is withheld (usage then must be [],
  and the console says "usage not reported yet", never 0); `truncated` means only a real trim or a partial read.

## Review 4 (blind, sonnet)
- FIXED: a model is sent only when the WHOLE string is one model-id token (lower-case letters, digits, . _ : -) of a
  known family; a pane line with text after the id is sent as null.
- FIXED: the sender's timing belongs to one enrollment (world, org, enrolled at); a new one starts fresh.
- FIXED: a card with no shown name is not sent (never the internal session name), and the body says partial.
- DEFERRED to the consent follow-up: tie the accepted consent to this body's field set, so a field added later cannot
  ride an older acceptance (v1.4's served hash changes whenever the words change; the board will refuse a send whose
  recorded hash is not the one served with words naming every field it sends).

## Review 5 (blind, opus)
- BLOCKER (mine, from review 3's fix), FIXED: the change signature is now WHICH agents there are (name, provider) and
  the projects, sorted; nothing that moves when an agent starts, stops, works or waits. The reviewer measured four sends
  in 33 minutes from one agent starting and stopping; a test now runs that exact sequence and expects one daily send.
- FIXED: a partial read is never a change; the attempt is recorded BEFORE sending and an unrecordable one is not sent
  (an unwritable data folder would otherwise send a full body every tick); last active is sent as the day only; an
  unreadable runner sends provider null, never anthropic; the body is built once with its reason.
- TODO PINNED: the consent follow-up must check that the accepted lines cover every field build() sends; a test.todo
  names it so it cannot land as "a non-empty list is enough".

## Review 6 (blind, sonnet)
- FIXED: status narrowed to the consent's three words (above). A model id is a known family and at most six short
  version parts; a long tail after the family is not sent.
- PINNED as test.todo (both must land before any send is enabled): the accepted lines must cover every field sent,
  bound to the served consentHash; and the per-computer fingerprint (v1.5), since a copied data folder carries the
  enrollment, the world id and the Kosmos+ key.
- NOTED for the consent words (PigeonPete): project and agent names are sent exactly as the person typed them.

## Review 7 (blind, opus)
- BLOCKER, FIXED: a project linked from another Kosmos (federation: someone else's project joined here as `member`, or
  one from another computer of this account as `self`, which may be a personal Kosmos) was reported by name. Any
  project with a federation link is skipped now; a test plants one with a control.
- FIXED: the real runner lookup falls back to claude (create.recordedRunner), so "provider null, never a guess" was
  only true in the test stub. The board's source now answers null when neither the launch job nor the profile names
  a runner; a real-store test pins both arms (null for nothing recorded, codex for an openai profile).
- (SUPERSEDED 2026-10-08: the words are kept by hash in org-consent.json and refresh keeps only consentHash and computerSalt; see "Carried onto main and wired".) FIXED: orgenroll.refresh keeps the accepted report lines on the record (it rebuilt the record and would have
  dropped them, silently stopping the rollup once the consent follow-up lands).
- FIXED: a model id's parts must be version numbers, known tier words or an 8-digit date; an alias named after a
  client (gpt-4o-acmecorp-pilot) is not sent.
- NOTED: the model is sent only in the daily body, for an agent running when it is built.

## Review 8 (blind, sonnet)
- FIXED: usage rows' model keys take the same model-id rule as agents; a key that is not one (a path, a client-named
  alias) drops the row.
- FIXED: usage is sent only when the enrollment records `usageConsented: true` (set by the consent follow-up when the
  accepted words name usage). Adding a usage reader to the sources cannot turn usage on by itself.
- DUPLICATES: consent coverage of every field and the per-computer fingerprint (both pinned as test.todo; nothing is
  sent until they land); names as typed (consent wording, with PigeonPete).

## Review 9 (blind, opus)
- FIXED (both from my own fixes): the change signature is agent NAMES and projects only (a provider differs between a
  running card, read from its pane, and a stopped agent with nothing recorded, so it moved on start and stop); and the
  (SUPERSEDED 2026-10-08, as above) refresh keeps consent fields from one list (`CONSENT_FIELDS`: consentHash, reports, usageConsented), since
  usageConsented, added in review 8, was dropped the same way reports had been in review 7.
- FIXED: stale wording (test title, the plan's truncated-for-withheld sentences, the module header); `tryAt` is
  documented as a write probe.

## Not done here
- (Done 2026-10-08, by hash: see "Carried onto main and wired".)
- A usage reader scoped to THIS world's agents (their transcripts or launch folders only), so `usage` can be sent.
  Until then the company sees no tokens or cost from this board, and the body says usageWithheld.
- The per-computer fingerprint (contract v1.5, agreed 2026-10-07): a full copy of the data folder carries the Kosmos+
  key, so the company cannot tell it from the real computer. Next piece: sha256(salt from status + IOPlatformUUID or
  MachineGuid), sent on rollup, enroll and leave once the coordinator accepts it, and the "looks like a copy" screen.
- policyVersion is sent as null: no policy version exists on the board yet.
- backup.lastOk is null until E0.6.

## Tests
- `engine/orgrollup-5532.test.js`: the body's shape and status words; a planted secret and planted content in every
  field a record carries (task, transcript, folder, description) never reach the body; bounds and the byte cap;
  gather's agent list, project names, partial reads; the sender's gate (a Kosmos that never joined sends nothing),
  timings, quiet hour, and a refusal that makes it ask. Every guard was mutated and reddens.

## Carried onto main and wired (2026-10-08)
The dormant branch (head 9bf14764f; reviews 1 to 9 above) was re-applied onto follow-up b (consenthash-5531,
PR #5604) with main merged in (#5531, #5556, #5565, #5571 all merged), then wired:
- **Gate:** tick() runs only when `orgenroll.mayReport()` holds: the work Kosmos, with the company's served consent
  hash recorded on this computer (b). It is re-checked right before the send, against the same hash.
- **The accepted words, by hash:** `rememberConsent` writes `org-consent.json` ({consentHash, reports,
  usageConsented}) from the words the screen showed (the server's ticket), BEFORE the enroll is sent.
  `acceptedConsent` returns them only for the hash on the record. So the paths that carry only the hash find them
  without carrying them: a lost answer settled later, an undo refused and rebuilt, the daily refresh. No file, or
  another hash, sends nothing. The file goes when the world id retires.
- **Usage:** consented only by accepted words naming token usage (the coordinator's `CONSENT_NAMES_USAGE` rule, keyed on
  token/usage/cost). Today's words do not, so usage stays withheld. The usage reader (#5571) is not wired into
  gather() yet: it would be dead code until the words name usage.
- **Rollup 409 org_consent_changed:** the company holds other words now. `consentWithdrawn` drops the record's hash, so
  this Kosmos stops reporting and the joined view says it sends nothing. The membership is untouched. Accepting the
  new words is #5531 follow-up a0 (orgreview-5531).
- **The computer print (v1.5, #5565), from orgenroll.js only:**
  - **Join:** `computerPrint` and `computerSalt` (the salt from redeem or status, through the ticket). The company is
    the one whose consent was accepted (review 39 refuses an answer naming another). The salt is recorded.
  - **Leave:** the print for the record's salt and company; an undo with no record uses the join's own, kept in the
    pending-leave file so a retry still has it.
  - **Rollup:** the print for the record's salt and company.
  - **Retrying or malformed:** a read still retrying (`later`) or a malformed salt or company (`error`) sends nothing. A
    join says so; a leave stays pending; the rollup waits for the next tick (not a failure).
  - **Allowlisted:** orgenroll.js is the print module's first allowed loader, with its two guards in
    `engine/orgenroll-print-5532.test.js`: nothing logged carries a print, the id or a body with one (captured, plus a
    source scan); every print is for the record's company. The print's FIRST_CALLER_5532 excuse is gone.
- **Field coverage (review 6's todo), decided rather than built:** the board does not match consent lines to body
  fields. The words are the coordinator's: it serves them with their hash, writes them for the contract's fixed field
  set, refuses a rollup unless the hash accepted here is the one it serves now (v1.4), and stores only the worded
  fields. A board-side text match would be a second, drifting copy of that rule. The todo stays as the record of the
  question. Weakest premise: that the coordinator's words keep naming every field the contract carries; a field added
  to the contract without a consent line is the coordinator's to refuse.
- **Weakest premise:** a synchronous ioreg read can block the board for up to five seconds on a join, a leave or a
  rollup tick, at most once a minute while reads fail and once an hour after giving up. Accepted here; an
  asynchronous read is the alternative if it is measured as a problem.


## Review 10 (blind, Opus), on the carried and wired branch
- FIXED (BLOCKER, mine): the print guard test's fake ioreg text tripped the repo-wide raw-read guard. My earlier green
  run was before the file was tracked, and that guard lists TRACKED files. The test is now a named exclusion with its
  reason (its fake text reaches the module only through `_testRunner`).
- FIXED (BLOCKER): duplicate names. The coordinator refuses a whole rollup listing an agent or a project twice, and the
  board allows both, which meant a silent hourly refusal forever. Agents are now kept once by cleaned name (the first
  wins; the body says it was trimmed), and same-named projects are sent as one with their agents together. A test uses
  the coordinator's own refusals as the oracle.
- FIXED: the joined view said "reports" for a record with a hash but no remembered words. It now asks the same question
  tick() does (`acceptedConsent`).
- FIXED: the words file had one slot, so a failed or stale join attempt could take away the words the record reports
  on. It is now keyed by hash, with a few kept, and the record's own hash is never dropped.
- FIXED: a change send carried status and model. It now carries neither: they ride on the daily send only, as the
  contract and the comments say.
- DECIDED (field coverage, see above): the coordinator's hash binding, not a board-side text match.
- NITs taken: the comment placement in the ticket; the CLAUDE.md row; the join code is checked before the hardware read.
- Each fix's mutation makes it fail.

## Review 11 (blind, Sonnet)
- FIXED (my review-10 change made it live): change sends no longer carry status, so they must not move the daily clock.
  The daily send has its own `dailyAt`, written only by a daily success; older state falls back to lastAt once. Test:
  a change send between two days does not delay the next daily.
- FIXED: `consentWithdrawn` acts only when the record still carries the hash the refused report was sent under, so a
  join made while that request was out keeps its words. Test.
- NITs taken: one read each in the /api/org reporting check and in rememberConsent; superseded plan lines marked;
  refresh keeps the print's salt only for the same company id.


## Review 12 (blind, Opus)
- FIXED: the record rebuilt after an undo is refused as the last admin got its consent hash but not the print's salt.
  Its rollups then went without the print, which the company refuses and logs against the real computer as a copy,
  hourly. It now takes the salt from the pending-leave file (same company only). Every record-building path was checked
  for the class: the join, the lost answer settled later, refresh (same company), and this rebuild all carry the salt.
  Test; the mutation makes it fail.
- NITs taken: the servedHash comment is back above its function; NAMES_USAGE says it is deliberately narrower than the
  coordinator's substring match (a disagreement only withholds); the print tests use gather()'s real source shape; the
  field-coverage todo is now a decided note.

## Review 13 (blind, Sonnet)
- FIXED (latent until usage is consented): a usage row with tokens and no model id the board vouches for is dropped,
  and now the body says it was trimmed, so the company never reads an undercount as whole. Test; the mutation makes it fail.
- NITs taken: a leave falls back to the record's salt if the pending-leave file could not be written; NAMES_USAGE says
  it cannot see negation.
- NITs kept: gather() every five minutes (it is the change detection); an offline agent with no shown name is sent by its
  profile name (skipping it could drop real agents; `profile === true` rows only).
