import SwiftUI

// kosmos#7016 (slice 3b, part 2): a file an agent sent, as a card inside its bubble that opens in Quick Look, built to
// Mona Lisa's slice 3b spec, section 3, and the board's pjAttachmentCard. What a row's files are and how they are named
// is decided in BoardLogic.swift (tested); fetching is BoardClient.fetchFile.

// Where one card is: ready to open, fetching, or the last fetch failed (the tap tries again).
enum FileCardState: Equatable { case ready, loading, failed }

// The agent's words (when there are any beyond the file names) and one card per file, in one agent bubble; or the
// person's own, in theirs on the right (kosmos#7071).
struct FilesBubble: View {
    let text: String
    let files: [Board.Attachment]
    let thumbnails: [String: Data]
    let states: [String: FileCardState]
    let widthShare: CGFloat
    let open: (Board.Attachment) -> Void
    var mine = false
    // kosmos#7071: drawn faded when the caller asks; and what VoiceOver says for the bubble
    // (who and when) before its cards.
    var faded = false
    var spoken: String? = nil
    // kosmos#7083: Reply and the reactions, as VoiceOver actions on each file card (the container itself cannot be
    // focused, so actions on it are never offered).
    var actions: [(name: String, run: () -> Void)] = []
    // kosmos#7419 review 4: the long-press sheet for this message, offered on each card too (the container's own action
    // would never be), through the chat's one sheet.
    var sheet: MessageActionTarget? = nil
    @Environment(\.openMessageActions) private var openSheet

    // One file at a time: while one is on its way, the others are drawn off.
    private var busy: Bool { states.values.contains(.loading) }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if !text.isEmpty {
                Text(BubbleText.formatted(text)).font(.body).foregroundColor(Palette.primary).tint(Palette.link)
                    .padding(.bottom, 4)
                    // The bubble's own label already says the words (kosmos#7071), so they are not heard twice.
                    .accessibilityHidden(spoken != nil)
            }
            // By position as well as id: a row that names one file twice still draws two cards.
            ForEach(Array(files.enumerated()), id: \.offset) { _, f in
                FileCard(file: f, thumbnail: thumbnails[f.id], state: states[f.id] ?? .ready,
                         waiting: busy && states[f.id] != .loading, open: { open(f) })
                    .accessibilityActions {
                        ForEach(Array(actions.enumerated()), id: \.offset) { _, a in Button(a.name, action: a.run) }
                        if let sheet, let openSheet { Button("Message actions") { openSheet(sheet) } }
                    }
            }
        }
        .modifier(FilesBubbleBackground(widthShare: widthShare, mine: mine))
        .opacity(faded ? 0.6 : 1)
        // A container, so each card stays its own button, named by who sent them.
        .accessibilityElement(children: .contain)
        .accessibilityLabel(spoken ?? "")
    }
}

// The agent's bubble look (AgentBubbleBackground), or the person's: their colour, on the right (kosmos#7071).
struct FilesBubbleBackground: ViewModifier {
    let widthShare: CGFloat
    let mine: Bool
    @ViewBuilder func body(content: Content) -> some View {
        if mine {
            content
                .padding(.vertical, 10).padding(.horizontal, 14)   // kosmos#7347
                .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Palette.personBubble))
                .overlay(PressedBubbleMark())   // kosmos#7419 build 11: the bubble itself, before its width frame
                .frame(maxWidth: UIScreen.main.bounds.width * max(widthShare, 0.85), alignment: .trailing)
                .fixedSize(horizontal: false, vertical: true)
        } else {
            content.modifier(AgentBubbleBackground(widthShare: widthShare))
        }
    }
}

// kosmos#7071: a file waiting on the composer, with its x, or carried by a message still on its way (no x).
// kosmos#7944: a picture waiting on the composer shows a small copy of itself, and a tap opens it (AttachedPreview).
struct FileChip: View {
    let name: String
    var faded = false
    var preview: Data? = nil
    var open: (() -> Void)? = nil
    var remove: (() -> Void)? = nil

    // Decoded once and kept (review 2: the row redraws on every keystroke and upload count); the first draw decodes
    // it directly so the square shows at once rather than a frame of the plain chip.
    @State private var decoded: UIImage?
    private var thumbnail: UIImage? { decoded ?? preview.flatMap { UIImage(data: $0) } }

    var body: some View {
        if let open, let thumbnail {
            tile(thumbnail, open: open)
                .task(id: preview) { decoded = preview.flatMap { UIImage(data: $0)?.preparingForDisplay() } }
        } else {
            chip
        }
    }

    // kosmos#7944 (Josh 11-04 08:35, his reference): a picture shows as a small square of itself, no name, its x on the
    // top corner. The square opens it (AttachedPreview); VoiceOver hears the file's name on both.
    private func tile(_ thumbnail: UIImage, open: @escaping () -> Void) -> some View {
        Button {
            // kosmos#7530: the keyboard goes first, or the sheet opens behind it.
            UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
            open()
        } label: {
            Image(uiImage: thumbnail).resizable().scaledToFill()
                .frame(width: Self.tileSide, height: Self.tileSide)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Palette.separator, lineWidth: 0.5))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(name)
        .accessibilityHint("Shows the picture")
        .accessibilityIdentifier("attached-preview-open")
        .overlay(alignment: .topTrailing) {
            if let remove {
                Button(action: remove) {
                    // The ink's colour with the ground's x and a ring of the ground, so it shows on a light or dark
                    // ground and on any picture (a dark disc alone vanished on the dark theme's black).
                    Image(systemName: "xmark.circle.fill").font(.system(size: 20))
                        .symbolRenderingMode(.palette).foregroundStyle(Palette.chatGround, Palette.primary)
                        .background(Circle().fill(Palette.chatGround).padding(-2))
                        // A 44 pt place to tap, centred on the corner.
                        .frame(width: 44, height: 44).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                // Centred ON the corner (review 1: set in by 8 pt, its 44 pt place covered a third of the picture, and a
                // tap meant to open it removed it). A quarter of that place is over the picture, as in Josh's reference.
                .offset(x: 22, y: -22)
                .accessibilityLabel("Remove \(name)")
            }
        }
        // The whole 44 pt place inside the row: a scroll view takes no taps outside itself.
        .padding(.top, 22).padding(.trailing, 22)
    }

    /// The picture's square in the composer, in points (Josh's reference: about a seventh of the screen's width).
    static let tileSide: CGFloat = 56

    private var chip: some View {
        HStack(spacing: 6) {
            Image(systemName: "doc").font(.system(size: 13)).foregroundColor(Palette.secondary)
                .accessibilityHidden(true)
            label
            if let remove {
                Button(action: remove) {
                    Image(systemName: "xmark.circle.fill").font(.system(size: 15)).foregroundColor(Palette.secondary)
                        // A 44 pt place to tap around the glyph.
                        .frame(width: 44, height: 44).contentShape(Rectangle()).padding(-12)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Remove \(name)")
            }
        }
        .padding(.vertical, 6).padding(.horizontal, 10)
        .background(RoundedRectangle(cornerRadius: 12).fill(Palette.card))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Palette.separator, lineWidth: 0.5))
        // As wide as its name (up to the cap), wherever it sits: a bubble's row offers the whole width.
        .fixedSize(horizontal: true, vertical: false)
    }

    private var label: some View {
        Text(name).font(.footnote).foregroundColor(Palette.primary.opacity(faded ? 0.6 : 1))
            .lineLimit(1).truncationMode(.middle)
            // Cut in the middle, so a long name keeps its end and the next file shows beside it.
            .frame(maxWidth: 180, alignment: .leading)
    }
}

// kosmos#7944 (Josh 11-04 08:28: "I think we would only need the remove feature from a button perspective and skip
// caption or edit etc"): a picture waiting on the composer, as large as the screen allows, its name above it and one
// action under it. Swipe down or Remove closes it. Nothing has been sent, so Remove only takes it off the composer.
struct AttachedPreview: View {
    let name: String
    let preview: Data
    let remove: () -> Void
    @Environment(\.dismiss) private var dismiss
    // The danger red of the light theme in both: white on it is about 6.6:1, where the dark theme's lighter red
    // (dangerWord, made for words on a dark ground) would put white under 3:1.
    static let removeFill = Color(red: 0xb3 / 255, green: 0x26 / 255, blue: 0x1e / 255)

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(name).font(.headline).foregroundColor(Palette.primary)
                .lineLimit(2).truncationMode(.middle)
                .accessibilityAddTraits(.isHeader)
            if let image = UIImage(data: preview) {
                Image(uiImage: image).resizable().scaledToFit()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                    .accessibilityLabel("Picture")   // the name is the heading just above (review 2)
            }
            Button {
                remove()
                dismiss()
            } label: {
                Label("Remove", systemImage: "trash")
                    .font(.body.weight(.semibold))
                    .frame(maxWidth: .infinity, minHeight: 50)
                    .foregroundColor(.white)
                    .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Self.removeFill))
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Remove \(name)")
            .accessibilityIdentifier("attached-preview-remove")
        }
        .padding(.horizontal, 20).padding(.top, 24).padding(.bottom, 12)
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .background(Palette.ground.ignoresSafeArea())
    }
}

struct FileCard: View {
    let file: Board.Attachment
    let thumbnail: Data?
    let state: FileCardState
    // Another card's file is on its way.
    let waiting: Bool
    let open: () -> Void
    @Environment(\.dynamicTypeSize) private var typeSize
    // One line at the default sizes (the spec); two from xLarge up, so "Try again" is never cut off; three at the
    // accessibility sizes.
    private var lines: Int { typeSize.isAccessibilitySize ? 3 : typeSize >= .xLarge ? 2 : 1 }

    // A page or markup file is opened on the computer's board, never here (Board.isWebDocument).
    private var onBoard: Bool { Board.isWebDocument(name: file.name, type: file.type) }

    var body: some View {
        Button(action: open) {
            HStack(spacing: 12) {
                picture
                VStack(alignment: .leading, spacing: 2) {
                    Text(file.name).font(.subheadline.weight(.semibold)).foregroundColor(Palette.primary)
                        .lineLimit(lines).truncationMode(.middle)
                    meta
                }
                Spacer(minLength: 0)
            }
            .padding(.trailing, 12)
            // 64 pt at the default text size; taller when the text is, so nothing is cut off.
            .frame(minHeight: 64)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 12).fill(Palette.card))
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .contentShape(RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
        .disabled(state == .loading || waiting)
        .opacity(waiting ? 0.5 : 1)
        .accessibilityElement(children: .ignore)
        .accessibilityAddTraits(.isButton)
        .accessibilityLabel(file.name + ", " + Board.attachmentMeta(file))
        .accessibilityValue(state == .loading ? "Opening" : state == .failed ? "Could not open it" : "")
        .accessibilityHint(onBoard ? "Opens it on your computer's board." : state == .failed ? "Tries again." : "Opens the file.")
        .onChange(of: state) { now in
            if now == .failed { UIAccessibility.post(notification: .announcement, argument: "Could not open " + file.name + ".") }
        }
    }

    // A 64 pt picture for an image or a PDF with a preview; otherwise a symbol in a 40 pt rounded square.
    @ViewBuilder private var picture: some View {
        if let thumbnail, let image = UIImage(data: thumbnail) {
            Image(uiImage: image).resizable().aspectRatio(contentMode: .fill)
                .frame(width: 64, height: 64).clipped()
        } else {
            Image(systemName: Board.fileSymbol(file)).font(.system(size: 18)).foregroundColor(Palette.avatarLetter)
                .frame(width: 40, height: 40)
                .background(RoundedRectangle(cornerRadius: 9).fill(Palette.avatarFill))
                // Centred in the thumbnail's 64 pt slot, so every card's name starts at the same place (Mona Lisa).
                .frame(width: 64, height: 64)
        }
    }

    @ViewBuilder private var meta: some View {
        switch state {
        case .loading:
            KosmosOrb(size: 16)
        case .failed:
            Text("Could not open it. Try again.").font(.caption).foregroundColor(Palette.dangerWord).lineLimit(lines)
        case .ready:
            Text(onBoard ? "Opens on your computer's board" : Board.attachmentMeta(file)).font(.caption).foregroundColor(Palette.secondary).lineLimit(lines)
        }
    }
}
