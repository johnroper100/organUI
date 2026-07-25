import Foundation

enum RemoteAction: String, Encodable {
    case back
    case next
}

enum RemoteConfiguration {
    // Optional manual fallback if Bonjour discovery is unavailable.
    static let serverInput = ""
    static let serverDisplayName = "Organ Remote"
    static let bonjourServiceType = "_organremote._tcp"
    static let bonjourDomain = "local."
    static let remoteActionPath = "/api/remote-action"
}
