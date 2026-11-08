import XCTest

// kosmos#8221: which list draws the chat in a check. TEST_RUNNER_KOSMOS_UIKITLIST=1 runs it on the UIKit list (ChatList),
// otherwise the lazy SwiftUI list. Set just before launch, after any whole-dictionary assignment of the launch environment.
// A check of something the UIKit list does not have yet skips itself on that arm (XCTSkip), so a UIKit run's failures are
// all about what it does have. A launch that opens a project room is unaffected by the switch.
// Nothing runs this arm by itself yet: CI runs the lazy list, which is what a release build draws. It is run by hand with
// TEST_RUNNER_KOSMOS_UIKITLIST=1 until the slice that lets a phone choose the UIKit list, which adds it to a runner.
enum UIKitListArm {
    static var on: Bool { ProcessInfo.processInfo.environment["KOSMOS_UIKITLIST"] == "1" }
    static func set(_ app: XCUIApplication) {
        if on { app.launchEnvironment["KOSMOS_SAMPLE_UIKITLIST"] = "1" }
    }
}
