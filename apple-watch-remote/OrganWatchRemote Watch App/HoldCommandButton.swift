import SwiftUI
import WatchKit

struct RemoteActionButton: View {
    enum Size {
        case regular
        case prominent

        var iconFontSize: CGFloat {
            switch self {
            case .regular:
                return 15
            case .prominent:
                return 30
            }
        }

        var titleFont: Font {
            switch self {
            case .regular:
                return .system(.headline, design: .rounded).weight(.bold)
            case .prominent:
                return .system(.title3, design: .rounded).weight(.bold)
            }
        }

        var minHeight: CGFloat {
            switch self {
            case .regular:
                return 45
            case .prominent:
                return 65
            }
        }

        var verticalPadding: CGFloat {
            switch self {
            case .regular:
                return 8
            case .prominent:
                return 10
            }
        }
    }

    let title: String
    let systemImage: String
    let tint: Color
    let size: Size
    let action: RemoteAction

    @ObservedObject var client: RemoteCommandClient

    init(
        title: String,
        systemImage: String,
        tint: Color,
        size: Size = .regular,
        action: RemoteAction,
        client: RemoteCommandClient
    ) {
        self.title = title
        self.systemImage = systemImage
        self.tint = tint
        self.size = size
        self.action = action
        self.client = client
    }

    var body: some View {
        Button(action: triggerAction) {
            VStack(spacing: 4) {
                Image(systemName: systemImage)
                    .font(.system(size: size.iconFontSize, weight: .bold))

                Text(title)
                    .font(size.titleFont)
            }
            .frame(maxWidth: .infinity, minHeight: size.minHeight)
            .padding(.vertical, size.verticalPadding)
        }
        .buttonStyle(RemoteActionButtonStyle(tint: tint, isEnabled: client.canSendActions))
        .disabled(!client.canSendActions)
        .accessibilityAddTraits(.isButton)
        .accessibilityHint(client.canSendActions ? "Double tap to send \(title)" : "Unavailable until the server address resolves")
    }

    private func triggerAction() {
        guard client.canSendActions else {
            return
        }

        WKInterfaceDevice.current().play(.click)
        client.sendAction(action)
    }
}

private struct RemoteActionButtonStyle: ButtonStyle {
    let tint: Color
    let isEnabled: Bool

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(.white)
            .background(buttonBackground(isPressed: configuration.isPressed))
            .overlay(buttonOutline(isPressed: configuration.isPressed))
            .contentShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
            .scaleEffect(configuration.isPressed ? 0.97 : 1.0)
            .opacity(isEnabled ? 1.0 : 0.36)
            .shadow(color: tint.opacity(configuration.isPressed ? 0.15 : 0.32), radius: 8, y: 5)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }

    private func buttonBackground(isPressed: Bool) -> some View {
        RoundedRectangle(cornerRadius: 20, style: .continuous)
            .fill(
                LinearGradient(
                    colors: [
                        tint.opacity(isPressed ? 1.0 : 0.82),
                        Color.black.opacity(0.88)
                    ],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
    }

    private func buttonOutline(isPressed: Bool) -> some View {
        RoundedRectangle(cornerRadius: 20, style: .continuous)
            .strokeBorder(.white.opacity(isPressed ? 0.38 : 0.16), lineWidth: 1)
    }
}
