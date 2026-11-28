import Foundation

/* kosmos#8959 slice D2b1: the computer's Connections, native and read only. It reads GET /api/connections/held, the disk
   only (server.js connectionsHeld): never GET /api/connections, which runs a live check on every service and bills the
   person's own search quota for each (#1636). So each row says what is SAVED on the computer, not whether it works, in
   the phone's own words (the page words a live check's answer, which the phone does not have): the plan on the card. */
enum Conn {
    enum Words {
        static let title = "Connections"
        static let reading = "Reading your connections…"
        static let failed = "We could not read the connections on this computer."
        static let empty = "No connections on this computer yet."
        static let footer = "Connect, check or remove a service in Settings on your computer."
        static let savedToken = "Saved on your computer"
        static let savedSignIn = "Signed in on your computer"
        static let notConnected = "Not connected"
        static let unknown = "Signed in through its own tool, if at all: Kosmos cannot tell from here"
    }

    enum State: String, Equatable { case saved, none, unknown }

    struct Service: Equatable {
        let name: String
        let signIn: Bool         // how === 'sign-in' (else a token)
        let state: State
        var line: String {
            switch state {
            case .saved: return signIn ? Words.savedSignIn : Words.savedToken
            case .none: return Words.notConnected
            case .unknown: return Words.unknown
            }
        }
    }

    // The computer's cookie by hand and the board's header, as Settings' other screens sign theirs. The route's
    // cross-site guard lets a same-origin read through.
    static func request(_ mac: Settings.Mac) -> URLRequest {
        var r = URLRequest(url: URL(string: "/api/connections/held", relativeTo: mac.url)!.absoluteURL)
        r.cachePolicy = .reloadIgnoringLocalCacheData
        r.timeoutInterval = 15
        r.httpShouldHandleCookies = false
        r.setValue("\(Board.macCookieName)=\(mac.cookie)", forHTTPHeaderField: "Cookie")
        r.setValue("same-origin", forHTTPHeaderField: Board.fetchSiteHeader)
        r.setValue("application/json", forHTTPHeaderField: "Accept")
        return r
    }

    // held: a JSON true is saved, false is none, null (or absent) is a tool's own sign-in Kosmos cannot see. A number
    // is not a boolean here (JSONSerialization bridges 1 to true).
    static func state(_ v: Any?) -> State {
        guard let n = v as? NSNumber, CFGetTypeID(n) == CFBooleanGetTypeID() else { return .unknown }
        return n.boolValue ? .saved : .none
    }

    enum Read: Equatable { case got([Service]), failed(String) }

    // A 200 whose `services` is a list; each row needs a name. Anything else is the could-not-read sentence.
    static func read(status: Int, data: Data) -> Read {
        guard status == 200, let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let rows = obj["services"] as? [[String: Any]] else { return .failed(Words.failed) }
        let services = rows.compactMap { r -> Service? in
            guard let name = (r["name"] as? String).map({ $0.trimmingCharacters(in: .whitespacesAndNewlines) }), !name.isEmpty
            else { return nil }
            return Service(name: name, signIn: r["how"] as? String == "sign-in", state: state(r["held"]))
        }
        return .got(services)
    }

    // The sample build's services: one of each state and both kinds.
    static let sampleList = #"""
    {"services":[
     {"name":"GitHub","route":"/api/github","how":"sign-in","held":true},
     {"name":"Vercel","route":"/api/vercel","how":"sign-in","held":null,"tool":true},
     {"name":"Cloudflare","route":"/api/cloudflare","how":"token","held":false,"connect":"cloudflare"},
     {"name":"Brave Search","route":"/api/svc/brave","how":"token","held":true,"connect":"brave"}
    ]}
    """#
}
