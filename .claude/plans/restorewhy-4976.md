# restorewhy-4976: a refused Restore says why (kosmos#4976)

Written 2026-10-01 23:44 CDT. Base origin/main a7cae2b3e. Filed by me from #4896's round 9 review.

## Cause
The Removed list's Restore handler (web/index.html, the '#removed-list' click listener) answers EVERY failure with
"Restore failed. Try again." and drops the engine's reason (POST /api/agent/:name/restore answers a refusal 400 with
{ outcome: 'refused', because }). Most refusals are not cleared by a retry: the account folder is gone (#2609), the
removed list is unreadable, and from #4896 another agent now holds the folder.

## Change
- A REFUSED restore with a reason: the row reads "Not restored" and the reason goes to #removed-msg (role=alert, the
  region the blocked-row explanation already uses), first letter raised (several engine sentences start lowercase).
  An in-flight "Starting X again" stays beside it, as the blocked-row handler keeps it.
- Any other failure (no body, a 500, a dropped answer): "Restore failed. Try again." as before. True for those.
- The network-failure catch and the projects list's Restore (which already shows its error) are unchanged.

## Decided, rejected
- Rejected: putting the reason on the button. Sentences like the #4896 one are two sentences long; the message
  region is where this list already explains a refusal.
- Weakest premise: that every engine refusal sentence reads right as a standalone line with its first letter raised.
  The current set (remove.restoreInner) all do; a new lowercase-then-name sentence would read oddly, not wrongly.

## Validation
- docs/browser-checks/render-restore-refused-4976.js (new): the refused arm (button + exact message) and a CONTROL
  (a reason-less 500 keeps "Restore failed. Try again." and writes no reason). Queued on Agent1s.
- browser-checks-reason-grep.test.js counts updated deliberately (+2 finding sites, +1 launch catch), measured.
- Page script compile-checked.

## Review 1 (23:48 CDT): 0 BLOCKER, 2 SHOULD-FIX, 3 NITs, all taken
- SHOULD-FIX: the refusal was a THIRD writer to #removed-msg outside the re-assert bookkeeping: it left the blocked
  explanation held (so a later working Restore reprinted a sentence last seen two presses ago), and the explain
  handler and a working Restore wiped the refusal while its row still read "Not restored". Now held as
  RESTORE_REFUSED_SAID / _FOR, re-asserted by all three writers while its row is listed (restoreRefusedStill),
  retired when that row restores, cleared with the others on the arrival. The refused branch re-asserts the blocked
  explanation through restoreBlockedStill (the success branch's own scan).
- SHOULD-FIX: the check cleared #removed-msg between arms, so its CONTROL could not see a stale or wiped sentence.
  Rewritten as one press sequence (refused, reason-less, unavailable, working) with no clearing, asserting after
  each press that every still-true sentence is on screen and nothing reappears.
- NIT: the first-letter raise turned a session name into a name that does not exist ("carl9" -> "Carl9"). Now
  "Not restored: <because>", the engine's words unchanged.
- NIT: the comment and the check presented #4896's refusal as current; the check now uses the real #2609 account
  sentence and the comment says "once #4896 lands".
- NIT: the refused button's accessible name says what pressing it does ("Not restored. Restore Carl again").
  Not taken: re-announcing an identical repeat refusal (clear then set on the next frame); a repeat press of a
  refusal that cannot clear is not news.

## Review 2 (23:50 CDT): 0 BLOCKER, 4 SHOULD-FIX, 1 NIT, all taken
- One held refusal (the most recent, like the blocked explanation): a second refused row replaced the first's reason
  in the region. Each refused row now also carries its own reason as its title (hover and accessible description).
- The refused aria-label outlived its state (a retry, a reason-less failure, a partial). Every press now removes the
  row's aria-label and title first; only the refused branch sets them.
- Leaving the Agents tab blanked #removed-msg but kept the held explanation and refusal, so the next writer
  reprinted them from nowhere. showTab now nulls both (in a try: they are lets declared below showTab, and a showTab
  during load would otherwise throw). The in-flight "Starting X again" is kept: it is still true.
- The refused write was not gated on onAgentsTab(), so a refusal landing after the person left wrote under Settings.
  Gated; still held for their return.
- NIT: a partial outcome now retires that row's held refusal.
- The check gained arms: the refused row's own reason, row 1 keeping it after another press, and the reason-less
  row getting no refusal name or tooltip.
- (Review 2's check notes, taken) The check also covers: a second refusal (newest leads, each row keeps its own), a reason-less retry of the refused row (name and tooltip cleared), and a Settings round-trip (nothing held reappears).

## Review 3 (23:54 CDT): 0 BLOCKER, 3 SHOULD-FIX, NITs, taken
- A refusal landing after the person left the tab was HELD but not written; nothing writes on the way back, so it
  surfaced on a later unrelated press. Now held only when written (on the Agents tab); the row's title keeps it.
- A reason-less retry of the held row left its old refusal in the region while the row said "Try again".
  restoreRetireRefusalOf(name) retires it and rewrites the region without it, from the reason-less branch and the
  network catch.
- The comment claimed every refused row keeps its reason; a list repaint (another agent removed, restored or
  blocked) resets rows to plain Restore. Comment now says so: the row then claims nothing, so nothing false shows.
  Not built: a per-name map that paintRemoved renders. Weakest premise: that a lost older reason is acceptable
  because the row stops claiming "Not restored" with it.
- NIT taken: the try/catch around showTab's assignments protected nothing (the only load-time showTab runs after
  the declarations, and SURVIVAL_HELD is assigned the same way). Removed, comment says why.
- NIT taken: the check now retries Carl while his refusal is the held one (arm 5, asserts the region), and arm 7
  covers a refusal landing off-tab plus a working restore after the round-trip (asserts neither the off-tab refusal
  nor the cleared blocked explanation reappears; the off-tab refusal is on its row).
- (Review 3 tail) Arm 7 asserts the removed list is visible after the round-trip (click works on hidden rows). Not taken: dropping "Not restored." from the aria-label; the visible text must stay in the accessible name (label-in-name), and hearing it twice is the cost.

## Review 4 (23:55 CDT): 0 BLOCKER, 0 SHOULD-FIX = CONVERGED
- It traced every round-3 path and tabled each browser-check assertion against origin/main: every arm fails on main
  or is a stated control, and none can pass for a wrong reason on the fixed page (s5 is sound because s4 first
  proves the refusal was present; s7's negatives test the showTab clears because s6 leaves both sentences held).
- NIT taken: the partial branch retires through restoreRetireRefusalOf (one path).
- NIT left: the arrival clear does not strip the refused row's title/aria-label; the next repaint resets the row.
- First run (00:38, b-4976 on 9b69963ac): arms 1-6 and render-restore-dircheck-2615 GREEN; arm 7 red for a CHECK reason: it re-pressed Fay, restored in arm 4, whose button stays disabled because the stubbed list never repaints the row away. Arm 7 now presses a fresh working row (Kim).
