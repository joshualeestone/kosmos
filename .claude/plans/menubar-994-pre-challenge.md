---
pre_challenge: true
method: challenge-loop
branch: menubar-994
diff_hash: 63ea596b4273ea5526755c66ac7f5e28f5a9b7dc71d000227360cc449c249d54
subdir_audit: passed
timestamp: 2026-08-26T21:16:16Z
iterations: 2
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** No. Stopped by judgment after round 2: its findings were in prose and in the gate's
own reach, not in the menu, and the one thing that genuinely cannot be settled by more reading is
recorded below as owed.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 6 WARNINGs, 3 NITs

- [WARNING] native-app/main.swift - **the Settings fallback could discard a draft on a CURRENT
  build.** The `try` wrapped the CALL, so any exception thrown INSIDE `showTab` fell through to
  a navigation that throws away typed text - the exact harm its own comment claimed to prevent
  --> FIXED (the guard wraps the LOOKUP only)
- [WARNING] native-app/main.swift - ⌘, acted on a window ⌘W had just ordered out --> FIXED
  (`makeKeyAndOrderFront` first)
- [WARNING] native-app/main.swift - the failure path was log-only, and the log goes nowhere in a
  shipped install (`/tmp/kosmos-app-test/app.log` does not exist) --> FIXED (beep, as
  `reloadBoard` already does)
- [WARNING] tools/build-kosmos-bundle.sh - the new `mktemp` was not on the script's ONE EXIT
  trap, leaking a file per build including every failing build --> FIXED
- [WARNING] native-app/main.swift - 🛑 **the safety net I claimed for Undo does not exist.**
  Measured: `WKWebView.instancesRespond(to: "undo:")` is FALSE and `NSWindow`'s is TRUE, so the
  action always finds an implementor and the item never greys to warn anyone --> FIXED (the claim
  is retracted in the comment and the plan)
- [WARNING] .claude/plans/… - verification item 2 unmet --> RECORDED as owed, not marked done

#### Iteration 2
**New findings:** 0 BLOCKERs, 6 WARNINGs, 3 NITs

- [WARNING] native-app/main.swift - **`openSettings` called `showTab` directly while its comment
  claimed to be "the same function the tabs themselves call".** The function is the same, the CALL
  is not: the page's handler also does `WATCH += 1` and `burgerClose()`. Skipping `WATCH`
  reintroduces a bug `index.html` records having already shipped and fixed once, through a door
  the existing guard does not cover --> FIXED (clicks the real control, with graded fallbacks)
- [WARNING] native-app/main.swift + build gate - **the gate could not see the two things this
  refactor moved.** Splitting `buildMenu` made the targets ARGUMENTS, and passing `nil` for
  either silently reverts ⌘R and permanently greys ⌘, - both the "appears and is inert" failure
  the card exists to remove, both byte-for-byte green under a target-blind dump --> FIXED
  (sentinel + a `target:` column; **proven by passing nil and watching the row change**)
- [WARNING] native-app/main.swift - **the About-version comment asserted a divergence the install
  path cannot produce.** Both numbers come from the same `app/package.json` `.version`, and
  `make_app` runs on every install and every in-app update. My "do not fix a mismatch" line would
  have suppressed the only signal that a `make_app` failed --> FIXED
- [WARNING] native-app/main.swift - the header said only two rows could break; four can --> FIXED
- [WARNING] native-app/main.swift - **⌘W gave a keyboard way to close the window and no way back**,
  since an ordered-out window leaves AppKit's window list and the new Window menu would be empty
  --> FIXED (Kosmos, ⌘0, calling the same `makeKeyAndOrderFront` the Dock reopen uses)
- [NIT] the gate skipped separators, so their placement was unguarded --> FIXED (emitted)
- [NIT] the shell literal's apostrophe fragility --> noted beside it
- [STRENGTH] - the build gate was reproduced independently, byte-for-byte, 955 bytes, real tabs,
  no quote that could terminate the literal early, and it fails on drift rather than open
- [STRENGTH] - ⌘W traced end to end: `performClose:` reaches the same `windowShouldClose` the
  titlebar button fires, so the close-vs-quit seam is untouched and the quit dialog cannot be
  bypassed
- [STRENGTH] - every other item resolves to a real implementor, and the page has zero `metaKey`
  handlers, so none of the new shortcuts steals a binding from the web app

### 🛑 What is NOT proven, and it is the plan's own verification item 2

**Undo/Redo and Settings ship unpressed.** Two reviewers and I independently read the chain and
agree Undo is *likely* to work; the second reviewer reproduced the SDK probe and reached the same
conclusion. **Reading is not pressing**, and there is no automatic grey-out to catch it, because
`NSWindow` implements `undo:` even though `WKWebView` does not.

**Shipping anyway is a judgment, stated rather than buried:** an Undo that probably works beats a
guaranteed absence of Undo, and holding the whole menu bar for one unpressed key would also
withhold Hide, Minimize, Close and the Settings shortcut. The ask is five seconds and is with Josh.
