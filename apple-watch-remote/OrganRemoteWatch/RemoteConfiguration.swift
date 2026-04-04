import Foundation

enum RemoteConfiguration {
    // Optional manual fallback if Bonjour discovery is unavailable.
    static let serverInput = ""
    static let serverDisplayName = "Organ Remote"
    static let bonjourServiceType = "_organremote._tcp"
    static let bonjourDomain = "local."

    static let backCommand = "/OPTICS/special2014"
    static let nextCommand = "/OPTICS/special2015"
}
