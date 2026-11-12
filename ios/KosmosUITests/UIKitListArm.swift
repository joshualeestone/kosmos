import XCTest

// kosmos#8221: which list draws the chat in a check. TEST_RUNNER_KOSMOS_UIKITLIST=1 runs it on the UIKit list (ChatList),
// otherwise the lazy SwiftUI list. Set just before launch, after any whole-dictionary assignment of the launch environment.
// A check of something the UIKit list does not have yet skips itself on that arm (XCTSkip), so a UIKit run's failures are
// all about what it does have. A launch that opens a project room is unaffected by the switch.
// ios/tools/ui-sample.sh --uikit runs this arm (CI's "uikit list (sample board)" job); its header names the classes.
enum UIKitListArm {
    static var on: Bool { ProcessInfo.processInfo.environment["KOSMOS_UIKITLIST"] == "1" }
    static func set(_ app: XCUIApplication) {
        // Both arms set it, so a check that calls this ignores Settings' "New chat list" switch (a check that does not call it
        // reads the switch; NewChatListSwitchUITests puts it back off in its teardown).
        app.launchEnvironment["KOSMOS_SAMPLE_UIKITLIST"] = on ? "1" : "0"
    }
    // kosmos#8221 slice 8: on the UIKit arm, that the chat really is drawn by the UIKit list (ChatList's identifier), so a
    // pass on this arm is never the lazy list's pass under another name. A launch that opens no chat need not call it.
    static func assertDrawn(_ app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) {
        guard on else { return }
        let list = app.descendants(matching: .any).matching(identifier: "chat-list-uikit").firstMatch
        XCTAssertTrue(list.waitForExistence(timeout: 20), "the UIKit arm opened a chat not drawn by the UIKit list", file: file, line: line)
    }
    // kosmos#8221 (CI flake, 11-12): a check whose sample acts by itself a few seconds after the chat opens (A11YSCROLL,
    // A11YFOCUS) cannot ask for the newest row AFTER that: the action scrolls it off and a UIKit row off screen does not exist,
    // so on a slow runner whose first look comes later than the action the newest row is never seen (main's ios job, red 3 of
    // 5). The chat opened at its newest message if that row shows, or if the action already reported: the report says, from
    // inside the app at the moment it acted, whether it started at the newest message ("from the end true"), and each caller
    // asserts that. Neither within `timeout` fails as before.
    static func openedAtNewest(_ newest: XCUIElement, orReported report: XCUIElement, timeout: TimeInterval = 20) -> Bool {
        let end = Date().addingTimeInterval(timeout)
        repeat {
            if newest.exists || report.exists { return true }
            Thread.sleep(forTimeInterval: 0.25)
        } while Date() < end
        return newest.exists || report.exists
    }
}
