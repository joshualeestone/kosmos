import SwiftUI

// The iOS native shell for Kosmos. Like the macOS app (native-app/main.swift)
// and the Android TWA, this is "a window pointed at the board": a genuine native
// app that renders the board web content full-screen. The native surface that
// clears App Store Review 4.2 - APNs registration, notification actions, and
// biometric unlock - is wired via the AppDelegate (installed below) plus
// PushNotificationManager and BiometricAuth; the parts needing external unblocks
// (the APNs auth key on the coordinator, provisioning) are tracked on #718.
@main
struct KosmosApp: App {
    // Bridges to UIKit so APNs registration callbacks (delivered to
    // UIApplicationDelegate, not SwiftUI) reach the app.
    @UIApplicationDelegateAdaptor(AppDelegate.self) var appDelegate

    var body: some Scene {
        WindowGroup {
            ContentView(pushManager: appDelegate.pushManager)
        }
    }
}
