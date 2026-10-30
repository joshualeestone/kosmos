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

// The + and its panel. The choice is acted on once the panel has gone (onChoose), since iOS opens nothing from a
// presentation still on its way out.
struct AttachPlusButton: View {
    let atLimit: Bool
    let label: String
    let hint: String
    let onChoose: (AttachChoice) -> Void
    @State private var open = false
    @State private var chosen: AttachChoice?

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
            AttachPanel(atLimit: atLimit, camera: Self.hasCamera) { choice in chosen = choice; open = false }
                .modifier(PopoverOnPhone())
        }
        .onChange(of: open) { now in
            guard !now, let choice = chosen else { return }
            chosen = nil
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { onChoose(choice) }
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

    static var hasCamera: Bool { UIImagePickerController.isSourceTypeAvailable(.camera) }
}

// The panel's rows. A phone with no camera (the simulator, some iPads) shows Camera dimmed, not missing, with the reason
// read out.
struct AttachPanel: View {
    let atLimit: Bool
    let camera: Bool
    let choose: (AttachChoice) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            ForEach(AttachChoice.allCases, id: \.self) { choice in
                let off = atLimit || (choice == .camera && !camera)
                Button { choose(choice) } label: {
                    HStack(spacing: 14) {
                        Image(systemName: choice.symbol)
                            .font(.system(size: 18, weight: .regular))
                            .foregroundColor(Palette.primary)
                            .frame(width: 44, height: 44)
                            .background(Circle().fill(Palette.avatarFill))
                        Text(choice.title).font(.body).foregroundColor(Palette.primary)
                        Spacer(minLength: 0)
                    }
                    .padding(.horizontal, 12).padding(.vertical, 6)
                    .frame(minWidth: 220, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(off)
                .opacity(off ? 0.4 : 1)
                .accessibilityHint(choice == .camera && !camera ? "This iPhone has no camera Kosmos can use." : "")
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
            content.presentationDetents([.height(220)])
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
