import Foundation

// The decisions behind APNs registration, kept free of UIKit and WebKit so they
// compile for macOS too and ios/LogicTests can prove them on a Mac with no iOS
// simulator runtime installed (#718). PushNotificationManager and the WebView
// bridge in ContentView are thin callers of what is here.
enum PushBridge {

    // MARK: - The session bridge's origin gate

    // Accept a session posted to the kosmosSession handler only when it comes from
    // the main frame of the coordinator's own origin (scheme, host and port all
    // exact). A subframe, plain http, a lookalike host or another port is refused:
    // the token is the person's session and must only come from the page that
    // issued it (kosmos-relay .claude/plans/apns-718.md).
    static func isTrustedSender(
        isMainFrame: Bool,
        scheme: String,
        host: String,
        port: Int,
        coordinator: URL
    ) -> Bool {
        guard isMainFrame,
              let wantScheme = coordinator.scheme?.lowercased(),
              let wantHost = coordinator.host?.lowercased()
        else { return false }
        // WebKit reports port 0 when the origin uses the scheme's default port.
        let wantPort = coordinator.port ?? 0
        let gotPort = (port == 443 && scheme.lowercased() == "https") ? 0 : port
        return scheme.lowercased() == wantScheme
            && host.lowercased() == wantHost
            && gotPort == wantPort
    }

    // MARK: - The session message

    enum SessionMessage: Equatable {
        case signedIn(String)
        case signedOut
    }

    // The page posts {token: "<KST>"} at sign-in and {token: null} at sign-out
    // (kosmos-relay d3c411e). WebKit hands the body over as an NSDictionary with
    // NSNull for null. Anything else (a bare string, a missing key, an empty or
    // non-string token) is refused rather than guessed at.
    static func parseSessionMessage(_ body: Any) -> SessionMessage? {
        guard let dict = body as? [String: Any], let value = dict["token"] else { return nil }
        if value is NSNull { return .signedOut }
        guard let token = value as? String, !token.isEmpty else { return nil }
        return .signedIn(token)
    }

    // MARK: - The APNs device token

    // Lowercase hex, the shape the coordinator validates (64 to 200 hex chars).
    static func hexToken(_ deviceToken: Data) -> String {
        deviceToken.map { String(format: "%02x", $0) }.joined()
    }

    // MARK: - Which APNs environment issued the token

    enum Environment: String {
        case production
        case sandbox
    }

    // A simulator token is always sandbox. Otherwise the provisioning profile the
    // app was signed with says which environment Apple issues tokens for: a
    // development profile means sandbox. App Store installs carry no profile at all,
    // which means production. Deciding by #if DEBUG instead would be wrong for a
    // Release build signed with a development profile, and every push to it would
    // fail with BadDeviceToken.
    static func environment(isSimulator: Bool, provisioningProfile: Data?) -> Environment {
        if isSimulator { return .sandbox }
        guard let profile = provisioningProfile else { return .production }
        return apsEnvironment(inProfile: profile) == "development" ? .sandbox : .production
    }

    // embedded.mobileprovision is a CMS-signed envelope around an XML plist. The
    // plist is readable as-is between its <?xml and </plist> markers, so no CMS
    // decoding (unavailable on iOS) is needed.
    static func apsEnvironment(inProfile data: Data) -> String? {
        guard let start = data.range(of: Data("<?xml".utf8)),
              let end = data.range(of: Data("</plist>".utf8), in: start.lowerBound..<data.endIndex)
        else { return nil }
        let xml = data.subdata(in: start.lowerBound..<end.upperBound)
        guard let plist = try? PropertyListSerialization.propertyList(from: xml, format: nil) as? [String: Any],
              let entitlements = plist["Entitlements"] as? [String: Any]
        else { return nil }
        return entitlements["aps-environment"] as? String
    }

    // MARK: - The two coordinator requests

    static let registerPath = "/v1/push/apns/register"
    static let unregisterPath = "/v1/push/apns/unregister"

    static func registerRequest(
        coordinator: URL,
        session: String,
        token: String,
        bundleID: String,
        environment: Environment
    ) -> URLRequest {
        request(coordinator: coordinator, path: registerPath, session: session, body: [
            "token": token,
            "bundle_id": bundleID,
            "environment": environment.rawValue,
        ])
    }

    static func unregisterRequest(coordinator: URL, session: String, token: String) -> URLRequest {
        request(coordinator: coordinator, path: unregisterPath, session: session, body: ["token": token])
    }

    private static func request(
        coordinator: URL,
        path: String,
        session: String,
        body: [String: String]
    ) -> URLRequest {
        var req = URLRequest(url: coordinator.appendingPathComponent(String(path.dropFirst())))
        req.httpMethod = "POST"
        req.setValue("Bearer \(session)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        // Never cached, never sent with cookies: the Bearer session is the only auth.
        req.cachePolicy = .reloadIgnoringLocalCacheData
        req.httpShouldHandleCookies = false
        req.timeoutInterval = 20
        req.httpBody = try? JSONSerialization.data(withJSONObject: body, options: [.sortedKeys])
        return req
    }

    // MARK: - What a response means for the stored session

    enum Outcome: Equatable {
        case ok
        // 401: the session is dead. Forget it, or every launch retries it forever.
        case sessionRejected
        // 403: the account refused this device. The session stays (it is still the
        // person's); nothing is registered until they allow the device.
        case deviceRefused
        // 400 or anything else unexpected: nothing to change, log the status.
        case failed(Int)
        // No HTTP answer at all. Keep everything; the token is re-delivered next launch.
        case unreachable
    }

    static func outcome(status: Int?) -> Outcome {
        switch status {
        case .some(200...299): return .ok
        case .some(401): return .sessionRejected
        case .some(403): return .deviceRefused
        case .some(let s): return .failed(s)
        case .none: return .unreachable
        }
    }
}
