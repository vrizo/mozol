import Foundation

/// The APNs device token as hex text, the form the server and Settings use.
public enum DeviceToken {
    public static func hex(_ data: Data) -> String {
        data.map { String(format: "%02x", $0) }.joined()
    }
}
