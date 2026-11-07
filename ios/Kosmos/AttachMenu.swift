import AVFoundation
import Photos
import SwiftUI
import UIKit
import UniformTypeIdentifiers

// kosmos#8045 (Josh 11-05 10:59): the + in a chat and in a project room opens recent photos at once, one tap fewer, with the
// camera as the first tile and all photos and files in a row at the bottom. The rules are in BoardLogic (Board.tray*,
// AttachChoice). Today's system picker needs no permission; this grid does, so it stays the way in when access is off.

// The +, which turns into an X while the tray is open. kosmos#7346: a plain + inside the box, a 44 pt target (Apple's minimum)
// on its 48 pt row. Rotated, not swapped, so the turn is one motion; Reduce Motion lands on it without the turn.
struct AttachPlusButton: View {
    let open: Bool
    let label: String
    let hint: String
    let toggle: () -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Button(action: toggle) {
            Image(systemName: "plus")
                .font(.system(size: 19, weight: .regular))
                .foregroundColor(Palette.secondary)
                .rotationEffect(.degrees(open ? 45 : 0))
                .animation(reduceMotion ? nil : PhotoTrayMotion.turn, value: open)
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .accessibilityLabel(open ? "Close photos" : label)
        .accessibilityHint(open ? "" : hint)
        .accessibilityIdentifier("attach-plus")
        .onAppear { PhotoTrayMotion.watchKeyboard() }
        #if DEBUG
        // Screenshots and motion measures only: KOSMOS_SAMPLE_PLUS=<seconds> and KOSMOS_SAMPLE_PLUS_AGAIN=<seconds> tap the + that
        // long after the composer shows, with no test runner slowing the frames.
        .onAppear {
            for key in ["KOSMOS_SAMPLE_PLUS", "KOSMOS_SAMPLE_PLUS_AGAIN"] {
                if let s = ProcessInfo.processInfo.environment[key].flatMap(Double.init), s > 0 {
                    DispatchQueue.main.asyncAfter(deadline: .now() + s) { toggle() }
                }
            }
        }
        #endif
    }
}

enum PhotoTrayMotion {
    // A keyboard's own slide lasts about this long, so the X and a tray rising with no keyboard keep its time.
    static let turn = Animation.easeOut(duration: 0.25)
    private static var reduceMotion: Bool { UIAccessibility.isReduceMotionEnabled }

    // With a keyboard up the tray goes in behind it with no animation of its own: the keyboard's slide is the motion, and the
    // box and the list hold still because the tray takes exactly the room the keyboard gives back. A plain write, never a
    // transaction that disables animations: that made the keyboard vanish without its slide and stopped the X turning
    // (measured frame by frame, 11-05). With no keyboard, it slides up.
    static func change(overKeyboard: Bool, _ body: () -> Void) {
        if overKeyboard || reduceMotion { body() } else { withAnimation(turn, body) }
    }

    // The keyboard's settled height, so the tray lands on its exact place. Heights differ by phone and keyboard; 336 is only for
    // a person who has not opened one yet. Read when it has settled, not at will-show: its height flips on the way up (380, 608,
    // 380 on Josh's phone, #7817). Never over half the window, which also holds in landscape.
    private static let keyboardKey = "kosmos.tray.keyboardHeight"
    private static let watchers = [UIResponder.keyboardDidShowNotification, UIResponder.keyboardDidChangeFrameNotification].map { name in
        NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { n in
            let screen = UIScreen.main.bounds
            guard let f = n.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect, f.height > 0, f.minY < screen.height,
                  screen.height > screen.width, f.height <= screen.height / 2 else { return }   // portrait, and not a flip's 608
            UserDefaults.standard.set(Double(f.height), forKey: keyboardKey)
        }
    }
    private static var keyboard: CGFloat {
        let kept = UserDefaults.standard.double(forKey: keyboardKey)
        return kept > 0 ? CGFloat(kept) : 336
    }
    static func watchKeyboard() { _ = watchers }
    static var height: CGFloat {
        if let h = ProcessInfo.processInfo.environment["KOSMOS_PROBE_TRAY"].flatMap(Double.init) { return CGFloat(h) }
        let window = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\.windows).first { $0.isKeyWindow }
        return min(max(216, keyboard - (window?.safeAreaInsets.bottom ?? 0)), (window?.bounds.height ?? 800) / 2)
    }
}

// The way back to a keyboard. While the tray is open the screen ignores the keyboard (.ignoresSafeArea at the screen's root), so
// a keyboard rising goes over the tray and moves nothing. Once it has risen the tray goes and the keyboard's room comes back
// on one update, which are the same height. A hardware keyboard shows no keyboard to wait for, hence the timer.
struct PhotoTrayFollowsKeyboard: ViewModifier {
    @Binding var open: Bool
    let focused: Bool
    @State private var noKeyboard: DispatchWorkItem?
    @State private var keyboardComing = false
    @Environment(\.verticalSizeClass) private var verticalSizeClass

    func body(content: Content) -> some View {
        content
            // A keyboard on its way: did-show closes the tray, however slowly it rises. Whichever of this and the focus comes
            // first, the timer reads it when it fires.
            .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)) { _ in
                keyboardComing = true
            }
            .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardDidShowNotification)) { _ in
                if open, focused { open = false }   // a late did-show, after the + took the keyboard down, is not this
            }
            .onChange(of: focused) { now in
                noKeyboard?.cancel()
                noKeyboard = nil
                guard now else { keyboardComing = false; return }
                let work = DispatchWorkItem { if !keyboardComing { open = false } }
                noKeyboard = work
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.8, execute: work)
            }
            // Heard only from here on: an earlier keyboard (search's, or a sheet's) is not this one.
            .onChange(of: open) { now in if now { keyboardComing = false } }
            // Its height was the keyboard's in the way the phone was held.
            .onChange(of: verticalSizeClass) { _ in open = false }
    }
}

// One photo the tray can show. A tile's picture and the photo itself are read through these, so the photo's own data is
// read only on the tap (the wording of iOS's prompt says only tapped photos leave the phone).
struct TrayPhoto: Identifiable {
    let id: String
    let label: String
    let thumbnail: (CGFloat) async -> UIImage?
    let data: () async -> Data?
}

// Photos should answer these requests once. A second answer would crash a continuation, so it is ignored.
private final class OnceOnly: @unchecked Sendable {
    private let lock = NSLock()
    private var done = false
    func run(_ body: () -> Void) {
        lock.lock(); defer { lock.unlock() }
        if !done { done = true; body() }
    }
}

// What the tray knows of the library. Not observed by the chat or the room, so a read here never redraws them.
@MainActor
final class PhotoTrayModel: NSObject, ObservableObject, PHPhotoLibraryChangeObserver {
    @Published private(set) var access = TrayAccess.notAsked
    @Published private(set) var photos: [TrayPhoto] = []
    @Published private(set) var loaded = false
    @Published private(set) var taps = TrayTaps()
    private var asked = false
    private var watching = false
    // One full-size picture decoded at a time, however fast the tiles are tapped.
    private actor Encoder { func encoded(_ data: Data) -> Data? { Board.trayEncoded(data) } }
    private static let encoder = Encoder()

    deinit { if watching { PHPhotoLibrary.shared().unregisterChangeObserver(self) } }

    func refresh() {
        #if DEBUG
        if let sample = ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_PHOTOS"] {
            access = sample == "all" ? .all : sample == "limited" ? .limited : sample == "off" ? .off : sample == "blocked" ? .blocked : .notAsked
            photos = Board.trayShowsGrid(access) ? Self.samples(limited: access == .limited) : []
            loaded = true
            return
        }
        #endif
        access = Self.read()
        guard access != .notAsked else {
            guard !asked else { return }   // once: its answer calls back here
            asked = true
            PHPhotoLibrary.requestAuthorization(for: .readWrite) { _ in
                DispatchQueue.main.async { [weak self] in self?.refresh() }
            }
            return
        }
        guard Board.trayShowsGrid(access) else { photos = []; loaded = true; return }
        if !watching { watching = true; PHPhotoLibrary.shared().register(self) }
        load()
    }

    private static func read() -> TrayAccess {
        switch PHPhotoLibrary.authorizationStatus(for: .readWrite) {
        case .authorized: return .all
        case .limited: return .limited
        case .denied: return .off
        case .restricted: return .blocked
        default: return .notAsked
        }
    }

    private func load() {
        let options = PHFetchOptions()
        options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
        options.fetchLimit = Board.trayPhotoCount
        let found = PHAsset.fetchAssets(with: .image, options: options)
        var next: [TrayPhoto] = []
        found.enumerateObjects { asset, _, _ in next.append(self.photo(asset)) }
        photos = next
        loaded = true
    }

    private func photo(_ asset: PHAsset) -> TrayPhoto {
        TrayPhoto(id: asset.localIdentifier, label: Board.trayPhotoLabel(asset.creationDate), thumbnail: { side in
            await withCheckedContinuation { done in
                let once = OnceOnly()
                let o = PHImageRequestOptions()
                o.deliveryMode = .highQualityFormat
                o.resizeMode = .fast
                o.isNetworkAccessAllowed = true
                PHImageManager.default().requestImage(for: asset, targetSize: CGSize(width: side, height: side), contentMode: .aspectFill, options: o) { image, _ in
                    once.run { done.resume(returning: image) }
                }
            }
        }, data: {
            let data: Data? = await withCheckedContinuation { done in
                let once = OnceOnly()
                let o = PHImageRequestOptions()
                o.deliveryMode = .highQualityFormat
                o.isNetworkAccessAllowed = true   // an iCloud photo downloads now, under the composer's Adding line and its x
                PHImageManager.default().requestImageDataAndOrientation(for: asset, options: o) { data, _, _, _ in
                    once.run { done.resume(returning: data) }
                }
            }
            guard let data else { return nil }
            return await PhotoTrayModel.encoder.encoded(data)
        })
    }

    nonisolated func photoLibraryDidChange(_ changeInstance: PHChange) {
        DispatchQueue.main.async { [weak self] in self?.refresh() }
    }

    // Each add starts at once, as its own, so it counts as on its way, stops on the composer's x and belongs to the account of the
    // moment it was tapped; `number` keeps two names apart within one second.
    func tap(_ photo: TrayPhoto, attached: () -> [Board.Attached], generation: Int, add: @escaping (TrayPhoto, Int) async -> String?, remove: @escaping (String) -> Void) {
        switch taps.tap(photo.id, generation: generation, waiting: attached().map(\.id)) {
        case .remove(let file): remove(file)
        case .letGo: break
        case .add(let number):
            // Holds the model until the add ends: a tap taken back still comes off if the chat is left while it goes up.
            Task { @MainActor in
                let file = await add(photo, number)
                if let back = self.taps.ended(photo.id, number: number, file: file) { remove(back) }
            }
        }
    }

    #if DEBUG
    // The sample tiles (a Debug build only): plain colours, so a screenshot never shows a real photo.
    private static func samples(limited: Bool) -> [TrayPhoto] {
        let colours: [UIColor] = [.systemTeal, .systemOrange, .systemIndigo, .systemPink, .systemGreen, .systemBrown, .systemBlue, .systemYellow]
        return (0..<(limited ? 3 : 23)).map { i in
            let colour = colours[i % colours.count]
            let image = { (side: CGFloat) in
                UIGraphicsImageRenderer(size: CGSize(width: side, height: side)).image { c in colour.setFill(); c.fill(CGRect(x: 0, y: 0, width: side, height: side)) }
            }
            return TrayPhoto(id: "sample-\(i)", label: "Sample photo \(i + 1)", thumbnail: { image($0) }, data: { image(64).jpegData(compressionQuality: 0.85) })
        }
    }
    #endif
}

// The tray, in the keyboard's place: the camera and recent photos above, the system picker and files in a row along the bottom.
struct PhotoTray: View {
    @ObservedObject var model: PhotoTrayModel
    let height: CGFloat
    let atLimit: Bool
    let limitHint: String
    let attached: () -> [Board.Attached]
    let generation: Int
    let add: (TrayPhoto, Int) async -> String?
    let remove: (String) -> Void
    // Told the moment Camera is tapped, before any permission prompt, so the caller can note what it needs then (the
    // camera's account and computer).
    var onCameraTapped: () -> Void = {}
    // Told when the person answers iOS's camera prompt with Don't Allow, so the screen can say so.
    var onCameraDenied: () -> Void = {}
    let onChoose: (AttachChoice) -> Void
    @State private var camera = PhotoTray.cameraNow
    @Environment(\.openURL) private var openURL
    @Environment(\.displayScale) private var scale

    @ScaledMetric(relativeTo: .subheadline) private var rowClear: CGFloat = 72   // the last row clears the bottom row
    private let columns = Array(repeating: GridItem(.flexible(), spacing: 3), count: 4)

    var body: some View {
        ZStack(alignment: .bottom) {
            ScrollView {
                VStack(spacing: 8) {
                    if let line = Board.trayLine(model.access, loaded: model.loaded, count: model.photos.count) { lineView(line) }
                    LazyVGrid(columns: columns, spacing: 3) {
                        cameraTile
                        ForEach(model.photos) { photo in tile(photo) }
                    }
                }
                .padding(.horizontal, 3)
                .padding(.top, 8)
                .padding(.bottom, rowClear)
            }
            bottomRow
        }
        .frame(height: height)
        .background(Palette.card.ignoresSafeArea(edges: .bottom))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("attach-panel")
        .onAppear { camera = Self.cameraNow; model.refresh() }
        // Back from Settings, or a limited choice changed there.
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.willEnterForegroundNotification)) { _ in
            camera = Self.cameraNow
            model.refresh()
        }
    }

    private func lineView(_ line: Board.TrayLine) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(line.words).font(.footnote).foregroundColor(Palette.secondary)
            if line.settings {
                Button("Open Settings") { if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) } }
                    .font(.footnote.weight(.semibold))
                    .foregroundColor(Palette.link)
                    .frame(minHeight: 44)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 9)
    }

    private var cameraTile: some View {
        let off = Board.attachRowOff(.camera, atLimit: atLimit, camera: camera)
        return Button { chooseCamera() } label: {
            Color.clear.aspectRatio(1, contentMode: .fit)
                .overlay(
                    VStack(spacing: 2) {
                        Image(systemName: "camera.fill").font(.system(size: 24)).foregroundColor(Palette.secondary).opacity(off ? 0.4 : 1)
                        if let note = Board.cameraNote(camera) {
                            Text(note).font(.caption2).foregroundColor(Palette.secondary).multilineTextAlignment(.center).minimumScaleFactor(0.7).padding(.horizontal, 4)
                        }
                    }
                )
                .background(RoundedRectangle(cornerRadius: 6).fill(Palette.avatarFill))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(off)
        .accessibilityLabel(AttachChoice.camera.title)
        .accessibilityValue(Board.cameraNote(camera) ?? "")
        .accessibilityHint(atLimit ? limitHint : camera == .notAllowed ? "Opens Settings, where the camera can be turned on for Kosmos." : "")
    }

    private func chooseCamera() {
        // Read at the tap: the camera can have been turned on in Settings since the tray opened.
        camera = Self.cameraNow
        onCameraTapped()
        switch camera {
        case .ready: onChoose(.camera)
        case .notAllowed: if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
        // Asked here first, so a "Don't Allow" never opens a camera that cannot see.
        case .notAsked:
            AVCaptureDevice.requestAccess(for: .video) { granted in
                DispatchQueue.main.async { if granted { onChoose(.camera) } else { onCameraDenied() } }
            }
        case .blocked, .unavailable: break
        }
    }

    private func tile(_ photo: TrayPhoto) -> some View {
        let checked = model.taps.isChecked(photo.id, generation: generation, waiting: attached().map(\.id))
        return PhotoTile(photo: photo, checked: checked, off: atLimit && !checked, pixels: 200 * scale, limitHint: limitHint) {
            model.tap(photo, attached: attached, generation: generation, add: add, remove: remove)
        }
    }

    private var bottomRow: some View {
        HStack(spacing: 0) {
            rowButton(.photos)
            rowButton(.files)
        }
        .padding(.horizontal, 6)
        .background(Capsule().fill(Palette.card).shadow(color: Color.black.opacity(0.18), radius: 8, x: 0, y: 2))
        .overlay(Capsule().stroke(Palette.secondary.opacity(0.35), lineWidth: 0.5))
        .padding(.bottom, 10)
    }

    private func rowButton(_ choice: AttachChoice) -> some View {
        let off = Board.attachRowOff(choice, atLimit: atLimit, camera: camera)
        return Button { onChoose(choice) } label: {
            HStack(spacing: 6) {
                Image(systemName: choice.symbol).accessibilityHidden(true)
                Text(choice == .photos ? Board.trayPhotosRow(model.access) : choice.title).lineLimit(1).minimumScaleFactor(0.7)
            }
            .font(.subheadline.weight(.medium))
            .foregroundColor(Palette.primary)
            .opacity(off ? 0.4 : 1)
            .padding(.horizontal, 12)
            .frame(minHeight: 48)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(off)
        .accessibilityHint(atLimit ? limitHint : "")
    }

    fileprivate static var cameraNow: CameraState {
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

private struct PhotoTile: View {
    let photo: TrayPhoto
    let checked: Bool
    let off: Bool
    let pixels: CGFloat
    let limitHint: String
    let tap: () -> Void
    @State private var image: UIImage?

    var body: some View {
        Button(action: tap) {
            Color.clear.aspectRatio(1, contentMode: .fit)
                .background(Palette.avatarFill)
                .overlay { if let image { Image(uiImage: image).resizable().scaledToFill() } }
                .clipShape(RoundedRectangle(cornerRadius: 6))
                .overlay(alignment: .topTrailing) {
                    if checked {
                        Image(systemName: "checkmark").font(.system(size: 12, weight: .bold)).foregroundColor(Palette.card)
                            .frame(width: 24, height: 24).background(Circle().fill(Palette.primary)).overlay(Circle().stroke(Palette.card, lineWidth: 1.5))
                            .padding(5)
                    }
                }
                .opacity(off ? 0.4 : 1)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(off)
        .accessibilityLabel(photo.label)
        .accessibilityAddTraits(checked ? .isSelected : [])
        .accessibilityHint(off ? limitHint : "")
        .task(id: photo.id) { image = await photo.thumbnail(pixels) }
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
