import XCTest

// kosmos#7348 bug 2 (Josh 10-27, his phone: after a send the conversation crept down to the newest message in steps).
// A sample send paced as a real Mac answers (KOSMOS_SAMPLE_SEND_SLOW=5: the post answers after 5 s, the Mac's row
// arrives 0.5 s later for the next read) must not move at all as it settles: not the sent message, not the one above it.
// Before the fix the sent message moved 17 pt when the post answered (the time line appeared under it), and the rows above
// moved again at the read (the day line, the run's spacing and time line arrived then): 25 to 55 pt in all.
// It reads each message's whole bubble (the element labelled "You..."), never its words: that element is the words' own size
// while the message is pending and the bubble's size once it is kept, 10 pt higher with not one pixel moved (a screenshot
// either side of the read shows the bubble on the same rows). Reading it gave a false 10 pt step, and a limit that hid a real one.
// Opt-in with TEST_RUNNER_KOSMOS_UI_PLUS=1, as the other sample-board UI tests are.
final class SendMovesOnceUITests: XCTestCase {
    override func setUp() { super.setUp(); continueAfterFailure = false }

    private static let pace = 5.0   // seconds until the post answers: a slow runner's tap must return well before it

    private func openDana(_ more: [String: String] = [:]) -> (XCUIApplication, XCUIElement) {
        let app = XCUIApplication()
        app.launchEnvironment = ["KOSMOS_SAMPLE_AGENTS": "1", "KOSMOS_SAMPLE_OPEN": "dana", "KOSMOS_SAMPLE_LONG": "1",
                                 "KOSMOS_SAMPLE_SEND_SLOW": String(Self.pace)]
        app.launchEnvironment.merge(more) { $1 }
        UIKitListArm.set(app)   // kosmos#8221: the list under test
        app.launch()
        let box = app.descendants(matching: .any).matching(NSPredicate(format: "label == 'Message Dana'")).firstMatch
        XCTAssertTrue(box.waitForExistence(timeout: 30), "no message box")
        box.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 10), "no on-screen keyboard")
        Thread.sleep(forTimeInterval: 1.5)   // the keyboard's own move has finished
        return (app, box)
    }

    private func send(_ app: XCUIApplication, _ box: XCUIElement, _ words: String) -> Date {
        box.typeText(words)
        let button = app.buttons["composer-send"]
        XCTAssertTrue(button.waitForExistence(timeout: 5), "no send button")
        let t0 = Date()
        button.tap()
        return t0
    }

    // The sample chat's last message is the person's, from another day, so this send also starts a new day.
    func testASentMessageDoesNotStepAsTheSendSettles() throws {
        guard ProcessInfo.processInfo.environment["KOSMOS_UI_PLUS"] == "1" else { throw XCTSkip("set TEST_RUNNER_KOSMOS_UI_PLUS=1") }
        let (app, box) = openDana()
        try assertStill(app, "No step", neighbour: "Message 260 of 260.", since: send(app, box, "No step"))
    }

    // The agent picking the message up: its "is working" line appears when the post answers, and has had its room all along.
    func testTheWorkingLineAppearingMovesNothing() throws {
        guard ProcessInfo.processInfo.environment["KOSMOS_UI_PLUS"] == "1" else { throw XCTSkip("set TEST_RUNNER_KOSMOS_UI_PLUS=1") }
        let (app, box) = openDana(["KOSMOS_SAMPLE_SEND_WORKS": "1"])
        let line = app.descendants(matching: .any).matching(NSPredicate(format: "label == 'Dana is working'")).firstMatch
        XCTAssertFalse(line.exists, "Dana should start idle, and the room kept for the line should not be heard")
        try assertStill(app, "Picked up", neighbour: "Message 260 of 260.", since: send(app, box, "Picked up"))
        XCTAssertTrue(line.exists, "the line never appeared, so this tested nothing")
    }

    // A second message right after the first, the same day: it joins the first one's run, and neither it nor the first
    // moves as it settles (the first gives up its time line when the second is sent, not at the read).
    func testASecondMessageInARunDoesNotStep() throws {
        guard ProcessInfo.processInfo.environment["KOSMOS_UI_PLUS"] == "1" else { throw XCTSkip("set TEST_RUNNER_KOSMOS_UI_PLUS=1") }
        let (app, box) = openDana()
        let firstSent = send(app, box, "First")
        if Date().timeIntervalSince(firstSent) >= Self.pace { throw XCTSkip("too slow to measure: the first tap outlasted the post") }
        // Until the first has been read, so this is a real row and a pending send joining it across the next read.
        let pendingBubble = app.descendants(matching: .any).matching(identifier: "pending-send").firstMatch
        guard pendingBubble.waitForExistence(timeout: Self.pace) else { throw XCTSkip("too slow to measure: the first message's pending bubble was not seen") }
        let gone = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: pendingBubble)
        guard XCTWaiter.wait(for: [gone], timeout: 30) == .completed else { throw XCTSkip("the first message was not read within 30 s") }
        try assertStill(app, "Second", neighbour: "First", since: send(app, box, "Second"))
    }

    // The sent message and the message above it (a person sees the conversation move, not only the newest message: a day
    // line or a time line changing above the sent one moves the rows above while the list holds its bottom). It watches
    // until 4 s past the read that swaps the pending bubble for its row (reads come every few seconds, slower under load).
    private func assertStill(_ app: XCUIApplication, _ words: String, neighbour: String, since t0: Date) throws {
        func bubble(_ words: String) -> XCUIElement {
            app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH 'You' AND label CONTAINS %@", words)).firstMatch
        }
        let sent = bubble(words), above = bubble(neighbour)
        // The read that swaps the pending bubble for its row: the pending bubble was there and is gone.
        let pendingBubble = app.descendants(matching: .any).matching(identifier: "pending-send").firstMatch
        var ys: [(Double, Double)] = []
        var ns: [(Double, Double)] = []
        var looks = 0
        var sawPending = false
        var readAt: Double?
        // The send's own animated move to the newest message is over by now, well before the post answers.
        Thread.sleep(forTimeInterval: max(0, 0.8 - Date().timeIntervalSince(t0)))
        let started = Date().timeIntervalSince(t0)
        while true {
            let t = Date().timeIntervalSince(t0)
            // Ends 4 s past the read, once both messages have been looked at since it.
            if t >= 60 { break }
            if let r = readAt, t >= r + 4, (ys.last?.0 ?? 0) > r, (ns.last?.0 ?? 0) > r { break }
            looks += 1
            // Each reading is stamped after its query, so "before the post answered" cannot be a reading taken after it.
            if sent.exists { let y = Double(sent.frame.minY); if y.isFinite { ys.append((Date().timeIntervalSince(t0), y)) } }   // an instant with no layout is skipped
            if above.exists { let y = Double(above.frame.minY); if y.isFinite { ns.append((Date().timeIntervalSince(t0), y)) } }
            if readAt == nil {
                if pendingBubble.exists { sawPending = true } else if sawPending { readAt = Date().timeIntervalSince(t0) }
            }
            Thread.sleep(forTimeInterval: 0.25)
        }
        let trail = ys.map { String(format: "%.2f:%.0f", $0.0, $0.1) }.joined(separator: " ")
        let ntrail = ns.map { String(format: "%.2f:%.0f", $0.0, $0.1) }.joined(separator: " ")
        print("kosmos#7348 trail \(words): read \(readAt.map { String(format: "%.2f", $0) } ?? "never") looks \(looks) | sent \(trail) | above \(ntrail)")   // a pass shows what it saw
        // A real move fails however few looks there were.
        let nlo = ns.map(\.1).min() ?? 0, nhi = ns.map(\.1).max() ?? 0
        XCTAssertLessThanOrEqual(nhi - nlo, 1, "'\(neighbour)', above the sent message, moved \(nhi - nlo) pt: \(ntrail)")
        let lo = ys.map(\.1).min() ?? 0, hi = ys.map(\.1).max() ?? 0
        XCTAssertLessThanOrEqual(hi - lo, 1, "'\(words)' moved \(hi - lo) pt as the send settled: \(trail)")
        // A step is a lasting offset, so one look before the post answers and one after the read are enough to see it.
        var thin: [String] = []
        if (ys.first?.0 ?? 99) >= Self.pace { thin.append("the first look came after the post answered") }
        if (ns.first?.0 ?? 99) >= Self.pace { thin.append("'\(neighbour)' was first seen after the post answered") }
        if readAt == nil { thin.append("the read was never seen") }
        if let r = readAt, (ys.last?.0 ?? 0) <= r || (ns.last?.0 ?? 0) <= r { thin.append("no look after the read") }
        guard !thin.isEmpty else { return }
        let why = thin.joined(separator: ", ") + ": \(trail)"
        // A machine too busy to look could not test this: the tap or the first reading outlasted the post. Said as a skip, as
        // #7654's checks do. A message seen in time, or never seen at all, with too little to go on is a real failure.
        if started >= Self.pace || (ys.first?.0 ?? 0) >= Self.pace || (ns.first?.0 ?? 0) >= Self.pace { throw XCTSkip("too slow to measure, \(looks) looks: \(why)") }
        XCTFail(why)
    }
}
