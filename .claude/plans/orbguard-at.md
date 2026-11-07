# orbguard-at: the orb guard sees every top-level line of KosmosOrb.swift

Follow-up to PR #8164 (round 8 residual, on #8153). Stacked on iphone-orbsignin; rebased onto main once #8164 merges, then its own PR.

## Finished looks like
- The sweep's KosmosOrb.swift check reads KosmosOrb.swift with its own character scan (strings, // comments, nested /* */ comments; braces counted only in code) and lists every line that begins at brace depth 0 with code on it (not an import or a lone closing brace). Clean 45/45. Seven plants red 44/45 (an attribute-led func, @ViewBuilder on its own line, a func after /* x */, after a closing */, an indented func, declarations after a `/*` inside a // comment, a top-level let); four harmless edits pass (a starless block comment, a MARK comment, a nested block comment, braces in a // comment).

## Out of scope
- Anything outside ios/LogicTests/sweep/main.swift.

## Weakest premise
- Multi-line string literals are read as code (none in KosmosOrb.swift). A `#if` / `#endif` reds the check on purpose (it can wrap a declaration), so adding one means updating the guard.
- Not changed here: AgentsView's pins use the shared codeOnly, where a `/*` inside a // comment swallows code up to the next `*/`. That fails safe (swallowed code drops the pinned lines) unless a fourth orb sits exactly in the swallowed span.
