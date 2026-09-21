---
method: challenge-loop
branch: automation-grant-terminal
diff_hash: f1e86429eaeb4e7fe9eb10cb66a3cbf862f66188f8a402c2357d12ce30fa2194
converged: true
---

# Challenge loop: Automation-to-Terminal grant (Josh 0.6.84, blocker #1)

Adversarial self-review of the fix for the -1743 "Not authorized to send Apple events to
Terminal" terminal-open failure. Two iterations; converged, no BLOCKERs.

#### Iteration 1

[WARNING] The new Terminal probe `tell application "Terminal" to get version` may LAUNCH
Terminal.app if it is not already running (an AppleScript `tell` block launches its target). Is
that an unacceptable side effect during onboarding? It is read-only (no `do script`, no window
created), and priming the grant during onboarding -- even if Terminal launches for a moment -- is
strictly better than the alternative it replaces: the runtime being the FIRST thing to touch
Terminal and failing with -1743 mid-work, which is Josh's exact complaint and the ambush this
priming exists to prevent. The launch behaviour is explicitly flagged for the fresh-install verify
(the same VERIFY-PINNED convention #2911/#3113 already uses). Confirmed-intentional, verify-gated.

[WARNING] The -1743 detection is a substring match (`/-1743|Not authorized to send Apple events/i`)
on the osascript error text -- could it false-positive and mislabel an unrelated failure as an
Automation denial? -1743 (errAEEventNotPermitted) is a specific code and "Not authorized to send
Apple events" is a specific phrase; neither appears in the other failure modes (headless/no window
server, transient AppleScript error). And the cost of a rare false match is only a differently-worded
(still-accurate-in-spirit) message, never a wrong action. Acceptable.

[STRENGTH] Clean testable/verify split: the engine message + `needsAutomationGrant` flag are fully
unit-tested (the -1743 arm asserts the actionable message, the flag, 503-not-400, AND that the raw
AppleScript code does NOT leak). The native probe -- which cannot be unit-tested for TCC behaviour --
is flagged for the 0.6.85 real-Mac verify, matching the existing convention.

#### Iteration 2

[WARNING] Firing TWO probes now raises TWO onboarding prompts back-to-back (Accessibility via System
Events, Automation via Terminal). Is that a regression in onboarding UX? No: both grants are genuinely
required -- Accessibility for the a11y gate, Automation for opening an agent's terminal -- and priming
both up front is the whole point. Two one-time onboarding prompts beat a mid-work -1743 failure with
no path to fix it. Confirmed-intentional.

[NIT] `needsAutomationGrant` is returned but no UI consumes it yet; the actionable text in `because`
carries the guidance today. The flag is forward-looking (lets the board add a one-click "Open
Automation settings" affordance later) and is harmless unused. Noted, not blocking.

[CONVENTION] The native change preserves the VERIFY-PINNED discipline (#2911/#3113): both probes are
marked for a fresh-install verify of which service each raises and which binary macOS names. The old
"THE ONE VERIFY-PINNED STRING" comment (singular) was removed so it does not contradict the two-probe
reality -- a stale comment is a defect.

Converged: no BLOCKERs. The one residual (the native Terminal probe needs a fresh-Mac verify that it
raises the Automation-to-Terminal prompt) is inherent to native TCC work, is flagged in-code, and is
exactly the 0.6.85 real-Mac gate. Engine test: server.launch-terminal-2129.test.js 8/8 green;
terminal.js syntax-checked; the Swift edit parsed clean (swiftc -parse, no errors in the region).
