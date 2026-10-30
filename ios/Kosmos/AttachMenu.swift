import AVFoundation
import SwiftUI
import UIKit

// kosmos#7596 (Josh 10-29 21:27, his screenshot of ChatGPT's): the + in a chat and in a project room opens a larger panel,
// each choice a round icon tile and its name, Camera first. Josh 21:28: only Camera, Photos and Files.
enum AttachChoice: CaseIterable {
    case camera, photos, files
    var title: String {
        switch self {
        case .camera: return "Camera"
        case .photos: return "Photos"
        case .files: return "Files"
        }
    }
    var symbol: String {
        switch self {
        case .camera: return "camera"
        case .photos: return "photo.on.rectangle"
        case .files: return "folder"
        }
    }
}

// The + and its panel. The choice is acted on once the panel has gone (its onDisappear), since iOS opens nothing from a
// presentation still on its way out. A camera Kosmos may not use opens Settings instead, where it is turned back on.
struct AttachPlusButton: View {
    let atLimit: Bool
    let label: String
    let hint: String
    let onChoose: (AttachChoice) -> Void
    @State private var open = false
    @State private var chosen: AttachChoice?
    @Environment(\.openURL) private var openURL

    var body: some View {
        Button { open = true } label: {
            // kosmos#7346: a plain + inside the box, a 44 pt target (Apple's minimum) on its 48 pt row.
            Image(systemName: "plus")
                .font(.system(size: 19, weight: .regular))
                .foregroundColor(Palette.secondary)
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .accessibilityLabel(label)
        .accessibilityHint(hint)
        .popover(isPresented: $open, arrowEdge: .bottom) {
            AttachPanel(atLimit: atLimit, limitHint: hint, camera: Self.camera) { choice in chosen = choice; open = false }
                .modifier(PopoverOnPhone())
                .onDisappear {
                    guard let choice = chosen else { return }
                    chosen = nil
                    if choice == .camera, Self.camera == .notAllowed {
                        if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
                    } else {
                        onChoose(choice)
                    }
                }
        }
        #if DEBUG
        // Screenshots only: KOSMOS_SAMPLE_PLUS=1 opens the panel 2 s after the composer shows.
        .onAppear {
            if ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_PLUS"] == "1" {
                DispatchQueue.main.asyncAfter(deadline: .now() + 2) { open = true }
            }
        }
        #endif
    }

    static var camera: CameraState {
        guard UIImagePickerController.isSourceTypeAvailable(.camera) else { return .none }
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .denied, .restricted: return .notAllowed
        default: return .ready
        }
    }
}

// Whether the panel's Camera can open: a camera on this device, and Kosmos allowed to use it (not yet asked counts as
// allowed: iOS asks the first time the camera opens).
enum CameraState { case ready, notAllowed, none }

// The panel's rows. A device with no camera (the simulator, some iPads) shows Camera dimmed, not missing; one where
// Kosmos is not allowed the camera keeps it tappable, to open Settings. Each says why under its name.
struct AttachPanel: View {
    let atLimit: Bool
    let limitHint: String
    let camera: CameraState
    let choose: (AttachChoice) -> Void
    @ScaledMetric(relativeTo: .body) private var symbolSize: CGFloat = 18
    @ScaledMetric(relativeTo: .body) private var tileSize: CGFloat = 44

    private func note(_ choice: AttachChoice) -> String? {
        guard choice == .camera else { return nil }
        switch camera {
        case .ready: return nil
        case .notAllowed: return "Turned off for Kosmos in Settings"
        case .none: return "Not available on this device"
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            ForEach(AttachChoice.allCases, id: \.self) { choice in
                let off = atLimit || (choice == .camera && camera == .none)
                Button { choose(choice) } label: {
                    HStack(spacing: 14) {
                        Image(systemName: choice.symbol)
                            .font(.system(size: symbolSize, weight: .regular))
                            .foregroundColor(Palette.primary)
                            .frame(width: tileSize, height: tileSize)
                            .background(Circle().fill(Palette.avatarFill))
                            .accessibilityHidden(true)   // the name beside it says it once
                        VStack(alignment: .leading, spacing: 1) {
                            Text(choice.title).font(.body).foregroundColor(Palette.primary)
                            if let note = note(choice) { Text(note).font(.footnote).foregroundColor(Palette.secondary) }
                        }
                        Spacer(minLength: 0)
                    }
                    .padding(.horizontal, 12).padding(.vertical, 6)
                    .frame(minWidth: 220, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(off)
                .opacity(off ? 0.4 : 1)
                .accessibilityHint(atLimit ? limitHint : choice == .camera && camera == .notAllowed ? "Opens Settings, where the camera can be turned on for Kosmos." : "")
            }
        }
        .padding(.vertical, 8)
    }
}

// On a phone a popover becomes a sheet unless told otherwise (iOS 16.4 and later); before that, a short sheet.
private struct PopoverOnPhone: ViewModifier {
    func body(content: Content) -> some View {
        if #available(iOS 16.4, *) {
            content.presentationCompactAdaptation(.popover).presentationBackground(.regularMaterial)
        } else {
            content.presentationDetents([.height(240), .medium])
        }
    }
}

// The camera, for one photo. Hands back the photo as JPEG, or nothing if the person cancels.
struct CameraCapture: UIViewControllerRepresentable {
    let done: (Data?) -> Void

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.mediaTypes = ["public.image"]
        picker.delegate = context.coordinator
        return picker
    }
    func updateUIViewController(_ picker: UIImagePickerController, context: Context) {}
    func makeCoordinator() -> Coordinator { Coordinator(done: done) }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let done: (Data?) -> Void
        init(done: @escaping (Data?) -> Void) { self.done = done }
        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            done((info[.originalImage] as? UIImage)?.jpegData(compressionQuality: 0.85))
        }
        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { done(nil) }
    }
}
