import Foundation

// kosmos#6838: BoardClient as the app runs it, with the real network, clock, waits and
// Keychain. ios/LogicTests builds it with a fake environment instead (BoardClient.Environment).
extension BoardClient {
    convenience init() {
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieAcceptPolicy = .always
        config.timeoutIntervalForRequest = 15
        // An ephemeral configuration carries its own private, in-memory cookie store; the client holds the same store.
        let jar = config.httpCookieStorage ?? HTTPCookieStorage()
        config.httpCookieStorage = jar
        let http = URLSession(configuration: config, delegate: NoRedirects(), delegateQueue: nil)
        // kosmos#7071: uploads get their own session on the same cookie jar, with the Mac's five minutes to wait, so a
        // large file or one the Mac reads before it answers is not cut off by the 15 s every other call keeps.
        let uploadConfig = URLSessionConfiguration.ephemeral
        uploadConfig.httpCookieAcceptPolicy = .always
        uploadConfig.httpCookieStorage = jar
        uploadConfig.timeoutIntervalForRequest = Board.uploadTimeout
        let uploads = URLSession(configuration: uploadConfig, delegate: NoRedirects(), delegateQueue: nil)
        self.init(
            coordinator: KosmosConfig.coordinatorOrigin,
            sessionStore: SessionKeychain.live,
            macStore: SessionKeychain.macSession,
            cookies: jar,
            env: Environment(
                send: { request in
                    guard let (data, response) = try? await http.data(for: request),
                          let answer = response as? HTTPURLResponse
                    else { return nil }
                    return (data, answer)
                },
                sleep: { seconds in try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000)) },
                now: { Date() },
                defaults: .standard,
                // kosmos#7071: the file read from disk as it goes, with the same Mac cookie.
                upload: { request, file in
                    guard let (data, response) = try? await uploads.upload(for: request, fromFile: file),
                          let answer = response as? HTTPURLResponse
                    else { return nil }
                    return (data, answer)
                },
                // kosmos#7337: the sign-in's kept key, never a new one.
                deviceKey: { SignInClient.keptDeviceKey() }
            )
        )
    }
}

// No redirect is followed: none of these calls expects one, and following it could carry the bearer session or a
// handoff token to another host. A redirect therefore arrives as its own 3xx answer.
private final class NoRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}
