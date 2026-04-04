import SwiftUI
import WatchKit

struct HoldCommandButton: View {
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
    let command: String

    @ObservedObject var client: RemoteCommandClient

    @State private var isPressed = false
    @State private var pressTask: Task<Void, Never>?

    init(
        title: String,
        systemImage: String,
        tint: Color,
        size: Size = .regular,
        command: String,
        client: RemoteCommandClient
    ) {
        self.title = title
        self.systemImage = systemImage
        self.tint = tint
        self.size = size
        self.command = command
        self.client = client
    }

    var body: some View {
        let isResolvingServer = !client.canSendCommands
        let isBlockedByAnotherCommand = client.activeCommand != nil && client.activeCommand != command
        let isInteractionEnabled = !isResolvingServer && !isBlockedByAnotherCommand

        VStack(spacing: 4) {
            Image(systemName: systemImage)
                .font(.system(size: size.iconFontSize, weight: .bold))

            Text(title)
                .font(size.titleFont)
        }
        .frame(maxWidth: .infinity, minHeight: size.minHeight)
        .padding(.vertical, size.verticalPadding)
        .foregroundStyle(.white)
        .background(buttonBackground)
        .overlay(buttonOutline)
        .contentShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .scaleEffect(isPressed ? 0.97 : 1.0)
        .opacity(isResolvingServer ? 0.36 : isBlockedByAnotherCommand ? 0.55 : 1.0)
        .shadow(color: tint.opacity(isPressed ? 0.15 : 0.32), radius: 8, y: 5)
        .animation(.easeOut(duration: 0.12), value: isPressed)
        .allowsHitTesting(isInteractionEnabled)
        .gesture(
            DragGesture(minimumDistance: 0)
                .onChanged { _ in
                    beginPress()
                }
                .onEnded { _ in
                    endPress()
                }
        )
        .accessibilityAddTraits(.isButton)
        .accessibilityHint(isResolvingServer ? "Unavailable until the server address resolves" : "Press and hold to send \(title)")
        .onDisappear {
            endPress()
        }
    }

    private var buttonBackground: some View {
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

    private var buttonOutline: some View {
        RoundedRectangle(cornerRadius: 20, style: .continuous)
            .strokeBorder(.white.opacity(isPressed ? 0.38 : 0.16), lineWidth: 1)
    }

    private func beginPress() {
        guard !isPressed, client.beginExclusiveCommand(command) else {
            return
        }

        isPressed = true
        WKInterfaceDevice.current().play(.click)
        pressTask = Task {
            await client.sendCommand(command, state: 1)
        }
    }

    private func endPress() {
        guard isPressed else {
            return
        }

        isPressed = false
        WKInterfaceDevice.current().play(.click)

        let currentPressTask = pressTask
        pressTask = nil

        Task {
            if let currentPressTask {
                _ = await currentPressTask.value
            }
            await client.finishExclusiveCommand(command)
        }
    }
}
