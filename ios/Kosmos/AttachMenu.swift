import AVFoundation
import SwiftUI
import UIKit
import UniformTypeIdentifiers

// kosmos#7596 (Josh 10-29 21:27, his screenshot of ChatGPT's): the + in a chat and in a project room opens a larger panel,
// each choice a round icon tile and its name, Camera first. The choices and their rules are in BoardLogic (AttachChoice).

// The + and its panel. The choice is acted on once the panel has gone (its onDisappear), since iOS opens nothing from a
// presentation still on its way out. A camera Kosmos may not use opens Settings instead, where it is turned back on.
struct AttachPlusButton: View {
    let atLimit: Bool
    let label: String
    let hint: String
    // Review 7: told the moment a choice is made, before any permission prompt, so the caller can note what it needs then
    // (the camera's account and computer).
    var onPicked: (AttachChoice) -> Void = { _ in }
    // Review 8: told when the person answers iOS's camera prompt with Don't Allow, so the screen can say so.
    var onCameraDenied: () -> Void = {}
    let onChoose: (AttachChoice) -> Void
    @State private var open = false
    @State private var chosen: AttachChoice?
    @State private var cameraAtChoice = CameraState.unavailable   // review 2: the camera state the person saw when choosing
    @Environment(\.openURL) private var openURL

    var body: some View {
        Button { chosen = nil; open = true } label: {
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
            AttachPanel(atLimit: atLimit, limitHint: hint, camera: Self.camera) { choice, camera in
                chosen = choice; cameraAtChoice = camera; onPicked(choice); open = false
            }
                .modifier(PopoverOnPhone())
                .onDisappear {
                    guard let choice = chosen else { return }
                    chosen = nil
                    guard choice == .camera else { onChoose(choice); return }
                    switch cameraAtChoice {
                    case .ready: onChoose(.camera)
                    case .notAllowed: if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
                    // Review 2: asked here first, so a "Don't Allow" never opens a camera that cannot see.
                    case .notAsked:
                        AVCaptureDevice.requestAccess(for: .video) { granted in
                            DispatchQueue.main.async { if granted { onChoose(.camera) } else { onCameraDenied() } }
                        }
                    case .blocked, .unavailable: break
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
        let auth: CameraAuth
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: auth = .authorized
        case .denied: auth = .denied
        case .restricted: auth = .restricted
        default: auth = .notDetermined
        }
        return Board.cameraState(available: UIImagePickerController.isSourceTypeAvailable(.camera), auth: auth)
    }
}

// The panel's rows. A device with no camera (the simulator, some iPads) shows Camera dimmed, not missing; one where
// Kosmos is not allowed the camera keeps it tappable, to open Settings. Each says why under its name.
struct AttachPanel: View {
    let atLimit: Bool
    let limitHint: String
    let camera: CameraState
    let choose: (AttachChoice, CameraState) -> Void
    @ScaledMetric(relativeTo: .body) private var symbolSize: CGFloat = 18
    @ScaledMetric(relativeTo: .body) private var tileSize: CGFloat = 44

    private func note(_ choice: AttachChoice) -> String? { choice == .camera ? Board.cameraNote(camera) : nil }

    // Review 3 and 5: at the largest text sizes the rows can outgrow the panel, so they scroll there. The panel is capped at
    // 360 pt; which of the two fits is decided against the height the presentation offers, at most that cap.
    var body: some View {
        ViewThatFits(in: .vertical) {
            rows
            ScrollView { rows }
        }
        .frame(maxHeight: 360)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("attach-panel")   // review 13: the UI test finds its rows here, not the picker's own "Photos"
    }

    private var rows: some View {
        VStack(alignment: .leading, spacing: 2) {
            ForEach(AttachChoice.allCases, id: \.self) { choice in
                let off = Board.attachRowOff(choice, atLimit: atLimit, camera: camera)
                Button { choose(choice, camera) } label: {
                    HStack(spacing: 14) {
                        Image(systemName: choice.symbol)
                            .font(.system(size: symbolSize, weight: .regular))
                            .foregroundColor(Palette.primary)
                            .frame(width: tileSize, height: tileSize)
                            .background(Circle().fill(Palette.avatarFill))
                            .accessibilityHidden(true)   // the name beside it says it once
                            .opacity(off ? 0.4 : 1)
                        // Review 4: the tile and the name dim on a row that cannot be used, never the line saying why.
                        VStack(alignment: .leading, spacing: 1) {
                            Text(choice.title).font(.body).foregroundColor(Palette.primary).opacity(off ? 0.4 : 1)
                            if let note = note(choice) { Text(note).font(.footnote).foregroundColor(Palette.secondary) }
                        }
                        Spacer(minLength: 0)
                    }
                    .padding(.horizontal, 12).padding(.vertical, 6)
                    .frame(minWidth: 220, maxWidth: .infinity, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(off)
                .accessibilityHint(atLimit ? limitHint : choice == .camera && camera == .notAllowed ? "Opens Settings, where the camera can be turned on for Kosmos." : "")
            }
        }
        // Review 16: every row as wide as the widest, so a note under Camera cannot leave Photos and Files a short tap area.
        .fixedSize(horizontal: true, vertical: false)
        .padding(.vertical, 8)
    }
}

// On a phone a popover becomes a sheet unless told otherwise (iOS 16.4 and later); before that, a short sheet.
private struct PopoverOnPhone: ViewModifier {
    func body(content: Content) -> some View {
        if #available(iOS 16.4, *) {
            content.presentationCompactAdaptation(.popover).presentationBackground(.regularMaterial)
        } else {
            content.presentationDetents([.medium])   // review 2: room for the rows at any text size
        }
    }
}

// The camera, for one photo. Hands back the image, or nothing if the person cancels; the caller encodes it off the main
// thread (a large camera image takes up to a second).
struct CameraCapture: UIViewControllerRepresentable {
    let done: (UIImage?) -> Void

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.mediaTypes = [UTType.image.identifier]
        picker.delegate = context.coordinator
        return picker
    }
    // Review 4: the latest closure, so a photo goes to the chat or room on screen now, not the one the camera opened over.
    func updateUIViewController(_ picker: UIImagePickerController, context: Context) { context.coordinator.done = done }
    func makeCoordinator() -> Coordinator { Coordinator(done: done) }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        var done: (UIImage?) -> Void
        init(done: @escaping (UIImage?) -> Void) { self.done = done }
        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            done(info[.originalImage] as? UIImage)
        }
        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { done(nil) }
    }
}
