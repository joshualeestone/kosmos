# orbguard-at: the orb guard sees every top-level line of KosmosOrb.swift

Follow-up to PR #8164 (round 8 residual, on #8153). Stacked on iphone-orbsignin; rebased onto main once #8164 merges, then its own PR.

## Finished looks like
- The sweep's KosmosOrb.swift check lists every column-0 line that is not a comment, an import or a closing brace, so an attribute-led declaration (`@MainActor func`, or `@ViewBuilder` on its own line) shows up and reds it. Clean tree passes 45/45; both plants red 44/45.

## Out of scope
- Anything outside ios/LogicTests/sweep/main.swift.

## Weakest premise
- A top-level declaration written indented (legal Swift, unusual style) is not at column 0 and is not seen.
