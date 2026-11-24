import AuthenticationServices
import UIKit

/// Apple's sheet that makes a new passkey for Kosmos+, for the account screen's "Add a passkey" (kosmos#8959 slice B1c).
/// It only asks iOS: register/begin before it and register/finish after it are the account screen's calls, and
/// `AccountSecurity.finishBody` turns what this hands back into the finish request.
@MainActor
final class PasskeyMaker {
    /// What the sheet said. `made` carries the three things finish needs; the SDK's own type stays in here.
    enum Answer: Equatable {
        case made(credentialID: Data, attestationObject: Data, clientDataJSON: Data)
        /// The person closed the sheet: nothing to say on the screen.
        case cancelled
        /// iOS refused because this iPhone already holds a passkey in the exclude list. iOS 18 names that refusal; on 17.4
        /// to 17.x it arrives as `failed`. Before 17.4 the list cannot be passed, so the screen does not ask then (review 1).
        case alreadyHere
        case failed
    }

    private var asker: Asker?
    private var controller: ASAuthorizationController?

    /// Closes an open sheet; its ask answers `cancelled`.
    func cancel() {
        let a = asker, c = controller
        asker = nil
        controller = nil
        c?.cancel()
        a?.answer(.cancelled)
    }

    /// One sheet at a time: a second ask while one is open answers `failed` at once.
    func make(_ r: AccountSecurity.Registration) async -> Answer {
        guard asker == nil else { return .failed }
        let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: r.rpID)
        let request = provider.createCredentialRegistrationRequest(challenge: r.challenge, name: r.userName, userID: r.userID)
        request.userVerificationPreference = .required
        request.attestationPreference = .none
        if #available(iOS 17.4, *), !r.exclude.isEmpty {
            request.excludedCredentials = r.exclude.map { ASAuthorizationPlatformPublicKeyCredentialDescriptor(credentialID: $0) }
        }
        return await withCheckedContinuation { (done: CheckedContinuation<Answer, Never>) in
            var mine: Asker?
            mine = Asker { [weak self] got in
                // Only this sheet's own record is cleared: a cancel may already have cleared it and a newer one be open.
                if let self, self.asker === mine { self.asker = nil; self.controller = nil }
                done.resume(returning: got)
            }
            asker = mine
            let c = ASAuthorizationController(authorizationRequests: [request])
            controller = c
            c.delegate = mine
            c.presentationContextProvider = mine
            c.performRequests()
            // A sheet that never answers is closed after six minutes, past the challenge's five.
            DispatchQueue.main.asyncAfter(deadline: .now() + 360) { [weak self, weak mine] in
                if let self, let mine, self.asker === mine { self.cancel() }
            }
        }
    }

    /// The sheet's answer, handed back once, on the main queue.
    private final class Asker: NSObject, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
        private var finish: ((Answer) -> Void)?
        init(_ finish: @escaping (Answer) -> Void) { self.finish = finish }

        func answer(_ got: Answer) { done(got) }

        private func done(_ got: Answer) {
            DispatchQueue.main.async {
                let f = self.finish
                self.finish = nil
                f?(got)
            }
        }

        func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
            // The SDK declares these implicitly unwrapped; a missing one is a failure, never a crash.
            guard let got = authorization.credential as? ASAuthorizationPlatformPublicKeyCredentialRegistration else { return done(.failed) }
            let id: Data? = got.credentialID, att: Data? = got.rawAttestationObject, client: Data? = got.rawClientDataJSON
            guard let id, let att, let client else { return done(.failed) }
            done(.made(credentialID: id, attestationObject: att, clientDataJSON: client))
        }

        func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
            switch (error as? ASAuthorizationError)?.code {
            case .canceled?: done(.cancelled)
            case .matchedExcludedCredential?: done(.alreadyHere)
            default: done(.failed)
            }
        }

        func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
            let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            return scenes.flatMap(\.windows).first(where: \.isKeyWindow) ?? scenes.first.map { ASPresentationAnchor(windowScene: $0) } ?? ASPresentationAnchor()
        }
    }
}
