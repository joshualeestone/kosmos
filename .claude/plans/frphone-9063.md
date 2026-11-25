# frphone-9063: two iPhone first-run fixes (kosmos#9063, Splinter 08:31 from Ice Cream Kitty's shots)

Finished means: on the iPhone the computer's name in the top bar shows whole for a normal name ("Studio Mac") at both
iPhone 17 sizes, and still leaves the order and + buttons their room at the accessibility text sizes; and the signed-in
screen with no computer says "Set up Kosmos on your computer".

## Built
- ios/Kosmos/AgentsView.swift, MacSwitcher (the switcher on Agents, Projects and Tasks, one view): the name sits in
  CappedIdealWidth, a Layout that gives its child the child's own width up to a cap, whatever width the toolbar offers
  (a one-line Text accepts the toolbar's near-zero offer and truncates). Cap 160 pt, 120 pt at the accessibility sizes.
- ios/Kosmos/SignInView.swift: "Set up Kosmos on your Mac" -> "on your computer".
- The other "your Mac" lines are #9064 (after the submission build, Splinter 08:39), so this stays small.

## Review round 1 (opus, blind): nothing blocking
- WARNING taken: the first version measured with UIFont and did not follow a text size change; now a Layout (the child
  measures itself), and MacSwitcher reads dynamicTypeSize for the cap.
- WARNING taken: accessibility sizes on a 375 pt phone: the cap is 120 pt there; checked by simulator screenshot at
  AX3 and AX large (iPhone 17).
- NIT answered on the card: "Your Mac is showing a code" on the waiting screen stays for #9064.

## Checked
Every iOS logic suite passes; every ios/Kosmos source typechecks at iOS 16 (swiftc -typecheck); simulator shots below.

## Review round 2 (sonnet, blind, whole branch): nothing above NIT. Converged.
- The Layout's sizing, placement and Dynamic Type re-measure read correct; every MacSwitcher caller (Agents, Projects,
  Tasks, the navy overlay) and the accessibility labels unchanged. The one open item is the screenshot on a real OS,
  which the queued simulator run takes (iPhone 17, iOS 26); results go on the card.
