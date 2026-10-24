import os

/// The only logging channel of the app. Categories are a closed set: docs/logs/layout.md.
public enum Log {
    public static let subsystem = "net.vrizo.mozol"

    public static let api = Logger(subsystem: subsystem, category: "api")
    public static let sync = Logger(subsystem: subsystem, category: "sync")
    public static let notify = Logger(subsystem: subsystem, category: "notify")
    public static let store = Logger(subsystem: subsystem, category: "store")
    public static let ui = Logger(subsystem: subsystem, category: "ui")
}
