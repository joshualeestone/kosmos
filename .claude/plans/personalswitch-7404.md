# personalswitch-7404: turning a personal backup on, board side (kosmos#7404)

The coordinator side is built: `POST /v1/mac/personal-backup` makes the account's personal org of one and answers its
words (as redeem does); the existing codeless `POST /v1/mac/org/enroll` binds this computer as its enrolled computer;
member-key registration and `/mine` are personal-aware (relay #691, #702, recoverytag-7404). The connector learns to
sign the two new routes in relay tunnelroutes-7404. The board has the recovery code and key half
(engine/personalbackupkey.js, kosmos #7643). Nothing on the board turns a personal backup on yet.

This slice is the ENGINE of switch-on only: preview (the words), enroll (bind this computer), set up the key (the
recovery code to show). No screen yet; the screens come next and need their own design review.

## The problem this plan must decide

`engine/orgenroll.js` is the company (and family) enrollment. It knows two kinds: `kindOf` maps every kind that is
not 'family' to 'company'. Its record (`org-enrollment.json` under store.ROOT) is read by nine modules: agentevents,
backupmemberkey, backuptick, orgkeypin, orgrollup and orgrollup-child, orgpolicy, policy, and server.js (about 10
places). If a personal org were enrolled through it as-is, the board would treat it as a company: company words,
`mayReport` true (rollups and agent events the coordinator refuses for a personal org, every tick), and orgpolicy's
company policy machinery reading it. That is the class of bug in my memory "a new org kind sweeps membership reads"
(sso.rs once read any membership as another company).

## Options

A. **A third kind inside orgenroll.** `kindOf` learns 'personal'; every consumer gates on it (no reports, no company
   policy, personal words, backuptick picks the personal key path). Reuses all of enroll's hard-won robustness
   (lost-answer recovery through status, join-unknown and its follow-up, undo of a first join, the computer print).
   Cost: every reader must be gated, and the failure mode is a reader that is not, silently treating a personal
   backup as a company. Nine modules, about 40 'family' branches to mirror.

B. **A separate module and record, its own enroll.** personalbackup.js calls personal-backup, enroll, status and leave
   itself. Isolation by construction: no company reader can see it. Cost: it re-implements the lost-answer logic,
   which took orgenroll dozens of review rounds (#5531 reviews 19 to 37), and would get it wrong in new ways.

C. **Reuse orgenroll's functions with a separate data root.** Every orgenroll function takes `opts.root`
   (storeRoot); orgrollup already uses it. personalbackup.js calls `orgenroll.preview`-like personal-backup itself (a
   new route), then `orgenroll.enroll(null, true, { root: <ROOT>/personal-backup, consentHash, wordsShown: true,
   computerSalt, orgId, orgKind: 'personal' })`. The record, the world id, join-unknown and the consent file land under
   that root; every company reader reads store.ROOT and sees nothing. Reuses the robustness, isolates by path.

## Recommendation: C, with these conditions (each to be checked in review)

1. **Words.** enroll's refusal sentences name "your company" (inKind maps non-family to company). The personal module
   never shows orgenroll's `because`; it maps the returned `code` (and `unknown`, `notSent`) to its own sentences.
2. **A separate world id.** The personal root mints its own `org-world-id`. The coordinator binds that id; nothing
   else on the board ever sees it. Premise to check: nothing in the coordinator or the upload path compares the
   enrolled world with anything else this Kosmos sends (backup grants check `enrolled_mac`, the computer, not the
   world).
3. **The follow-up timer.** server.js follows up a join-unknown every two minutes, for store.ROOT only. A personal
   join-unknown is followed up by the personal module itself (on its next call), or the person presses again; the
   enroll is safe to repeat (codeless, same words).
4. **Leaving.** `orgenroll.leave` with the same root ends the membership; the personal module wraps it.
5. **Policy.** No company policy reads the personal root. A personal backup never applies a policy.
6. **Mutual exclusion.** The coordinator already refuses personal-backup in a company or family
   (personal_backup_in_org), and a company invite while personal (org_other_org). The board says so in its own words.
7. **Then the key.** After the enroll records "here", setUpPersonalKey (kosmos #7643) makes the recovery code; its own
   pending-code file covers a lost answer there.

## Rejected

- A: the failure mode (an ungated reader) is silent and lands in company-facing code that has nothing to do with
  personal backup. C makes the same mistake impossible rather than reviewed for.
- B: re-implementing lost-answer recovery is the most review-expensive code in this area, for no isolation gain over C.

## Weakest premises

- That orgenroll's functions honour `opts.root` EVERYWHERE they touch disk (a single hard-coded store.ROOT read inside
  enroll would put the personal record where company readers see it, or read the company record during a personal
  enroll). Must be measured by grep and by a test that enrolls under a temp root and asserts store.ROOT is untouched.
- That a second world id is harmless (condition 2).
- That orgenroll's internal side effects on enroll (onEnrollmentEnded listeners, consent memory, reportPrint) do not
  fire company behaviour for the personal root.

## Checked so far

`POST /v1/mac/org/status` answers any membership (org.rs mac_status), so enroll's status-based recovery works for a
personal org.

## Design review 1 (skeptic, blind, 15:1x 10-30): C holds, with these conditions (all now REQUIRED)

The review found three blockers and five warnings in C as written above. It still prefers C to A ("A's ~40 gated
branches across nine modules carry the same silent failure mode across far more code"), on these conditions:

1. **Policy is injected inert.** orgenroll's policy calls ignore `opts.root`: `policyMod(opts)` defaults to orgpolicy,
   whose files are fixed at store.ROOT (orgenroll.js:131; orgpolicy.js:47-50). clearEnrollment, endForeignPolicy and
   applyPolicy would then clear or replace a COMPANY policy from a personal enroll, refresh or leave (blocker: a lost
   personal Leave, retried after the person joined a company, wipes the company policy). The personal module always
   passes `opts.orgpolicy` as an inert stub; a test seeds a store.ROOT policy and asserts it survives a personal
   enroll, refresh and leave.
2. **The personal module owns its words and hash.** The personal words have `reports: []`, `backsUp: []`, so
   orgenroll's cleanConsent returns null and servedHash yields no hash (orgenroll.js:237, 264); enroll then sends no
   `wordsShown` (630). It never uses orgenroll's preview, reviewHere, cleanConsent or servedHash for these words. It
   validates the coordinator's 64-hex hash itself, REFUSES to enroll without one, and always passes `orgId`,
   `consentHash` and `wordsShown: true`. This also closes blocker 2: a codeless enroll moves whatever enrollment the
   account has (org.rs:1266, 1361), so if the account joined a company between personal-backup and enroll, only the
   hash check (org.rs:1283) stops the company's binding moving here; with the personal hash always sent, the
   coordinator refuses (org_consent_changed).
3. **Its own follow-up and its own ticket.** server.js follows up join-unknown and pending leave only for store.ROOT.
   The personal module runs its own (on start and every two minutes while either is pending, through
   `refresh({ root, orgpolicy: stub })`), and the personal screen gets its own ticket, never ORG_TICKET.
4. **One root for the personal key path.** backuptick's gate and backupmemberkey's key-pin check read store.ROOT
   (backuptick.js:328, backupmemberkey.js:151), and personalbackupkey's files live at store.ROOT
   (personalbackupkey.js:72) while the pin would be written under the personal root (orgenroll.js:765).
   **Re-decided while building (15:5x):** the key files STAY in store.ROOT/backupkeys. Each file is named by a hash of
   (org, member) (backupmemberkey.js readKeys/writeKeys, personalbackupkey.js pendingFile), so a personal key and a
   company key cannot collide, and the personal path never reads the key pin (personalbackupkey.js has no orgkeypin
   call; only backupmemberkey.ensureMemberKey's company path checks it). Moving them would split one person's keys
   across two roots, which is more to get wrong at restore. The pin written under the personal root is never read.
   **Rule for later:** if a pin check is ever added to the personal path, it must read the personal root. The personal
   backup tick (a later slice) has its own gate, never backuptick's mayBackUp.
5. **agentevents STOPS cross-talk.** markWithdrawn bumps a process-wide STOPS before reading the root
   (agentevents.js:1056-1072), so a personal clear can make an in-flight company tick write `withdrawn: true` and send
   nothing. Fixed in this slice: markWithdrawn touches nothing when its root holds no agent-events state.

Decided, not changed (recorded so nobody re-derives it):
- **A sibling Kosmos on a company work computer still gathers a personal-backup Kosmos into the company rollup**
  (orgrollup-child reads holdsEnrollment on the default root). That is today's behaviour for any Kosmos on a work
  computer that is not itself enrolled, and it follows Josh's 2026-10-09 ruling that a work computer is company
  property. Personal backup does not change it. Weakest point: a person may expect "personal" to mean "not gathered".
  The screens' words must not promise otherwise.
- **Two Kosmoses, same account, both turning personal backup on:** the second enroll moves the binding (one computer
  at a time, as designed); the first's record goes stale until its own follow-up reads status. Covered by condition 3.
- storecheck's restore guard does not cover a `personal-backup/` folder; recorded for whoever adds it to FOLDERS.
- A coordinator-side hardening (the codeless enroll for a personal org requiring the hash, so a hashless board cannot
  move a company binding) is worth a relay card; condition 2 closes it board-side meanwhile.

## Code review 2 (blind, 16:2x 10-30): two blockers, five warnings. TO DO, in this order

1. **DONE (f87954d47b; 4 mutants red: no end on decline, no enrolled check, no kind check, no follow-up end). BLOCKER, preview leaves a membership nothing ends.** Built: a preview marker; decline, an expired ticket (follow-up past ten minutes, hourly after a day) and an off with no record read status and leave only an UNBOUND personal org (enrolled null, the marker's org when there is one); a personal org another computer of the account runs is never left. Relay card still to file. The coordinator's personal-backup (org.rs mac_personal_backup)
   MAKES the membership at preview. Decline, an expired ticket, or switchOff with no record send nothing
   (orgenroll.js:956-961 clears locally), so the account stays in its personal org and every company or family invite is
   refused org_other_org. **Decided (board side, now):** on decline, expiry, or an off with no record, read status and
   send a leave ONLY when status names an org of kind 'personal' (never a company's or a family's), under the personal
   root. Weakest premise: a race where the account joins a company between that status read and the leave; mac_leave
   ends whatever membership exists. **Relay follow-up (card it):** a personal membership with no enrolled computer
   should never block a company or family join (end it at that join), which removes the race and the stranded state.
2. **BLOCKER, personal refusal codes read as "unknown".** orgenroll.codeOf matches only its own SAY codes
   (orgenroll.js:447-452), so personal_backup_words_unseen (and the other personal codes) fall into the lost-answer path:
   a status read, org-join-unknown.json, two-minute follow-ups, "not known yet". Fix: orgenroll's SAY learns the
   personal codes (neutral words; personalbackup maps them to its own), with a test that a coded personal refusal
   writes no join-unknown and is told as refused.
3. WARNING: a pending LEAVE is followed up every two minutes forever: leaveNow rewrites org-leave-pending on each try, so
   its mtime never ages. Use the join-unknown's own `at` (as server.js:26888 does) and treat a pending leave as hourly
   after its first day (store the first-seen time in this module).
4. WARNING: the key-ready marker is stale after an ending that was not a switchOff (a refresh that finds the
   membership gone). Record org and world in it and compare in state(); clear it at the start of switchOn.
5. WARNING: switchOn's generic "did not bind ... try again in a minute" is wrong for: bound but the record write failed
   (orgenroll.js:752), data folder unwritable (620), answered but not confirmed (719); and the ticket is kept there
   though Kosmos+ was reached. Map each to its own sentence and spend the ticket when Kosmos+ answered.
6. WARNING: the idle guard is NOT equivalent (my claim was wrong): a refused enroll leaves a world id with no record, and
   then refresh DOES send a status read (probe P2: member:true). Keep the guard and test it with a world id present.
7. WARNING: no test of the fast follow-up path (a pending join or leave) or of a coded refusal through switchOn.
NITs to take: followUp checks liveExecutionAllowed() as orgEnrollRefresh does; an in-flight guard; setUpKey's because
in plain words; peek-then-delete is not atomic for two concurrent switchOn calls (claim the ticket synchronously).
