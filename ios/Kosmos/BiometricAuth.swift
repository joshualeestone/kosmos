import Foundation
import LocalAuthentication

// Face ID / Touch ID unlock for the board. A genuine native capability (part of
// the App Store Review 4.2 native surface): the board can be gated behind the
// device owner's biometrics so a lost or borrowed phone does not expose a running
// agent workforce.
//
// Wired but off by default: ContentView gates on
// KosmosConfig.requireBiometricUnlock (default false, so the shell behaves as
// before). Flip that flag to require an unlock before the board renders. Requires
// NSFaceIDUsageDescription in the Info.plist (added as a build setting).
enum BiometricAuth {

    enum UnlockResult {
        case success
        case failed(String)
        case unavailable(String)
    }

    // Whether the device can evaluate biometrics right now (hardware present and
    // enrolled).
    static func isAvailable() -> Bool {
        let context = LAContext()
        var error: NSError?
        let ok = context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error)
        if let error = error {
            NSLog("[Biometric] unavailable: \(error.localizedDescription)")
        }
        return ok
    }

    // Prompt for biometric unlock. Uses deviceOwnerAuthentication (not
    // ...WithBiometrics) so a passcode fallback is offered if Face ID fails,
    // matching what users expect from an unlock gate. The completion is always
    // called on the main thread.
    static func authenticate(
        reason: String = "Unlock Kosmos to view your board",
        completion: @escaping (UnlockResult) -> Void
    ) {
        let context = LAContext()
        var error: NSError?

        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else {
            let message = error?.localizedDescription ?? "Biometric authentication is not available"
            DispatchQueue.main.async { completion(.unavailable(message)) }
            return
        }

        context.evaluatePolicy(
            .deviceOwnerAuthentication,
            localizedReason: reason
        ) { success, evalError in
            DispatchQueue.main.async {
                if success {
                    completion(.success)
                } else {
                    completion(.failed(evalError?.localizedDescription ?? "Authentication failed"))
                }
            }
        }
    }
}
