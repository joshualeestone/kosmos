import SwiftUI

// The iOS native shell for Kosmos. Like the macOS app (native-app/main.swift)
// and the Android TWA, this is "a window pointed at the board": a genuine native
// app whose job for now is to render the board web content full-screen. The
// native surface that clears App Store Review 4.2 (APNs, biometric unlock,
// notification actions) is later, tracked on the card; this is the build skeleton.
@main
struct KosmosApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
