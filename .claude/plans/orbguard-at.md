# orbguard-at: the orb guard sees every top-level line of KosmosOrb.swift

Follow-up to PR #8164 (round 8 residual, on #8153). Stacked on iphone-orbsignin; rebased onto main once #8164 merges, then its own PR.

## Finished looks like
- The sweep's KosmosOrb.swift check cuts comments, then lists every line that begins at brace depth 0 (not an import or a closing brace), so an attribute-led declaration, one after a /* */ on the same line, or an indented one shows up and reds it. Clean tree passes 45/45; five plants red 44/45; a starless block comment and a MARK comment pass.

## Out of scope
- Anything outside ios/LogicTests/sweep/main.swift.

## Weakest premise
- Braces inside a string would miscount the depth (no string in KosmosOrb.swift holds one). A `#if` / `#endif` reds the check on purpose (it can wrap a declaration), so adding one means updating the guard.
