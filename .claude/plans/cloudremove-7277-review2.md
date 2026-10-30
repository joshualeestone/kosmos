# kosmos#7277 review 2 (blind CTO-lens and design)

Reviewed: be09e8ff87c83b22bb3166c013471d01ace42d58

Counts: 0 BLOCKER, 2 WARNING, 1 NIT

## Findings

### [WARNING] server.js:12263: Devices > Remove (and the notice's Undo) can remove the one browser a cloud machine is reached from

Failure scenario: on a Kosmos cloud machine the person reaches the board from one browser. Under Settings > Kosmos+ > Devices
they press Remove on that browser's row (or Undo on the "connected" notice, web/index.html askAct 'here-undo'). The route is
deliberately open to remote sessions (kosmos#6595: "Deny and Remove take access away and stay open remotely"), so it runs:
remote.deviceRemove ends that device's sign-in. Getting back in needs a browser to be let in, and per kosmos#6590 a phone or a
browser "is let in only by the code its page shows", typed at the board, and Allow is refused from a remote session (403,
same route). On a Mac the person walks to the computer. On a cloud machine there is no screen to walk to, so unless the
tunnel's hosted gate admits the account owner on the coordinator's signed claim alone, this is the same lockout as Remove this
computer, one click deeper. The tunnel source is not in this repo, so I could not measure which it is.

Fix: confirm from kosmos-tunnel whether the hosted gate admits the account owner without a board Allow. If it does not, either
refuse /api/remote/devices/remove for the requesting device's own id on a cloud machine (and hide that row's Remove), or at
minimum say on a cloud machine that removing the last browser leaves no way back. If it does, a one-line comment at the route
saying so closes the question for the next reviewer.

### [WARNING] engine/remote.js:1076: an unreadable remote.json stops the tunnel, and on a cloud machine nobody can repair it (pre-existing, outside this diff)

Failure scenario: read() answers blankSettings(false) (on:false) for any read or parse failure, and ensure(), run by the
board's 15-second tick, then calls stopChild(). On a Mac the person sees "Off" and presses the switch, which repairs the file
(write with repair:true). On a cloud machine the page is reached only through that tunnel, so a persistently damaged
remote.json (a torn write, a full disk) takes the only way in away with no person action, and the repair control is on the far
side of it. Not introduced by this branch; reported because the brief asks for every path that stops the reach, and this one is
not person-triggered so no page or route refusal covers it.

Fix (follow-up card, not this PR): on a cloud machine, fail OPEN for the switch half of ensure()'s `wanted` when the file is
unreadable (the latch plus an enrolment already says the person wants it reachable), or have the board rewrite on:true on a
cloud machine when it finds the file damaged.

### [NIT] web/index.html:54170: the not-removed-yet box is re-shown on a cloud machine right after the new block hides it

Failure scenario: the new kosmos#7277 block (54159-54166) hides #plus-forget-kept on a cloud machine ("review 1"), but the very
next block, when r.on !== true and r.forgetKept is set, calls plusForgetKeptSay, which sets box.hidden = false. The box then
shows "Try again" and "Remove from this computer only" (both now 409) and a sentence about removing it. Practically unreachable
today: it needs a forget_kept left from before this change AND remote access off, and with remote access off a cloud machine's
page cannot be viewed at all. So it is a contradiction in the paint, not a live lockout.

Fix: run the kosmos#6389 kept block only when not on a cloud machine (or move the cloud block after it), so the comment's
promise that the kept box is hidden on a cloud machine holds on every paint.

## Checked and found clean

- Refusals cannot fire on a Mac or Windows board: engine/cloudmachine.js isCloudMachine returns false unless
  process.platform === 'linux' AND a regular file `hosted` exists in the tunnel state dir; any error answers false. The
  latch is written only by the cloud installer and clearStateDir keeps it (engine/remote.js:424). Read.
- PUT /api/remote: the guard is `body.on === false`, so a string or number never slips past it (setOn refuses non-booleans
  anyway), and on:true still reaches setOn. Read and measured by the new test.
- POST /api/remote/forget refuses before readBody, for both the plain and the `anyway` body. Read and measured.
- No other route stops the tunnel or writes on:false from a person action on an enrolled computer: grep of server.js for every
  remote.* mutator (setOn, forget, setupStart/Complete, companyStart/Complete, secondReset, deviceAllow/Deny/Remove); no
  route calls setRelay; no retire-a-computer route exists. engine/*.js outside remote.js never calls setOn, forget or stopChild
  (grep). cancelledAfter's write({on:false}) is reached only from a sign-in cancel or Forget during a register; Forget is now
  refused there and the page offers no sign-in on an enrolled computer (paintPlus returns into the connected flow).
- Org/company/family enroll, preview and leave (/api/org/*): signed macRequest calls only (engine/orgenroll.js), no tunnel stop
  or re-key. Read.
- Second-step reset, cert-watch switch, Log out of Kosmos+ (ends this browser's tunnel session; the sign-in page brings it back),
  update/rollback (ensure() at boot restarts the tunnel while on), Fresh start (per agent, not the tunnel),
  engine/updating.js (reads the switch, never writes it): none stops the reach. Read.
- paintSwitch is the only painter of #plus-switch, called once per paintPlus, synchronously followed by the new hide; nothing
  else un-hides it (grep of every plus-switch reference). The switch stays offered while off, so a person who somehow sees an
  off cloud machine can turn it on. Read.
- The page's cloud fact comes from the per-request stamp (server.js:262, served with no-store at 25400), so the browser check's
  in-process stub of isCloudMachine reaches both the page and the routes; it is restored in a finally. Read.
- Browser check stubs: `**/api/remote` matches only the exact path and continues non-GET, so the PUT reaches the real route;
  `/api/remote/forget` is not matched by any stub. The CONTROL in the connected pane asserts the cloud sentence is absent off a
  cloud machine. Read (not run, per the brief).
- server.remote-forget-6389.test.js: both new tests restore their stubs in t.after; each has a control arm on a non-cloud
  computer; removing either guard turns `refused.status` / `sets` red. Ran: 6/6 pass.
- Guard and neighbour tests: ran 17 files (web.plus-*, web.cert-notice-6613, web.joinwait-6385, web.allow-card,
  web.lost-phone, web.company-signin-5628, web.sk-notice-6587, web.remote-unreadable-4308, browser-checks-pr-select-4119,
  web.win32-board-copy, engine/cloudmachine-4903): 206/206 pass. No copy test pins the Remove row's sentences in a way this
  breaks; paintPlus's new reads are typeof-guarded for the lifted-function harnesses.
- Copy: no em dash; "this computer" voice; the sentence names where to stop (your account) beside View account.
