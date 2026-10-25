import SwiftUI
import UIKit
import UIKit.UIGestureRecognizerSubclass

// kosmos#7074: whether the person is doing anything on the page (the board's tkPresent counts pointer and key input),
// seen where the window receives events rather than through a SwiftUI gesture: a page-wide drag gesture never sees a
// hardware keyboard or Full Keyboard Access, and laid over a ScrollView it can stop the scroll. The recognizer on the
// window notes every touch and key press and fails at once, so it never claims, delays or cancels anything.
struct PresenceProbe: UIViewRepresentable {
    let onInput: () -> Void

    func makeUIView(context: Context) -> ProbeView {
        let v = ProbeView()
        v.onInput = onInput
        v.isUserInteractionEnabled = false
        return v
    }

    func updateUIView(_ v: ProbeView, context: Context) { v.onInput = onInput }

    static func dismantleUIView(_ v: ProbeView, coordinator: ()) { v.detach() }

    final class ProbeView: UIView {
        var onInput: (() -> Void)?
        private var recognizer: InputRecognizer?

        override func didMoveToWindow() {
            super.didMoveToWindow()
            detach()
            guard let window else { return }
            let r = InputRecognizer(target: nil, action: nil)
            r.onInput = { [weak self] in self?.onInput?() }
            window.addGestureRecognizer(r)
            recognizer = r
        }

        func detach() {
            if let r = recognizer { r.view?.removeGestureRecognizer(r) }
            recognizer = nil
        }
    }

    final class InputRecognizer: UIGestureRecognizer, UIGestureRecognizerDelegate {
        var onInput: (() -> Void)?

        override init(target: Any?, action: Selector?) {
            super.init(target: target, action: action)
            cancelsTouchesInView = false
            delaysTouchesBegan = false
            delaysTouchesEnded = false
            delegate = self
        }

        override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
            onInput?()
            state = .failed
        }

        override func pressesBegan(_ presses: Set<UIPress>, with event: UIPressesEvent) {
            onInput?()
            state = .failed
        }

        func gestureRecognizer(_ g: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }
    }
}
