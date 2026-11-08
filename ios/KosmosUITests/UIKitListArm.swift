import XCTest

// kosmos#8221: which list draws the chat in a check. TEST_RUNNER_KOSMOS_UIKITLIST=1 runs it on the UIKit list (ChatList),
// otherwise the lazy SwiftUI list, so one class answers for both lists. Set just before launch, after any whole-dictionary
// assignment of the launch environment.
enum UIKitListArm {
    static var on: Bool { ProcessInfo.processInfo.environment["KOSMOS_UIKITLIST"] == "1" }
    static func set(_ app: XCUIApplication) {
        if on { app.launchEnvironment["KOSMOS_SAMPLE_UIKITLIST"] = "1" }
    }
}
