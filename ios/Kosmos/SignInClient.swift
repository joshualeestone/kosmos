import Foundation
import CryptoKit
import UIKit
import AuthenticationServices

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

    /// Forget the key (the coordinator refused its proof, or a review sign-in made a session that is not this key's): the
    /// next code sign-in makes a new one, which the Mac allows once.
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

    /// What start said: a code is on its way (or would be: the answer is the same for any address), with the
    /// company's own sign-in offered beside it or required instead (kosmos#7045). `company` nil with `required`:
    /// the address Kosmos+ gave is not one this app opens, so the web page takes over.
    struct Started { let codeComing: Bool; let company: URL? }

    func start(email: String) async throws -> Started {
        let key = try deviceKey()
        let (status, json) = try await post(SignIn.startPath, SignIn.startBody(email: email, deviceID: key.id, deviceName: deviceName))
        guard (200..<300).contains(status) else {
            throw SignInRefusal(message: SignIn.cleanMessage((json as? [String: Any])?["error"]) ?? "Kosmos+ could not send a code just now. Try again in a minute.")
        }
        let company = canUseCompanySheet ? SignIn.companySignInURL(json: json, coordinator: coordinator) : nil
        return Started(codeComing: !SignIn.companySignInRequired(json: json), company: company)
    }

    // MARK: - A company's own sign-in, in Apple's sheet (kosmos#7045)

    private var companySession: ASWebAuthenticationSession?
    private let anchor = SheetAnchor()

    /// Whether Apple's sheet can finish on Kosmos+'s https return (iOS 17.4 and later). Earlier, the company sign-in
    /// is the web page's.
    var canUseCompanySheet: Bool {
        if #available(iOS 17.4, *) { return true }
        return false
    }

    /// Opens Kosmos+'s company sign-in in Apple's sheet and gives back where it returned (Kosmos+'s /signin, which the
    /// sheet hands only to this app: the app is associated with the host), or nil when the person closed the sheet, it
    /// could not open, or this iOS cannot finish on an https return. Shares Safari's sign-ins, so a company account
    /// already signed in there is not asked again.
    func openCompanySignIn(_ url: URL) async -> URL? {
        guard #available(iOS 17.4, *), let host = coordinator.host else { return nil }
        return await withCheckedContinuation { (done: CheckedContinuation<URL?, Never>) in
            var resumed = false
            let finish: (URL?) -> Void = { url in
                guard !resumed else { return }
                resumed = true
                done.resume(returning: url)
            }
            let session = ASWebAuthenticationSession(url: url, callback: .https(host: host, path: SignIn.returnPath)) { [weak self] back, _ in
                DispatchQueue.main.async { self?.companySession = nil; finish(back) }
            }
            session.presentationContextProvider = anchor
            companySession = session
            if !session.start() { companySession = nil; finish(nil) }
        }
    }

    // MARK: - Passkey sign-in (kosmos#7050 slice C)

    /// What begin said: an offer a passkey can answer, passkeys switched off (a 404: the route is not there), or an
    /// answer that is neither (a server error, an offer for another host). Throws SignInError.unreachable when Kosmos+
    /// did not answer at all.
    enum PasskeyBegin { case offer(SignIn.PasskeyOffer), off, unusable(String?) }

    func passkeyOffer() async throws -> PasskeyBegin {
        let (status, json) = try await post(SignIn.passkeyBeginPath, [:])
        if status == 404 { return .off }
        if let offer = SignIn.passkeyOffer(status: status, json: json, coordinator: coordinator) { return .offer(offer) }
        return .unusable(SignIn.cleanMessage((json as? [String: Any])?["error"]))
    }

    /// What Apple's passkey sheet said.
    enum PasskeyAnswer { case assertion(ASAuthorizationPlatformPublicKeyCredentialAssertion), cancelled, failed }

    private var passkeyAsker: PasskeyAsker?
    /// Kept until the sheet answers: the controller is not kept by anything else, and one released early answers
    /// nobody (the company sheet's session is kept the same way).
    private var passkeyController: ASAuthorizationController?

    /// Closes an open passkey sheet (the person went back, or signed out): its ask answers `cancelled`, so nothing is
    /// left waiting on a sheet that may never answer.
    func cancelPasskey() {
        // Cleared now, not when the answer arrives on the main queue: a press straight after must find no sheet open.
        let asker = passkeyAsker, controller = passkeyController
        passkeyAsker = nil
        passkeyController = nil
        controller?.cancel()
        asker?.answer(.cancelled)
    }

    /// Apple's passkey sheet for this offer: the person's passkey for Kosmos+ (any saved on this iPhone or in their
    /// iCloud Keychain, for the host this app is associated with), with Face ID, Touch ID or the passcode. One sheet at a
    /// time: a second ask while one is open is answered `failed` at once (its continuation would otherwise be lost).
    func passkeyAssert(_ offer: SignIn.PasskeyOffer) async -> PasskeyAnswer {
        guard passkeyAsker == nil else { return .failed }
        let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: offer.rpID)
        let request = provider.createCredentialAssertionRequest(challenge: offer.challenge)
        request.userVerificationPreference = .required
        return await withCheckedContinuation { (done: CheckedContinuation<PasskeyAnswer, Never>) in
            var asker: PasskeyAsker?
            asker = PasskeyAsker { [weak self] got in
                // PasskeyAsker hands back on the main queue, once. Only this sheet's own record is cleared: a cancel may
                // already have cleared it and a newer sheet be open.
                if let self, self.passkeyAsker === asker { self.passkeyAsker = nil; self.passkeyController = nil }
                done.resume(returning: got)
            }
            passkeyAsker = asker
            let controller = ASAuthorizationController(authorizationRequests: [request])
            passkeyController = controller
            controller.delegate = asker
            controller.presentationContextProvider = asker
            controller.performRequests()
            // A sheet that never answers (the system tearing it down without a callback) is closed after six minutes,
            // past the challenge's five, so the screen is never left busy for good.
            DispatchQueue.main.asyncAfter(deadline: .now() + 360) { [weak self, weak asker] in
                if let self, let asker, self.passkeyAsker === asker { self.cancelPasskey() }
            }
        }
    }

    /// finish, with this iPhone's device id (the one verify proves next).
    func passkeyFinish(_ assertion: ASAuthorizationPlatformPublicKeyCredentialAssertion) async throws -> SignIn.PasskeyFinish {
        // The SDK declares these implicitly unwrapped; a missing one is a failed sign-in, never a crash.
        let credentialID: Data? = assertion.credentialID, authenticatorData: Data? = assertion.rawAuthenticatorData
        let clientData: Data? = assertion.rawClientDataJSON, signature: Data? = assertion.signature
        guard let credentialID, let authenticatorData, let clientData, let signature else { return .refused(SignIn.passkeyWords.failed) }
        let key = try deviceKey()
        let userID: Data? = assertion.userID
        let body = SignIn.passkeyFinishBody(credentialID: credentialID, authenticatorData: authenticatorData,
                                            clientDataJSON: clientData, signature: signature,
                                            userHandle: userID, deviceID: key.id)
        let (status, json) = try await post(SignIn.passkeyFinishPath, body)
        return SignIn.passkeyFinish(status: status, json: json)
    }

    func verify(email: String, code: String) async throws -> SignIn.Answer {
        let key = try deviceKey()
        let (status, json) = try await post(SignIn.verifyPath, try SignIn.verifyBody(email: email, code: code, deviceName: deviceName, key: key))
        return SignIn.answer(status: status, json: json)
    }

    // kosmos#7357: whether the review door is open (a GET: 405 open, 404 closed), and the password sign-in through it.
    func reviewDoorOpen() async -> Bool? {
        let request = URLRequest(url: coordinator.appendingPathComponent(SignIn.reviewPath))
        guard let (_, response) = try? await http.data(for: request), let answer = response as? HTTPURLResponse else { return nil }
        return SignIn.reviewDoorOpen(status: answer.statusCode)
    }

    func reviewSignIn(email: String, password: String) async throws -> SignIn.ReviewAnswer {
        let (status, json) = try await post(SignIn.reviewPath, SignIn.reviewBody(email: email, password: password, deviceName: deviceName))
        return SignIn.reviewAnswer(status: status, json: json)
    }

    func second(challenge: String, code: String) async throws -> SignIn.Answer {
        let (status, json) = try await post(SignIn.secondPath, SignIn.secondBody(challenge: challenge, code: code))
        return SignIn.answer(status: status, json: json)
    }

    /// The Allow, as Kosmos+ knows it now.
    func allowRead(token: String) async -> SignIn.AllowRead {
        var request = URLRequest(url: coordinator.appendingPathComponent(SignIn.mePath))
        request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
        guard let (data, response) = try? await http.data(for: request), let answer = response as? HTTPURLResponse else { return .unknown }
        return SignIn.allowRead(status: answer.statusCode, json: try? JSONSerialization.jsonObject(with: data))
    }

    // kosmos#7046: setting up a required second step, with the enrol-only token verify gave (never a session).
    func enrol(token: String) async throws -> SignIn.Enrolled {
        let (status, json) = try await post(SignIn.enrolPath, SignIn.enrolBody(), bearer: token)
        return SignIn.enrolled(status: status, json: json)
    }

    func confirmSetup(token: String, code: String) async throws -> SignIn.Answer {
        let (status, json) = try await post(SignIn.confirmPath, SignIn.confirmBody(code: code), bearer: token)
        return SignIn.answer(status: status, json: json)
    }

    private func post(_ path: String, _ body: [String: Any], bearer: String? = nil) async throws -> (Int, Any?) {
        var request = URLRequest(url: coordinator.appendingPathComponent(path))
        if let bearer { request.setValue("Bearer " + bearer, forHTTPHeaderField: "Authorization") }
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        guard let (data, response) = try? await http.data(for: request), let answer = response as? HTTPURLResponse else {
            throw SignInError.unreachable
        }
        return (answer.statusCode, try? JSONSerialization.jsonObject(with: data))
    }
}

/// Where Apple's sheet shows: over the app's own window.
private final class SheetAnchor: NSObject, ASWebAuthenticationPresentationContextProviding {
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        return scenes.flatMap(\.windows).first(where: \.isKeyWindow) ?? scenes.first.map { ASPresentationAnchor(windowScene: $0) } ?? ASPresentationAnchor()
    }
}

/// Apple's passkey sheet's answer, handed back once, on the main queue: the assertion, the person closing it, or any
/// other failure. Shows over the app's own window, as SheetAnchor does.
private final class PasskeyAsker: NSObject, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
    private var finish: ((SignInClient.PasskeyAnswer) -> Void)?
    init(_ finish: @escaping (SignInClient.PasskeyAnswer) -> Void) { self.finish = finish }

    /// Answers now (a cancel from the app); the sheet's own later answer, if any, is then ignored.
    func answer(_ got: SignInClient.PasskeyAnswer) { done(got) }

    private func done(_ got: SignInClient.PasskeyAnswer) {
        DispatchQueue.main.async {
            let f = self.finish
            self.finish = nil
            f?(got)
        }
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        if let got = authorization.credential as? ASAuthorizationPlatformPublicKeyCredentialAssertion { done(.assertion(got)) } else { done(.failed) }
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        done((error as? ASAuthorizationError)?.code == .canceled ? .cancelled : .failed)
    }

    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        return scenes.flatMap(\.windows).first(where: \.isKeyWindow) ?? scenes.first.map { ASPresentationAnchor(windowScene: $0) } ?? ASPresentationAnchor()
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
