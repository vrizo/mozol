/// Everything that can make the app talk to the server. All of them go through one handler.
public enum AppEvent: Equatable, Sendable {
    case silentPush(raw: String)
    case becameActive
    case foregroundTimer
    case manualRefresh
    case backgroundRefresh
    case shortcut(name: String)

    /// Short name for logs. Never contains payload content.
    public var trigger: String {
        switch self {
        case .silentPush: "push"
        case .becameActive: "active"
        case .foregroundTimer: "timer"
        case .manualRefresh: "refresh"
        case .backgroundRefresh: "background"
        case .shortcut: "shortcut"
        }
    }
}
