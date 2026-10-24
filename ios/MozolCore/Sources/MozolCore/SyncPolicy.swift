import Foundation

/// Timing of message fetches: docs/ios/messages.md.
public enum SyncPolicy {
    public static let foregroundInterval: Duration = .seconds(60)
    public static let backgroundEarliestDelay: TimeInterval = 15 * 60
    public static let backgroundTaskID = "net.vrizo.mozol.refresh"
}
