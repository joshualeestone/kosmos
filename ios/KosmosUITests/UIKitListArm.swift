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
}
