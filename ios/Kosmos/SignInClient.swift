import Foundation
import CryptoKit
import UIKit

// kosmos#7042: the native sign-in's calls to Kosmos+ and this iPhone's device key. The decisions are SignInLogic.swift's
// (proven in ios/LogicTests); this file only carries them over the network and the keychain.
@MainActor
final class SignInClient {
    private let coordinator: URL
    private let http: URLSession
    private let keyStore: SessionStore

    init(coordinator: URL = KosmosConfig.coordinatorOrigin, keyStore: SessionStore = SignInClient.deviceKeyStore) {
        self.coordinator = coordinator
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 15
        // No cookies: these calls carry what they need in the body or as Bearer, and the web view keeps its own.
        config.httpCookieAcceptPolicy = .never
        config.httpShouldSetCookies = false
        http = URLSession(configuration: config, delegate: RefuseRedirects(), delegateQueue: nil)
        self.keyStore = keyStore
    }

    /// Where this iPhone's sign-in key is kept: its own keychain item, on this device only (never in a backup).
    nonisolated static let deviceKeyStore: SessionStore = SessionKeychain(account: "signin-device-key")

    /// The name the Mac's Allow card shows. iOS gives apps the model name only ("iPhone"), which is what is sent.
    var deviceName: String { UIDevice.current.name }

    // MARK: - The device key

    /// This install's key, made on first use. On a device it is a Secure Enclave key: what is kept is the enclave's
    /// own wrapped form, which no other device can use. Where there is no Secure Enclave (the simulator), a software
    /// key, kept in the same this-device-only item.
    func deviceKey() throws -> SignIn.DeviceKey {
        if let kept = keyStore.load(), let key = Self.read(kept) { return key }
        let made: (stored: String, key: SignIn.DeviceKey)
        if SecureEnclave.isAvailable {
            let k = try SecureEnclave.P256.Signing.PrivateKey()
            made = ("se:" + k.dataRepresentation.base64EncodedString(),
                    SignIn.DeviceKey(spki: k.publicKey.derRepresentation, sign: { try k.signature(for: $0).rawRepresentation }))
        } else {
            let k = P256.Signing.PrivateKey()
            made = ("sw:" + k.rawRepresentation.base64EncodedString(), .software(k))
        }
        guard keyStore.save(made.stored) else { throw SignInError.keyNotKept }
        return made.key
    }

    /// Forget the key (the coordinator refused its proof): the next sign-in makes a new one, which the Mac allows once.
    func forgetDeviceKey() { keyStore.delete() }

    private static func read(_ stored: String) -> SignIn.DeviceKey? {
        if stored.hasPrefix("se:"), let data = Data(base64Encoded: String(stored.dropFirst(3))),
           let k = try? SecureEnclave.P256.Signing.PrivateKey(dataRepresentation: data) {
            return SignIn.DeviceKey(spki: k.publicKey.derRepresentation, sign: { try k.signature(for: $0).rawRepresentation })
        }
        if stored.hasPrefix("sw:"), let data = Data(base64Encoded: String(stored.dropFirst(3))),
           let k = try? P256.Signing.PrivateKey(rawRepresentation: data) {
            return .software(k)
        }
        return nil
    }

    // MARK: - The calls

    enum SignInError: Error { case keyNotKept, unreachable }

    /// start: true when a code is on its way (or would be: the answer is the same for any address), false when this
    /// address's company requires its own sign-in, which the web page has.
    func start(email: String) async throws -> Bool {
        let key = try deviceKey()
        let (status, json) = try await post(SignIn.startPath, SignIn.startBody(email: email, deviceID: key.id, deviceName: deviceName))
        guard (200..<300).contains(status) else {
            throw SignInRefusal(message: SignIn.cleanMessage((json as? [String: Any])?["error"]) ?? "Kosmos+ could not send a code just now. Try again in a minute.")
        }
        return !SignIn.companySignInRequired(json: json)
    }

    func verify(email: String, code: String) async throws -> SignIn.Answer {
        let key = try deviceKey()
        let (status, json) = try await post(SignIn.verifyPath, try SignIn.verifyBody(email: email, code: code, deviceName: deviceName, key: key))
        return SignIn.answer(status: status, json: json)
    }

    func second(challenge: String, code: String) async throws -> SignIn.Answer {
        let (status, json) = try await post(SignIn.secondPath, SignIn.secondBody(challenge: challenge, code: code))
        return SignIn.answer(status: status, json: json)
    }

    /// The Allow, as Kosmos+ knows it now; nil when the answer says nothing usable (asked again on the next tick).
    func allowStatus(token: String) async -> SignIn.DeviceStatus? {
        var request = URLRequest(url: coordinator.appendingPathComponent(SignIn.mePath))
        request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
        guard let (data, response) = try? await http.data(for: request), let answer = response as? HTTPURLResponse else { return nil }
        return SignIn.allowStatus(status: answer.statusCode, json: try? JSONSerialization.jsonObject(with: data))
    }

    private func post(_ path: String, _ body: [String: Any]) async throws -> (Int, Any?) {
        var request = URLRequest(url: coordinator.appendingPathComponent(path))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        guard let (data, response) = try? await http.data(for: request), let answer = response as? HTTPURLResponse else {
            throw SignInError.unreachable
        }
        return (answer.statusCode, try? JSONSerialization.jsonObject(with: data))
    }
}

/// A refusal with the coordinator's own sentence (or the app's), for the screen to show as it is.
struct SignInRefusal: Error { let message: String }

/// No redirect is followed: none of these calls expects one, and following it could carry a code or the session to
/// another host.
private final class RefuseRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}
