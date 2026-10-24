import Foundation

/// Timing and size of delivery claims: docs/ios/messages.md.
public enum SyncPolicy {
    public static let foregroundInterval: Duration = .seconds(60)
    public static let backgroundEarliestDelay: TimeInterval = 15 * 60
    public static let backgroundTaskID = "net.vrizo.mozol.refresh"
    public static let claimLimit = 20
    /// A run claims again while a claim comes back full, at most this many times.
    public static let maxClaimRounds = 5
}
