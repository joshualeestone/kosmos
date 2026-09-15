# #2808 class-1 (c): the invisible auto-handle (decision + executor, one wire from class-2)

Splinter routed the class-1 (b)/(c) follow-ups to me (my #2808 lane) via my own repro, don't wait
on Angel. (b) is documented on #2808 (live repro on Claude Code 2.1.272). This branch is (c): the
buildable core of the live invisible auto-handle for a technical permission/trust prompt.

## What the auto-handle is
Josh LOCKED 2026-09-14 16:49: "auto-handler #1 invisibly. i want all auto-clear stuff cleared."
Class 1 = Claude Code's own folder-trust / bypass / tool-permission prompts. When an agent is parked
on one, the board records a STANDING needs_you written by the lifecycle hook (by:'auto'). The manual
escape today is the /trust-and-restart button (server.js:5147): it writes the folder-trust key
(create.trustAgentFolder) + restarts (remove.restart), so the relaunch reads the key and never shows
the dialog. This automates that one click.

## The build (this branch)
- `engine/class1-autohandle.js`:
  - `isClass1(standing)` - the ONE class-1 vs class-2 line, mirroring selfreport.js:222-224 exactly
    (found && state==='needs_you' && by==='auto'). WIRE-UP #1 for Angel's class-2 by/permissionAsk.
  - `planClass1Handle(standing, attempts, now, opts)` - PURE decision: none / trust-and-restart /
    escalate. Fails closed (anything not certainly class-1 -> none). Loop-guarded: >= maxAttempts
    (default 2) recent handles in the window (default 10 min) -> escalate, never another restart.
  - `runClass1Handle(name, deps)` - THIN executor, deps-injected (trustAgentFolder, restart,
    RESTARTED). Reuses the manual route's exact functions; NO send-keys (a mis-fired keystroke into a
    real conversation is the whole hazard). `handled` keys on the restart outcome.
  - `sweepClass1(names, deps, now, opts)` - the dry-run surface: names -> plans, read-only.
- `engine/class1-autohandle.test.js`: 21 tests, red-capable controls on every branch (class-2 must
  NOT be handled; loop-guard must escalate not loop; executor keys handled on the restart; sweep is
  read-only).
- `bin/class1-autohandle.js`: DRY-RUN inspector (argv names -> printed plan). Deliberately no --arm:
  the armed path needs a PERSISTENT attempts store (cross-invocation loop-guard memory) + Angel's
  class-2 classification, so arming here would be an unguarded restart loop.

## Why write-key-and-restart, not send-keys
Reuses the tested manual path, handles #2173 config divergence via trustFolder's own logic, and never
sends a keystroke into a live pane. Safety is the whole risk of this feature.

## What this branch deliberately does NOT do (the one wire-up from class-2)
Nothing runs the handle automatically. There is no production sweep armed and no --arm. The wire-up,
when Angel's class-2 by/permissionAsk lands: (1) tighten `isClass1` to her richer classification;
(2) a supervisor sweep / status tick calls sweepClass1, and an armed caller runs runClass1Handle on
the 'trust-and-restart' plans with a persistent attempts store feeding the loop-guard. Both seams are
marked WIRE-UP in the module.

## Scope decision + weakest premise
Decided to ship the decision+executor+dry-run (safe, tested, reusable) rather than an armed
production sweep, because the armed path's safety depends on the persistent attempts store and the
class-2 classification, neither of which exists yet - arming now would be the unguarded loop the
loop-guard exists to prevent. Weakest premise: that `by:'auto'` remains the stable class-1 seam until
class-2 lands; if Angel's build changes how class-1 is marked, `isClass1` is the one line to update
(named as WIRE-UP #1). Region is disjoint from Angel's class-2 (status.js/web render): a new engine
module + test + a new bin, reusing create/remove/selfreport read-only.
