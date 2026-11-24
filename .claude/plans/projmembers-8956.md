# projmembers-8956: add and remove a project's members, and archive it, natively on the iPhone (kosmos#8956)

Finished when: from project info, adding a member, removing one and archiving the project happen on native screens (archive and remove ask first, every dialog has a Cancel); none of those taps opens the board page with the navy Close bar; outside (federated) members stay a labelled hand-off using Mona Lisa's opens-on-board words; checked in the simulator with a screenshot per screen; logic in ios/LogicTests.

## Colleagues' notes (00:17, fleetbuilders m6286 to m6290)
- Renet (#8955): on iOS 26+ a confirmationDialog is a popover with no cancel button; a UI test closes it via app.otherElements["PopoverDismissRegion"], the named cancel exists only on older iOS: check both. One dialog per button, not several on the List. A relay 5xx with no JSON body may come after the computer acted: "cannot tell", not a refusal (Board.removeResult / restartResult in AgentInfoLogic.swift, branch agentactions-8955). KOSMOS_SAMPLE_INFO auto-open can fail in a UI test: fall back to the toolbar's info button.
- Kitty (#8953, webfile-8953): one line in ProjectInfoView, the FilesView call loses openOnBoard. Second to merge rebases it.
- PigeonPete (#8954): a native screen that posts to the computer needs board.macURL, set only when a real computer admits the phone; the sample board never does. Cover the rule in LogicTests; device check via TestFlight or ios/tools/ui-signin.sh.
- Mona Lisa (#8957, fallback-8957): board hand-offs use Board.opensOnBoard ("on your computer's board"), Board.boardIcon (arrow.up.forward.square) and OpensOnBoardNote; she changes memberRow's unknown-member case (board icon and hint, ~line 296). Native copy: "Add a member", "Remove from this project", "Archive project"; ask before removing or archiving; always a Cancel.
- April (#8959): keep every entry on ui-sample.sh's classes= line when adding a UI test class.
