# projmembers-8956: add and remove a project's members, and archive it, natively on the iPhone (kosmos#8956)

Finished when: from project info, adding a member, removing one and archiving the project happen on native screens (archive and remove ask first, every dialog has a Cancel); none of those taps opens the board page with the navy Close bar; outside (federated) members stay a labelled hand-off using Mona Lisa's opens-on-board words; checked in the simulator with a screenshot per screen; logic in ios/LogicTests.

## Colleagues' notes (00:17, fleetbuilders m6286 to m6290)
- Renet (#8955): on iOS 26+ a confirmationDialog is a popover with no cancel button; a UI test closes it via app.otherElements["PopoverDismissRegion"], the named cancel exists only on older iOS: check both. One dialog per button, not several on the List. A relay 5xx with no JSON body may come after the computer acted: "cannot tell", not a refusal (Board.removeResult / restartResult in AgentInfoLogic.swift, branch agentactions-8955). KOSMOS_SAMPLE_INFO auto-open can fail in a UI test: fall back to the toolbar's info button.
- Kitty (#8953, webfile-8953): one line in ProjectInfoView, the FilesView call loses openOnBoard. Second to merge rebases it.
- PigeonPete (#8954): a native screen that posts to the computer needs board.macURL, set only when a real computer admits the phone; the sample board never does. Cover the rule in LogicTests; device check via TestFlight or ios/tools/ui-signin.sh.
- Mona Lisa (#8957, fallback-8957): board hand-offs use Board.opensOnBoard ("on your computer's board"), Board.boardIcon (arrow.up.forward.square) and OpensOnBoardNote; she changes memberRow's unknown-member case (board icon and hint, ~line 296). Native copy: "Add a member", "Remove from this project", "Archive project"; ask before removing or archiving; always a Cancel.
- April (#8959): keep every entry on ui-sample.sh's classes= line when adding a UI test class.

## Build (first pass)
- Logic (ios/Kosmos/BoardRoom.swift, tested in ios/LogicTests/room): projectArchiveBody ({archived:true}, the board's own PUT), projectMemberRequest (POST or DELETE /api/project/<id>/agent/<session>, built in place per method for server.ios-routes-6838), projectMemberResult (done(told) / refused / cannotTell / noAnswer; Renet's 5xx rule), the lines, projectAddable (not a member, not the guide, list order).
- UI (ProjectInfoView): Settings gains Members (each with a Remove that asks on its own button) and Add a member (a sheet of addable agents, with Cancel), and Archive project (asks first) at the bottom. About and Settings each end in one labelled hand-off, "Members from other computers", "Opens on your computer's board", arrow.up.forward.square, with a footer naming what else stays on the board (webhooks, folder, the rest).
- Removed: the two general "Open on your computer's board" rows and their three now-unused strings.
- Decided: About keeps its member list read-only (a tap opens the member's chat, as before); changing members is in Settings with the project's other settings, as on the board.
- Weakest premise: after archiving, the page stays open with "Archived."; the project leaves the list on the re-read. Closing the page on archive is the alternative; kept open so the result line is seen.
- Evidence so far: room 931/931; simulator SDK build succeeded; server.ios-routes-6838 5/5; the 13 node tests that read ios/ 93/93. UI test (ProjectInfoUITests, all four, mine plus the three earlier) queued for the shared box.

## Challenge loop iteration 1 (opus)
- Fixed (WARNING): the board's `told` has three states; could_not (Kosmos could not update the agent's instructions) was said as "it reads the change next time". Now its own case with why, worded as the board's dropMember words it; the board's removal lines are used verbatim and pinned to web/index.html.
- Fixed (WARNING): "no answer" was said as "nothing changed", though a sent request's reply can be lost after the computer acted. Only "not connected" (checked before sending) is "nothing changed"; a sent request with no answer is "cannot tell"; every answer is followed by a re-read.
- Fixed (WARNING): the archive read its answer as a project save (a bare 5xx said "could not save"); it now has its own result by the member rules. After an archive the room closes back to Projects (onArchived, the board returns to its list). On an archived project the row is Restore ({archived:false}, no question), as the board's button is there.
- Fixed (NIT): the add sheet's empty line says which empty it is; one pick only; a second change while one runs is ignored; the projectAddable comment no longer names a filter that is not there; the session is ASCII percent-encoded (iOS 16's URL refuses non-ASCII), with the force unwrap explained.
- Fixed (NIT): the UI test asserts the archive question's own words (a button count could not fail) and that the general board rows are gone from About and Settings.
- Evidence: room 942/942; simulator SDK build succeeded; the 13 node tests that read ios/ pass. UI run still queued.

## Challenge loop iteration 2 (sonnet)
- Fixed (WARNING): Restore was unreachable (the phone opens no archived project: ProjectsView's ArchivedRow is plain text) and untested. Removed: the archive row is archive only and hidden on an archived project; restoring stays on the computer's board, as the question says. Decided: opening archived projects on the phone is its own change, not this card's.
- Fixed (WARNING): the archive question said its agents stop being told, which the server does not do (archive turns the project off; members and their instruction blocks stay). Now the board's own hint: "It leaves your projects list and stops counting. Everything stays, and you can restore it ..." (pinned to web/index.html).
- Fixed (WARNING): the member and archive result lines are now spoken (UIAccessibility announcement), as save() speaks its own.
- Fixed (NIT): the row being removed shows its own progress; an add says only "Added <name>." when told or not tried (the board says nothing more).
- Noted (NIT): closing on archive (RoomView's dismissRoom from the info page) is not reachable in the sample board (no computer admitted, PigeonPete's note); it is a device check, with the posting paths.
- Evidence: room 943/943; simulator SDK build succeeded; the 13 node tests that read ios/ pass.

## Challenge loop iteration 3 (opus)
- Fixed (WARNING): a lost answer to an archive that happened left the page on an archived project with its line hidden with the section. The re-read decides too: archived on the re-read counts as archived ("Archived.", and close).
- Fixed (WARNING, reasoned from SwiftUI, not measured): a slow archive landing after Back could call the old room's dismiss, which drives the same link binding and could close another room. It closes only while this info page is still on screen (onScreen, set by onAppear/onDisappear).
- Fixed (NIT): adding uses the room's own addMemberRequest (one validator, isAgentSession, for both paths); removing has a DELETE twin with the same checks; the add line is the room's ("Added X to this project."). The archive question names the board's list as "Archived". The busy state is an enum (no marker string a session could equal). VoiceOver hears "Removing" on the row.
- Fixed (NIT): the UI test drops its web-view checks (the sample board admits no computer, so they could not fail) and asserts About's labelled hand-off is present before asserting the old row is absent.
- Evidence: room 944/944; simulator SDK build succeeded; the 13 node tests that read ios/ pass. UI run still queued (1 ahead).

## Challenge loop iteration 4 (sonnet): nits only, all taken
- A session the phone will not send for (isAgentSession) is said as "cannot be changed from the phone", never "cannot tell" (nothing was sent).
- The UI test waits for the sheet and both dialogs to be gone (waitForNonExistence), the Archive dialog included.
- A comment on the slow-archive-after-a-push case, which fails safe.
- Noted: the confirm buttons' wiring into changeMember and archive is a device check (the sample board admits no computer).

## Challenge loop iteration 5 (opus)
- Fixed (WARNING, reasoned from XCTest, not run): the UI test's scroll loops asked isHittable of rows that may not exist yet (off-screen List cells), which XCTest fails on rather than answering false. They now ask exists && isHittable, as NewChatListSwitchUITests does.
- Fixed (NIT): the add sheet offers only agents the phone can send for (isAgentSession), so it never offers one it then refuses; a logic test covers it.

## Challenge loop iteration 6 (sonnet): converged
- No new findings. Device checks, as recorded: closing on archive, the confirm buttons posting, and whether dismissing the room pops the info page with it.

## After convergence
- Full validation PASSED on 66083739f8 (30263 node pass, 0 fail; shell shards green; hash e7eadbd879c0).
- UI run PASSED 5/5 ProjectInfoUITests on iPhone 17e, iOS 27, with a screenshot of each new screen (members in Settings, Add a member, the Remove question, the Archive question, the lower Settings with the hand-off).
- Copy fix from reading those screenshots: the Remove question called the agent "it" while the result lines say "them"; it now reads "They stop being told about its room and tasks, and stay on your computer. You can add them back." Room 945/945, build and node ios tests pass; validated again on the final head.
- Rebased onto main after #8957 (PR #8975) merged. Its two edits restyled the general board rows this change removes (kept mine), and its member-row change (OpensOnBoardNote for an unknown member) is kept as it landed. The hand-off row now uses #8957's Board.opensOnBoard and Board.boardIcon (same words and icon). Room 945/945, build, node ios 93/93; full validation again on the rebased head.
