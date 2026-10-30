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
   (personalbackupkey.js:72) while the pin would be written under the personal root (orgenroll.js:765). Decided: the
   personal key files and the pin both live under the personal root; the personal backup tick has its own gate.
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
