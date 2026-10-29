import CryptoKit
import XCTest

// kosmos#7559: a real sign-in on a simulator, typed by the test, so a phone sign-in can be measured on a Mac with no
// Simulator window. Run by ios/tools/ui-signin.sh, which hands it, as TEST_RUNNER_ environment only (never the repo):
//   KOSMOS_UI_EMAIL      the test account's address
//   KOSMOS_UI_TOTP_FILE  a file (0600) holding its authenticator's otpauth:// URL; never printed, never in the environment
//   KOSMOS_UI_CODE_FILE  a path the runner writes the emailed six-digit code to, once it has it
// The test finds each control by the words on the screen, as a person does, so it reads the sign-in as it ships.
final class SignInUITests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    func testSignInReachesTheBoard() throws {
        let env = ProcessInfo.processInfo.environment
        guard let email = env["KOSMOS_UI_EMAIL"], !email.isEmpty,
              let totpFile = env["KOSMOS_UI_TOTP_FILE"], !totpFile.isEmpty,
              let codeFile = env["KOSMOS_UI_CODE_FILE"], !codeFile.isEmpty else {
            throw XCTSkip("run by ios/tools/ui-signin.sh, which gives the account (KOSMOS_UI_EMAIL, KOSMOS_UI_TOTP_FILE, KOSMOS_UI_CODE_FILE)")
        }
        let otpauth = try String(contentsOfFile: totpFile, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines)
        let app = XCUIApplication()
        app.launch()

        step("the email") {
            let field = app.textFields["Email address"]
            XCTAssertTrue(field.waitForExistence(timeout: 30), "the sign-in screen did not show its email field")
            field.tap()
            field.typeText(email)
            app.buttons["Send code"].tap()
        }

        step("the emailed code") {
            XCTAssertTrue(app.staticTexts["Check your email"].waitForExistence(timeout: 30), "the code was not sent (no \"Check your email\")")
            let code = try Self.waitForCode(at: codeFile, timeout: 240)
            let field = app.textFields["Six-digit code"]
            field.tap()
            field.typeText(code)
            app.buttons["Sign in"].tap()
        }

        step("the second step") {
            XCTAssertTrue(app.staticTexts["One more step"].waitForExistence(timeout: 30), "no second step was asked for")
            // A fresh code, at least 5 s from its end, so it does not expire between typing and sending.
            if Self.secondsLeftInStep() < 5 { Thread.sleep(forTimeInterval: Double(Self.secondsLeftInStep()) + 1) }
            let code = try Self.totp(otpauth)
            let field = app.textFields["Six-digit code"]
            field.tap()
            field.typeText(code)
            app.buttons["Sign in"].tap()
        }

        step("the board") {
            // The board's tab bar is the app past sign-in; the sign-in's own words must be gone. An account with no computer
            // connected signs in but has no board, and says so ("Signed in", "Continue to the app"): a different answer.
            // Review 1: the tab bar shows as soon as sign-in ends, board or not; the Agents list's rows, or its "No agents
            // yet", come only from the board's own answer (AgentsView: every other state is a connection message).
            let noComputer = { app.buttons["Continue to the app"].exists && app.staticTexts["Signed in"].exists }
            let askedAllow = { app.staticTexts["Allow this iPhone on your Mac"].exists }
            // Review 2: the test opens Agents itself (the app opens there today, AppTabs.todayTab being off, but it does not
            // rely on that), and waits on the two names AgentsView gives only what the board's answer draws ("agents-list",
            // or "agents-empty" for no agents). Review 2 said the app opens on Today; it does only in the screenshot build.
            let agentsTab = app.tabBars.buttons["Agents"]
            let named = { (id: String) in app.descendants(matching: .any).matching(identifier: id).firstMatch.exists }
            let boardAnswered = { agentsTab.isSelected && (named("agents-list") || named("agents-empty")) }
            let deadline = Date().addingTimeInterval(120)
            while Date() < deadline && !boardAnswered() && !noComputer() && !askedAllow() {
                if agentsTab.exists && !agentsTab.isSelected { agentsTab.tap() }
                Thread.sleep(forTimeInterval: 1)
            }
            XCTAssertFalse(askedAllow(), "the computer asked for an Allow: a hosted box should let its own account in")
            XCTAssertFalse(noComputer(), "signed in, but this account has no computer connected, so there is no board to load")
            XCTAssertTrue(app.tabBars.buttons["Agents"].exists, "signed in, but the app did not move past sign-in within 120 s")
            XCTAssertTrue(agentsTab.isSelected, "the Agents tab could not be opened")
            XCTAssertTrue(boardAnswered(), "the app is past sign-in but the board did not answer within 120 s (no agents list, no \"No agents yet\" on Agents)")
            XCTAssertFalse(app.staticTexts["One more step"].exists)
        }
    }

    /// Runs one named step, so a failure says which one and leaves a screenshot of it in the result.
    private func step(_ name: String, _ body: () throws -> Void) {
        XCTContext.runActivity(named: "STEP " + name) { activity in
            do { try body() } catch { XCTFail("STEP \(name): \(error)") }
            let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            shot.name = name
            shot.lifetime = .keepAlways
            activity.add(shot)
        }
    }

    /// The emailed code, once the runner has written it: six digits and nothing else.
    static func waitForCode(at path: String, timeout: TimeInterval) throws -> String {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if let s = try? String(contentsOfFile: path, encoding: .utf8) {
                let code = s.trimmingCharacters(in: .whitespacesAndNewlines)
                if code.count == 6, code.allSatisfy({ $0.isASCII && $0.isNumber }) { return code }   // review 2: ASCII digits only
            }
            Thread.sleep(forTimeInterval: 1)
        }
        throw Failure("no emailed code arrived at the runner's path within \(Int(timeout)) s")
    }

    struct Failure: Error, CustomStringConvertible { let description: String; init(_ d: String) { description = d } }

    static func secondsLeftInStep(now: Date = Date()) -> Int { 30 - Int(now.timeIntervalSince1970) % 30 }

    /// RFC 6238 (SHA1, 6 digits, 30 s), from the otpauth:// URL's secret. Throws, never prints, on a URL it cannot read.
    static func totp(_ otpauth: String, at now: Date = Date()) throws -> String {
        guard let items = URLComponents(string: otpauth)?.queryItems,
              let secret = items.first(where: { $0.name == "secret" })?.value,
              let key = base32(secret), !key.isEmpty else { throw Failure("the authenticator URL could not be read") }
        let param = { (name: String) in items.first(where: { $0.name == name })?.value }
        // Review 1: only what this computes (SHA1, 6 digits, 30 s), so another kind fails with its reason, not a wrong code.
        if let a = param("algorithm"), a.uppercased() != "SHA1" { throw Failure("the authenticator uses \(a), not SHA1") }
        if let d = param("digits"), d != "6" { throw Failure("the authenticator gives \(d) digits, not 6") }
        if let p = param("period"), p != "30" { throw Failure("the authenticator's period is \(p) s, not 30") }
        var counter = UInt64(now.timeIntervalSince1970 / 30).bigEndian
        let mac = HMAC<Insecure.SHA1>.authenticationCode(for: Data(bytes: &counter, count: 8), using: SymmetricKey(data: key))
        let bytes = Array(mac)
        let offset = Int(bytes[bytes.count - 1] & 0x0f)
        let value = (UInt32(bytes[offset] & 0x7f) << 24) | (UInt32(bytes[offset + 1]) << 16) | (UInt32(bytes[offset + 2]) << 8) | UInt32(bytes[offset + 3])
        return String(format: "%06u", value % 1_000_000)
    }

    static func base32(_ s: String) -> Data? {
        let alphabet = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZ234567")
        var bits = 0, value = 0
        var out = Data()
        for ch in s.uppercased() where ch != "=" && ch != " " {
            guard let i = alphabet.firstIndex(of: ch) else { return nil }
            value = (value << 5) | i
            bits += 5
            if bits >= 8 { out.append(UInt8((value >> (bits - 8)) & 0xff)); bits -= 8 }
        }
        return out
    }
}

// Review 2: the board check itself, against the Debug build's sample board (no account, no network): on Today the agents
// list is not found (the control: the check cannot pass on the tab it starts on), and once Agents is opened it is.
final class BoardCheckTests: XCTestCase {
    func testTheBoardCheckFindsTheAgentsListOnlyOnAgents() {
        let app = XCUIApplication()
        app.launchEnvironment["KOSMOS_SAMPLE_AGENTS"] = "1"
        // The app opens on Agents (AppTabs.todayTab is off outside the App Store screenshot build), so the control starts
        // on another tab, Projects (KOSMOS_SAMPLE_TAB, ContentView.startTab), where the agents list must not be found.
        app.launchEnvironment["KOSMOS_SAMPLE_TAB"] = "projects"
        app.launch()
        let agentsTab = app.tabBars.buttons["Agents"]
        XCTAssertTrue(agentsTab.waitForExistence(timeout: 30), "the sample board did not open")
        let list = app.descendants(matching: .any).matching(identifier: "agents-list").firstMatch
        // Opened on Projects, so the control always runs; if that ever changes, this says so rather than skipping it.
        XCTAssertFalse(agentsTab.isSelected, "setup: the sample board did not open on Projects, so the control below cannot run")
        XCTAssertFalse(list.exists, "CONTROL: the agents list was found while Agents was not the open tab")
        agentsTab.tap()
        XCTAssertTrue(agentsTab.isSelected, "the Agents tab could not be opened")
        XCTAssertTrue(list.waitForExistence(timeout: 15), "the agents list (agents-list) was not found on Agents")
    }
}

// The code maths, checked against RFC 6238's own test vector (no account needed): runs in every `xcodebuild test`.
final class TOTPTests: XCTestCase {
    func testAnotherKindOfAuthenticatorIsRefused() {
        XCTAssertThrowsError(try SignInUITests.totp("otpauth://totp/x?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&digits=8"))
        XCTAssertThrowsError(try SignInUITests.totp("otpauth://totp/x?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&algorithm=SHA256"))
        XCTAssertThrowsError(try SignInUITests.totp("otpauth://totp/x?secret="))
        XCTAssertNoThrow(try SignInUITests.totp("otpauth://totp/x?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&algorithm=SHA1&digits=6&period=30"), "CONTROL")
    }

    func testRFC6238Vector() throws {
        // RFC 6238 appendix B, SHA1, secret "12345678901234567890" (base32 GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ):
        // at T = 59 s the 8-digit value is 94287082, so the 6-digit code is 287082.
        let url = "otpauth://totp/x?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&digits=6&period=30"
        XCTAssertEqual(try SignInUITests.totp(url, at: Date(timeIntervalSince1970: 59)), "287082")
        XCTAssertEqual(try SignInUITests.totp(url, at: Date(timeIntervalSince1970: 1111111109)), "081804")
    }
}
