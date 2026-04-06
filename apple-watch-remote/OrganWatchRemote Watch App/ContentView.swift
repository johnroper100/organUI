import CoreMotion
import SwiftUI
import WatchKit

struct ContentView: View {
    @Environment(\.isLuminanceReduced) private var isLuminanceReduced
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var client = RemoteCommandClient()
    @State private var wristFlickDetector = WristFlickDetector()
    @AppStorage("wristFlickBackEnabled") private var isBackWristFlickEnabled = true
    @AppStorage("wristFlickNextEnabled") private var isNextWristFlickEnabled = true

    var body: some View {
        ZStack {
            backgroundFill
                .ignoresSafeArea()

            TabView {
                remotePage
                infoPage
            }
        }
        .onAppear {
            updateWristFlickMonitoring(for: scenePhase)
        }
        .onChange(of: scenePhase) { _, newPhase in
            updateWristFlickMonitoring(for: newPhase)
        }
        .onChange(of: isBackWristFlickEnabled) { _, _ in
            updateWristFlickMonitoring(for: scenePhase)
        }
        .onChange(of: isNextWristFlickEnabled) { _, _ in
            updateWristFlickMonitoring(for: scenePhase)
        }
        .onDisappear {
            wristFlickDetector.stop()
        }
    }

    private var remotePage: some View {
        VStack(spacing: 10) {
            VStack(spacing: 3) {
                serverStatusView
                    .lineLimit(2)
                    .minimumScaleFactor(0.65)
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.white.opacity(isLuminanceReduced ? 0.52 : 0.72))

                if client.isError, !client.statusText.isEmpty {
                    Text(client.statusText)
                        .font(.system(.caption, design: .rounded).weight(.semibold))
                        .multilineTextAlignment(.center)
                        .foregroundStyle(.red)
                }
            }
            .padding(.bottom, 2)

            RemoteActionButton(
                title: "Back",
                systemImage: "backward.fill",
                tint: .red,
                action: .back,
                client: client
            )

            RemoteActionButton(
                title: "Next",
                systemImage: "forward.fill",
                tint: .green,
                size: .prominent,
                action: .next,
                client: client
            )
        }
        .padding(10)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var infoPage: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 15) {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Wrist Flick:")
                        .font(.system(.headline, design: .rounded).weight(.semibold))

                    Toggle("Next", isOn: $isNextWristFlickEnabled)
                    Toggle("Back", isOn: $isBackWristFlickEnabled)
                }

                infoRow(title: "Version:", value: appVersionText)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(10)
    }

    @ViewBuilder
    private var backgroundFill: some View {
        if isLuminanceReduced {
            Color.black
        } else {
            LinearGradient(
                colors: [
                    Color(red: 0.08, green: 0.11, blue: 0.17),
                    Color.black
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        }
    }

    @ViewBuilder
    private var serverStatusView: some View {
        if let connectedServer = client.connectedServer {
            VStack(spacing: 1) {
                Text(connectedServer.host)
                    .font(.system(size: 9, weight: .medium, design: .rounded))

                Text(connectedServer.siteName)
                    .font(.system(.caption2, design: .rounded).weight(.medium))
            }
        } else {
            Text(client.serverLabel)
                .font(.system(.caption2, design: .rounded).weight(.medium))
        }
    }

    private func infoRow(title: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(.system(.caption2, design: .rounded).weight(.medium))
                .foregroundStyle(.white.opacity(isLuminanceReduced ? 0.5 : 0.68))

            Text(value)
                .font(.system(.body, design: .rounded).weight(.semibold))
                .lineLimit(2)
                .minimumScaleFactor(0.8)
        }
    }

    private var appVersionText: String {
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
        let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String

        switch (version, build) {
        case let (version?, build?) where version != build:
            return "\(version) (\(build))"
        case let (version?, _):
            return version
        case let (_, build?):
            return build
        default:
            return "Unavailable"
        }
    }

    private func updateWristFlickMonitoring(for phase: ScenePhase) {
        wristFlickDetector.updateConfiguration(
            isBackCommandEnabled: isBackWristFlickEnabled,
            isNextCommandEnabled: isNextWristFlickEnabled
        )

        guard phase == .active, isBackWristFlickEnabled || isNextWristFlickEnabled else {
            wristFlickDetector.stop()
            return
        }

        wristFlickDetector.start(client: client)
    }
}

@MainActor
private final class WristFlickDetector {
    private struct MotionSample: Sendable {
        let timestamp: TimeInterval
        let pitch: Double
        let pitchRate: Double
        let accelerationMagnitude: Double
    }

    private struct FlickTriggerProfile {
        let pitchDelta: Double
        let pitchRate: Double
        let acceleration: Double
        let maximumTravelTime: TimeInterval
    }

    private enum FlickDirection {
        case front
        case back

        var action: RemoteAction {
            switch self {
            case .front:
                return .next
            case .back:
                return .back
            }
        }
    }

    private static let sampleInterval = 1.0 / 50.0
    private static let baselineBlend = 0.08
    private static let baselineWindow = 0.10
    private static let rearmWindow = 0.06
    private static let minimumTriggerInterval: TimeInterval = 0.75
    private static let frontTriggerProfile = FlickTriggerProfile(
        pitchDelta: 0.42,
        pitchRate: 3.6,
        acceleration: 0.55,
        maximumTravelTime: 0.18
    )
    private static let backTriggerProfile = FlickTriggerProfile(
        pitchDelta: 0.32,
        pitchRate: 2.7,
        acceleration: 0.40,
        maximumTravelTime: 0.24
    )

    private let motionManager = CMMotionManager()
    private let motionQueue: OperationQueue = {
        let queue = OperationQueue()
        queue.name = "OrganWatchRemote.WristFlickDetector"
        queue.qualityOfService = .userInitiated
        queue.maxConcurrentOperationCount = 1
        return queue
    }()

    private weak var client: RemoteCommandClient?
    private var neutralPitch: Double?
    private var isMonitoring = false
    private var isArmed = true
    private var isBackCommandEnabled = true
    private var isNextCommandEnabled = true
    private var lastTriggerTime: TimeInterval = 0
    private var lastNeutralTime: TimeInterval = 0

    func updateConfiguration(isBackCommandEnabled: Bool, isNextCommandEnabled: Bool) {
        self.isBackCommandEnabled = isBackCommandEnabled
        self.isNextCommandEnabled = isNextCommandEnabled
    }

    func start(client: RemoteCommandClient) {
        self.client = client

        guard !isMonitoring, motionManager.isDeviceMotionAvailable else {
            return
        }

        neutralPitch = nil
        isArmed = true
        lastTriggerTime = 0
        lastNeutralTime = 0
        motionManager.deviceMotionUpdateInterval = Self.sampleInterval
        motionManager.startDeviceMotionUpdates(to: motionQueue) { [weak self] motion, error in
            guard error == nil, let motion else {
                return
            }

            let userAcceleration = motion.userAcceleration
            let accelerationMagnitude = sqrt(
                (userAcceleration.x * userAcceleration.x) +
                (userAcceleration.y * userAcceleration.y) +
                (userAcceleration.z * userAcceleration.z)
            )

            let sample = MotionSample(
                timestamp: motion.timestamp,
                pitch: motion.attitude.pitch,
                pitchRate: motion.rotationRate.x,
                accelerationMagnitude: accelerationMagnitude
            )

            Task { @MainActor [weak self] in
                self?.handle(sample)
            }
        }

        isMonitoring = true
    }

    func stop() {
        guard isMonitoring else {
            return
        }

        motionManager.stopDeviceMotionUpdates()
        neutralPitch = nil
        isArmed = true
        lastTriggerTime = 0
        lastNeutralTime = 0
        isMonitoring = false
    }

    private func handle(_ sample: MotionSample) {
        guard let client else {
            return
        }

        guard isBackCommandEnabled || isNextCommandEnabled else {
            return
        }

        if neutralPitch == nil {
            neutralPitch = sample.pitch
            lastNeutralTime = sample.timestamp
            return
        }

        guard let neutralPitch else {
            return
        }

        let pitchDelta = normalizedAngle(sample.pitch - neutralPitch)

        if abs(pitchDelta) < Self.rearmWindow {
            isArmed = true
            lastNeutralTime = sample.timestamp
        }

        if abs(pitchDelta) < Self.baselineWindow,
           abs(sample.pitchRate) < Self.frontTriggerProfile.pitchRate * 0.4,
           sample.accelerationMagnitude < Self.frontTriggerProfile.acceleration * 0.6 {
            self.neutralPitch = neutralPitch + ((sample.pitch - neutralPitch) * Self.baselineBlend)
        }

        guard isArmed,
              sample.timestamp - lastTriggerTime >= Self.minimumTriggerInterval else {
            return
        }

        // Reverse flicks tend to be softer, so use a slightly looser profile.
        if isNextCommandEnabled,
           matchesFlick(sample, pitchDelta: pitchDelta, direction: .front, profile: Self.frontTriggerProfile) {
            trigger(.front, at: sample.timestamp, client: client)
        } else if isBackCommandEnabled,
                  matchesFlick(sample, pitchDelta: pitchDelta, direction: .back, profile: Self.backTriggerProfile) {
            trigger(.back, at: sample.timestamp, client: client)
        }
    }

    private func trigger(_ direction: FlickDirection, at timestamp: TimeInterval, client: RemoteCommandClient) {
        lastTriggerTime = timestamp
        isArmed = false
        WKInterfaceDevice.current().play(.click)
        client.sendAction(direction.action)
    }

    private func normalizedAngle(_ angle: Double) -> Double {
        atan2(sin(angle), cos(angle))
    }

    private func matchesFlick(
        _ sample: MotionSample,
        pitchDelta: Double,
        direction: FlickDirection,
        profile: FlickTriggerProfile
    ) -> Bool {
        guard sample.timestamp - lastNeutralTime <= profile.maximumTravelTime,
              sample.accelerationMagnitude >= profile.acceleration else {
            return false
        }

        switch direction {
        case .front:
            return pitchDelta <= -profile.pitchDelta &&
                   sample.pitchRate <= -profile.pitchRate
        case .back:
            return pitchDelta >= profile.pitchDelta &&
                   sample.pitchRate >= profile.pitchRate
        }
    }
}

#Preview {
    ContentView()
}

#Preview("Always On") {
    ContentView()
        .environment(\.isLuminanceReduced, true)
}
