import CryptoKit
import XCTest

// kosmos#7559: a real sign-in on a simulator, typed by the test, so a phone sign-in can be measured on a Mac with no
// Simulator window. Run by ios/tools/ui-signin.sh, which hands it, as TEST_RUNNER_ environment only (never the repo):
//   KOSMOS_UI_EMAIL      the test account's address
//   KOSMOS_UI_TOTP       its authenticator's otpauth:// URL (the second step), never printed
//   KOSMOS_UI_CODE_FILE  a path the runner writes the emailed six-digit code to, once it has it
// The test finds each control by the words on the screen, as a person does, so it reads the sign-in as it ships.
final class SignInUITests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    func testSignInReachesTheBoard() throws {
        let env = ProcessInfo.processInfo.environment
        guard let email = env["KOSMOS_UI_EMAIL"], !email.isEmpty,
              let otpauth = env["KOSMOS_UI_TOTP"], !otpauth.isEmpty,
              let codeFile = env["KOSMOS_UI_CODE_FILE"], !codeFile.isEmpty else {
            throw XCTSkip("run by ios/tools/ui-signin.sh, which gives the account (KOSMOS_UI_EMAIL, KOSMOS_UI_TOTP, KOSMOS_UI_CODE_FILE)")
        }
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
            let board = app.tabBars.buttons["Agents"]
            let noComputer = app.buttons["Continue to the app"]
            let deadline = Date().addingTimeInterval(120)
            while Date() < deadline && !board.exists && !(noComputer.exists && app.staticTexts["Signed in"].exists) { Thread.sleep(forTimeInterval: 1) }
            XCTAssertFalse(noComputer.exists && app.staticTexts["Signed in"].exists, "signed in, but this account has no computer connected, so there is no board to load")
            XCTAssertTrue(board.exists, "the board did not load (no Agents tab) within 120 s of the second step")
            XCTAssertFalse(app.staticTexts["One more step"].exists)
            XCTAssertFalse(app.staticTexts["Allow this iPhone on your Mac"].exists, "the box asked for an Allow")
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
                if code.count == 6, code.allSatisfy(\.isNumber) { return code }
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
              let key = base32(secret) else { throw Failure("the authenticator URL could not be read") }
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

// The code maths, checked against RFC 6238's own test vector (no account needed): runs in every `xcodebuild test`.
final class TOTPTests: XCTestCase {
    func testRFC6238Vector() throws {
        // RFC 6238 appendix B, SHA1, secret "12345678901234567890" (base32 GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ):
        // at T = 59 s the 8-digit value is 94287082, so the 6-digit code is 287082.
        let url = "otpauth://totp/x?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&digits=6&period=30"
        XCTAssertEqual(try SignInUITests.totp(url, at: Date(timeIntervalSince1970: 59)), "287082")
        XCTAssertEqual(try SignInUITests.totp(url, at: Date(timeIntervalSince1970: 1111111109)), "081804")
    }
}
