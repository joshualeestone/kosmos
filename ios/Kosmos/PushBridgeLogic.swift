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

    // MARK: - Where a tapped notification goes

    // The coordinator puts the Mac's address in every push as a top-level
    // `address` ("<mac name>.<relay domain>", kosmos-relay apns.rs payload()), and
    // a tap opens https://<address>/, the same URL the coordinator's own web-push
    // tap opens (coordinator sw.js). A push is not trusted input: only a single
    // ASCII DNS label directly under the relay domain is accepted, so a payload can
    // never steer the app's WebView to another site, a path, a port or a scheme.
    // The relay domain is the coordinator's host minus its first label
    // (login.kosmosplus.com -> kosmosplus.com), and the coordinator's own host is
    // refused: it is not a Mac.
    static func boardURL(fromNotification userInfo: [AnyHashable: Any], coordinator: URL) -> URL? {
        guard let raw = userInfo["address"] as? String,
              raw.unicodeScalars.allSatisfy({ $0.isASCII }),
              isMacHost(raw.lowercased(), coordinator: coordinator)
        else { return nil }
        var parts = URLComponents()
        parts.scheme = "https"
        parts.host = raw.lowercased()
        parts.path = "/"
        // kosmos#718 (agreed with Kano): a tap lands on the agent that asked, via the
        // board's own deep link (?tab=detail&agent=, read at boot by web/index.html).
        // The push's `session` is used only when it is a plain agent name; anything
        // else, or none, opens the board home, never a dead tap.
        if let session = userInfo["session"] as? String, isAgentSession(session) {
            parts.queryItems = [URLQueryItem(name: "tab", value: "detail"), URLQueryItem(name: "agent", value: session)]
        }
        return parts.url
    }

    // The board's agent-name characters (engine/create.js NAME_RE): lowercase letters,
    // digits, hyphen and underscore, starting with a letter or digit. No dots,
    // slashes, colons, percent signs, spaces or Unicode. The LENGTH is deliberately
    // wider than NAME_RE's 2 to 32 on both ends (1 to 64): a found agent's session
    // may not follow NAME_RE, and a name the board does not know just opens the
    // board home, so width here is safe while the character rule is what matters.
    static func isAgentSession(_ s: String) -> Bool {
        guard (1...64).contains(s.count), let first = s.unicodeScalars.first,
              ("a"..."z").contains(first) || ("0"..."9").contains(first)
        else { return false }
        return s.unicodeScalars.allSatisfy {
            ("a"..."z").contains($0) || ("0"..."9").contains($0) || $0 == "-" || $0 == "_"
        }
    }

    // A Mac's host: one RFC 1123 label directly under the coordinator's domain, and
    // never the coordinator's own host. Lowercase ASCII expected; callers lowercase.
    static func isMacHost(_ host: String, coordinator: URL) -> Bool {
        guard host.unicodeScalars.allSatisfy({ $0.isASCII }),
              let coordinatorHost = coordinator.host?.lowercased(),
              let relayDomain = relayDomain(ofCoordinatorHost: coordinatorHost),
              host != coordinatorHost
        else { return false }
        let suffix = "." + relayDomain
        guard host.hasSuffix(suffix) else { return false }
        return isHostLabel(String(host.dropLast(suffix.count)))
    }

    // "login.kosmosplus.com" -> "kosmosplus.com". Nil when the host has fewer than
    // three labels, so a misconfigured origin refuses every tap rather than
    // accepting everything under a top-level domain.
    static func relayDomain(ofCoordinatorHost host: String) -> String? {
        let labels = host.split(separator: ".", omittingEmptySubsequences: false)
        guard labels.count >= 3, labels.allSatisfy({ !$0.isEmpty }) else { return nil }
        return labels.dropFirst().joined(separator: ".")
    }

    // RFC 1123 label: 1 to 63 of a-z, 0-9 and hyphen, not starting or ending with a
    // hyphen. A punycode label (xn--) is refused too: it is how a lookalike Unicode
    // name would arrive in ASCII.
    private static func isHostLabel(_ label: String) -> Bool {
        guard (1...63).contains(label.count),
              label.first != "-", label.last != "-",
              !label.hasPrefix("xn--")
        else { return false }
        return label.unicodeScalars.allSatisfy {
            ("a"..."z").contains($0) || ("0"..."9").contains($0) || $0 == "-"
        }
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
