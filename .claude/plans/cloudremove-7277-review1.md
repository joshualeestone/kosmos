# kosmos#7277 review 1 (blind, CTO lens + design)

Reviewed: 127593b337fd5b444610d634167adbb1d4c4fa2b

Counts: 0 BLOCKER, 1 WARNING, 3 NIT

## Findings

### [WARNING] web/index.html:20056 (and engine/remote.js:1025, server.js:11466): the Kosmos+ switch still locks a cloud machine's person out, in one click with no confirm
Failure scenario: on a Kosmos cloud machine the person opens Settings, Kosmos+, through the relay and presses the
`#plus-switch` toggle (it reads as "on/off", Josh's #4080 design). The page sends PUT /api/remote {on:false};
remote.setOn writes on:false to remote.json and calls ensure(), which sees `read().on` false and stopChild()s the
tunnel. The browser that sent the click was reaching the board through that tunnel, so the page goes dead, and the
setting is persisted, so a reboot does not bring it back. Nothing on the box can be reached to switch it on again.
That is the same harm this card closes for Remove, by a shorter path (no confirm dialog at all). Neither the page
nor the route checks onCloudMachine/isCloudMachine for it.
Weakest premise: that the cloud box's tunnel is the board's own child (remote.js startChild) rather than a separate
service the installer runs. The latch living in remote.stateDir() and clearStateDir's #4903 comment both point to the
board's tunnel, but I did not see the installer.
Fix: the same option (a) treatment, either in this PR or as a named follow-up card: hide `#plus-switch` on a cloud
machine (or show it on and disabled with one line why), and have PUT /api/remote refuse `on:false` with 409
{cloud:true} when cloudMachine.isCloudMachine(), with a Mac control. The card's "Done when" only names Remove, so a
follow-up card is acceptable, but it should be filed before Kosmos Cloud is switched on.

### [NIT] web/index.html:55474: plusForgetArm(false) unhides #plus-forget-go unconditionally, and paintPlus does not hide #plus-forget-kept on a cloud machine
Failure scenario: a cloud board carrying a `forget_kept` from before this change, with Plus off, paints the kept box
(paintPlus line 54164 only clears it when on===true or not enrolled). Try again / Remove from this computer only
reach plusForgetRun; the server now answers 409, the `!ok` branch calls plusForgetArm(false), which sets
`#plus-forget-go.hidden = false`, so "Remove this computer" reappears beside the cloud sentence until the next
5-second repaint re-hides it. Harmless (the route refuses), and practically unreachable (Plus off means the person
cannot reach the board), so a NIT.
Fix: in plusForgetArm, `if (row) row.hidden = on || onCloudMachine();`, and in the paintPlus cloud block also
`plusForgetKept(false)`.

### [NIT] docs/browser-checks/render-plus-panel-3829.js:647: the Mac control never asserts the cloud sentence is hidden
Failure scenario: a mutant that leaves `#plus-forget-cloud` visible everywhere (for example `why.hidden = false`, or
the `hidden` attribute dropped from the markup with the paint line removed) shows "This is a Kosmos cloud machine"
on every Mac and PC and passes: the connected pane checks Remove is visible but not that the sentence is absent, and
no page test lifts the new block.
Fix: beside line 647 add `chk(!(await vis('#plus-forget-cloud')), ...)` on the non-cloud pane.

### [NIT] web/index.html:20236 and server.js:11888: "cancel it from your account" is not verifiable from this repo
The sentence tells the person a cancel action exists on login.kosmosplus.com/account (the View account link beside
it). Nothing in this repo, the board's engine, or the chaoskosmos-site checkouts on this machine names a way to
cancel a cloud machine; the #4903 plan says Kosmos Cloud is not switched on yet. The wording follows the card's
decision ("leaving is cancelling from the account"), so this is not a defect today, but it is a promise about another
team's page. It is also the first user-facing use of the name "Kosmos cloud machine" (every other occurrence is a
comment), so the product name should be confirmed with whoever names Kosmos Cloud.
Fix: confirm with the coordinator/account side (Ice Cream Kitty / PigeonPete's S-owners on #4903) that the account
page offers cancel for a cloud machine before switch-on, and note it on the card.

## Checked and found clean

- Server refusal cannot fire on a Mac or Windows board: engine/cloudmachine.js returns false unless
  `process.platform === 'linux'` AND a regular file `hosted` is in the tunnel state dir; any error is false (read).
- The refusal is before readBody, so neither an empty body nor `{anyway:true}` reaches remote.forget (read, and the
  new unit test asserts `calls` stays empty with anyway).
- server.js calls `cloudMachine.isCloudMachine()` through the module object at request time, so both tests' stubs
  take effect for the route and for stampServedPlatform (read: server.js:245, 262, 11887).
- Only two board paths retire this computer at Kosmos+: forget() and clearHalfIdentity() (a half identity only, on a
  fresh sign-in after an unfinished one). `retireHere()` has exactly those two callers in engine/ (measured by grep);
  win32uninstall.js is Windows only; an enrolled computer is recognised rather than re-enrolled (remote.js:1715).
  Fed `forget` calls in server.js are project memberships, not this computer.
- Every page entry to the forget confirm goes through #plus-forget-go (hidden on cloud), the kept box (see NIT), or
  plusForgetRun, and every one of them ends at POST /api/remote/forget, which now refuses on cloud.
- The paint block only ever sets #plus-forget-go hidden (never unhides it) and sets the cloud sentence hidden off a
  cloud machine, so a Mac or PC paint is unchanged from origin/main (read).
- Unit test can fail: with the guard removed the cloud arm would see status 200 and `calls = [{anyway:true}]`; the
  control arm proves the same request reaches the engine when not cloud. `t.after` restores the stub. Ran:
  server.remote-forget-6389.test.js 5/5 pass.
- Browser check restores `cm.isCloudMachine` in a `finally`; it uses the in-process board (srv.start), so the stub
  reaches the served page; `/api/remote/forget` is not caught by the `**/api/remote` route glob, so the real route
  answers. It is run by tools/browser-checks.sh (tools.browser-checks-wired.test.js passes); the new surface token
  `plus-forget-cloud` is declared on line 1. Not run (browser checks excluded by the brief).
- Copy and page guards: ran 22 Plus/voice/copy page and server test files (web.plus-*, web.voice-*,
  web.win32-board-copy, familywords, second-factor copy, lost-phone, company-signin and siblings): 211/211 pass.
  Ran server.connect, web.flowpoll-4275, engine/cloudmachine-4903: 75/75 pass. tools.browser-checks-wired,
  browser-checks-reason-grep, browser-checks-selectors: 22/22 pass.
- No em dashes in the diff (read).
- The latch survives a Remove anyway (clearStateDir keeps it, #4903 review 2), so the server keeps refusing even
  after a legacy kept/anyway state.
