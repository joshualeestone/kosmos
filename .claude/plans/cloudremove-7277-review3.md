# kosmos#7277 review 3 (blind, CTO lens and design)

Reviewed: a71fe4fd60d94347198861a3066a367b93e535e4

Counts: 0 BLOCKER, 0 WARNING, 1 NIT

## Findings

### [NIT] engine/cloudmachine.js:10: the module's own contract still says the answer refuses nothing

The header reads "WORDS AND FLOW ONLY, NEVER ADMISSION ... Nothing on the board grants or refuses anyone on the
strength of this answer; a wrong answer here shows the wrong sentence, nothing more." (and web/index.html's
onCloudMachine comment, "Words and flow only"). After this change a "yes" refuses two routes (POST
/api/remote/forget, PUT /api/remote on:false) and hides two controls. The forget route's comment in server.js says
so ("otherwise words-only ... this is the one action it stops"), but that is now two actions, and the PUT comment does
not carry the asymmetry argument.

Failure scenario: someone tuning detection reads the module's "nothing more" and treats a false positive as
harmless copy, when it now also withholds Remove and the off switch on that Linux box. Not a lockout (the
direction is the safe one, as the forget comment argues), so a NIT.

Fix: one sentence in cloudmachine.js's header naming the two refusals (#7277) and why a wrong "yes" is the safe
direction there; change the forget comment's "the one action" to "the two actions it stops (with PUT on:false)".

## Checked and found clean

- Paint order in paintPlus (read): the switch is unhidden by paintSwitch and re-hidden in the same synchronous
  run when r.on === true on a cloud machine; no await sits between, so no frame shows it. The #plus-forget row is
  unhidden (`fg.hidden = r.enrolled !== true`) and the cloud block hides #plus-forget-go, #plus-forget-ask and
  #plus-forget-kept later in the same synchronous run, after plusForgetKept/plusForgetKeptSay, so the kept box
  cannot be re-shown by the 5-second repaint. #plus-forget starts hidden in markup, so nothing shows before the first
  paint.
- Every other writer of the hidden controls (grep of plus-forget-go, 'plus-switch', plus-forget-kept, plus-forget-ask):
  plusForgetArm(false) unhides #plus-forget-go, but it is reached only from the Cancel button, plusForgetRun, and the
  go click, all inside #plus-forget-ask or on #plus-forget-go itself, which are hidden on a cloud machine.
  plusForgetKeptSay after paintPlus runs only inside plusForgetRun (unreachable). No other paintSwitch('plus-switch').
- Nothing else a person can press in this panel reaches a refused route: the only page callers of PUT /api/remote
  and POST /api/remote/forget are the switch handler (index.html ~54987) and plusForgetRun (~55505).
- Server: remote.setOn requires a strict boolean, so `body.on === false` covers every off; the refusal sits after the
  JSON parse (bad body still 400) and before setOn/ensure. The forget refusal precedes readBody, so `anyway: true`
  cannot slip past it. No other server or engine path calls remote.forget or setOn(false) (grep of server.js and
  engine/).
- Mac and Windows: isCloudMachine returns false for any platform other than linux before touching the disk, and any
  error is false, so neither refusal can fire there. The page stamp is computed per request (stampServedPlatform),
  so the page and the route read the same latch.
- Switch shown while r.on is not true on a cloud machine: only lets the person turn it on (not refused, tested);
  off on a cloud machine is unreachable from the page anyway.
- Wording: both server errors and the row sentence are true and plain, give the reason (no way back / only way in)
  and the way out (cancel from the Kosmos+ account, beside View account). No em dashes in the diff.
- server.remote-forget-6389.test.js (ran, 6/6 pass): both #7277 tests restore isCloudMachine and setOn in t.after;
  each has a control arm on a non-cloud computer that reaches the engine/setting, so the refusal is attributed to the
  cloud answer. Read for failure: removing the forget guard makes calls `[{ anyway: true }]` (fails deepEqual []);
  removing the PUT guard makes sets `[false]` (fails). The setOn stub returns not-ok, so ensure() never runs.
- The 13 unit test files that lift paintPlus (ran, 124/124 pass): the new code is typeof-guarded for the harness.
- docs/browser-checks/render-plus-panel-3829.js (read, not run): the stub is on the same module instance server.js
  requires and is restored in finally; the "premise" check asserts the served meta says cloud, so the stub took
  effect. The GET-only route fulfils `**/api/remote` and continues PUT; `**/api/remote` and `**/api/remote/devices**`
  do not match `/api/remote/forget`, so both refused calls reach the real routes. The connected state gained a
  control that the cloud sentence is absent there.
