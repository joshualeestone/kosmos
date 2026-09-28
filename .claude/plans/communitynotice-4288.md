# #4288 part B: the one-time Community notice

## Why

Part A (PR #4323) turned the Community switch ON by default. Mona Lisa's design on #4288 adds a one-time
notice so a person whose default changed is told: "Your agents can post to the public Kosmos community.
Nothing goes out until you release it." with Got it and Change in Settings. Acceptance 2: it shows once.

## The change

- `communityswitch.migrate({ existingInstall })`, run once at board start (the real-start path only):
  with no `community.json`, it writes ON and decides the notice once.
  - An EXISTING install (first run already done when the board starts) had the default change under it,
    so its notice is pending and shows once.
  - A FRESH install is told in first run instead (the install-screen checkbox, Mona's fast-follow), so
    its notice is marked seen. That also keeps the notice off every freshly booted test board.
  - A file already there, readable or not, is left exactly as it is.
- `GET /api/community-setting` also reports `noticeSeen`; `POST /api/community-setting/notice-seen`
  records it and never moves the switch.
- The notice, in What's New's card style, is made when it opens and removed when it closes (the body's
  direct children are the consolidated grid's rows). It opens only when the board says the setting was
  read, is ON and the notice is pending, and only once nothing else is on screen. It records itself as
  seen when it OPENS (What's New's rule). Escape, the backdrop and Got it close it; Change in Settings
  opens Settings > Automation with focus on the switch. Tab stays between its two buttons.
- What's New and the notice each wait while the other is up (`cnHeld` and `wnCovered`), so they never
  stack. Each checks and opens without an await between, so the two cannot both open.
- The modal sweep (web.modal-way-out-1316) names it; its ceiling is 20.
- The part A browser check gains NOTICE arms: opens once and records once; Got it, Escape and the
  backdrop close it; Change in Settings lands on the switch; a seen notice, an OFF switch and an unread
  setting open nothing.

## Review 1

- No blocker. `cnHeld` did not count an open `<dialog>`, unlike `tipModalOpen`; it now uses the same set.
- The Change in Settings fallback (focus the row when the switch is hidden) was untested: an arm makes the
  first read fail and the notice pending, and asserts focus lands on the row.
- Two server.test.js failure messages said the opposite of what they check; reworded.
- Not changed: the reviewer suspected the notice pops up mid-check for the flaky local runs. The board's
  migrate step wrote noticeSeen true and every stubbed arm answers without a pending notice, so that does
  not fit the evidence; it stays under Open.

## Review 2

- No blocker. Focus opened on Got it, so an Enter still in flight could dismiss the disclosure unread; it
  now opens on the box (What's New's rule), and the check pins focus plus Tab and Shift+Tab staying
  between the two buttons.
- On record: part A's card comment rejected "a migration that writes ON into existing installs". Part B
  reverses that, deliberately: only a write at board start can tell an existing install (told by the
  notice) from a fresh one (told in first run). It still runs once and never overwrites a person's OFF.
- Not changed, measured: the review read `migrate()` as running after `server.listen`. The real-start
  block calls it before `start()`, which is where `listen` runs, so no request can reach the board first.

## Review 3

- No blocker. The notice's keys acted even with first run or the update overlay drawn over it; they now
  stand down while covered (`cnCovered`) and are taken in the capture phase and stopped, What's New's rule. An
  arm draws the update overlay over an open notice and asserts Escape leaves it; dropping the guard reds it.
- Only the boot-cover hold was pinned: a HELD arm plants a generic dialog, a first-run backdrop and the
  update overlay before the page's script runs, asserts no notice and no record, then removes it and
  asserts one of each.
- Two tabs loaded together each show it once; accepted as What's New accepts it, and now said in a comment.

## Review 4

- BLOCKER, fixed: the notice read the setting once, then could wait up to an hour behind another window
  and open on that stale answer, so a switch turned OFF in another tab meanwhile still got a notice and a
  "seen" record. After any wait it now reads the setting again (`cnPending`); a STALE arm turns the switch
  OFF during the wait and asserts nothing opens and nothing is recorded.
- Not in this diff: What's New has the same boot-cover gap (its `held()` does not wait for `#boot-cover`).
  Filed as its own card, with the one-line fix, rather than widening this PR into What's New.

## Review 5

- Converged: no blocker, no warning. Two NITs:
  - `migrate()`'s refusal on a stat error other than ENOENT was untested. Pinned with a link that points at
    itself (ELOOP). A locked folder was tried first and could not tell refusing from trying, since the
    write fails there too; the mutation passed it, so it was replaced.
  - `dialog[open]` in `cnHeld` is unexercised: no `<dialog>` exists on the page, and it mirrors
    `tipModalOpen`. Noted, not acted on.

## Weakest premise

That a FRESH install is told in first run. The install-screen checkbox that does that is Mona's
fast-follow and is not built yet, so until it ships a fresh install learns about the Community only from
the Settings row. The alternative, showing the notice after first run on fresh installs too, would cover
every browser check that runs on a freshly booted board, and the Settings row states the same promise.

## Open

On this Mac the part A browser check failed in 5 of 13 local runs, in ways that point at the page going
away at load (`showTab` undefined, a click that never lands). An instrumented rerun saw no reload, crash
or page error in three runs, and CI's own runner ran the part A check green. Not explained yet; recorded
rather than retried away. Narrowed since: every local failure is at page load (a `goto` that never
reaches network idle within 30 s, or an evaluate before the page's scripts ran), never an assertion about
the switch or the notice. The board answered in under 0.3 s throughout, and the machine's load average
was 7 to 12 during the failures; but some green runs were at 9 to 10 too, so load is a lead, not a cause.
**Found (05:17 CDT, 09-28):** the cause is `#boot-cover` (z-index 70, over everything) staying up until first run's
check answers, and that check is live and slow on a loaded machine. Clicks made before it lifts land on
the cover. That also exposed a product gap: the notice could open, and record itself as seen, while
hidden under the cover. `cnHeld` now waits for the cover, a BOOT arm pins it (first-run held 4 s: no
notice and no record under the cover, then one of each), and the check's `load()` waits for the cover
instead of sleeping. The check also no longer uses `networkidle` or fixed sleeps before its reads.
Residual, measured: on this Mac a page load swings from under 4 s to about 35 s with what else is running
(the same page on a fresh main board, a fresh part B board and a 2.5-hour-old one all measured 4 to 12 s at
06:14; the 35 s load was one of these boards an hour earlier). One of three hardened runs still hit the
check's 60 s load ceiling. That is the environment, not a notice or switch assertion, and it is left as
a stated limit rather than hidden behind a larger timeout.
