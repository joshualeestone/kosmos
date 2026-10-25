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
    // kosmos#7071: drawn faded when it can be sent again, as a text bubble is; and what VoiceOver says for the bubble
    // (who and when) before its cards.
    var faded = false
    var spoken: String? = nil

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
                .padding(.vertical, 10).padding(.horizontal, 12)
                .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Palette.personBubble))
                .frame(maxWidth: UIScreen.main.bounds.width * max(widthShare, 0.85), alignment: .trailing)
                .fixedSize(horizontal: false, vertical: true)
        } else {
            content.modifier(AgentBubbleBackground(widthShare: widthShare))
        }
    }
}

// kosmos#7071: a file waiting on the composer, with its x, or carried by a message still on its way (no x).
struct FileChip: View {
    let name: String
    var faded = false
    var remove: (() -> Void)? = nil

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "doc").font(.system(size: 13)).foregroundColor(Palette.secondary)
                .accessibilityHidden(true)
            Text(name).font(.footnote).foregroundColor(Palette.primary.opacity(faded ? 0.6 : 1))
                .lineLimit(1).truncationMode(.middle)
                // Cut in the middle, so a long name keeps its end and the next file shows beside it.
                .frame(maxWidth: 180, alignment: .leading)
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
            ProgressView().controlSize(.small)
        case .failed:
            Text("Could not open it. Try again.").font(.caption).foregroundColor(Palette.dangerWord).lineLimit(lines)
        case .ready:
            Text(onBoard ? "Opens on your computer's board" : Board.attachmentMeta(file)).font(.caption).foregroundColor(Palette.secondary).lineLimit(lines)
        }
    }
}
