import MozolCore
import SwiftData
import SwiftUI

/// Raw silent pushes and server messages, newest first: docs/ios/messages.md.
struct InboxView: View {
    @Environment(MessageSync.self) private var sync
    @Environment(AppEventHandler.self) private var events
    @Query(sort: \InboxEntry.receivedAt, order: .reverse) private var entries: [InboxEntry]

    var body: some View {
        NavigationStack {
            List {
                Section {
                    SyncStatusLine(status: sync.status, lastSuccess: sync.lastSuccess)
                }
                Section {
                    ForEach(entries) { entry in
                        NavigationLink(value: entry.key) {
                            InboxRow(entry: entry)
                        }
                    }
                }
            }
            .overlay {
                if entries.isEmpty {
                    ContentUnavailableView(
                        "No Messages Yet",
                        systemImage: "tray",
                        description: Text("Messages and silent pushes from the MOZOL server appear here.")
                    )
                }
            }
            .navigationTitle("Inbox")
            .navigationDestination(for: String.self) { key in
                if let entry = entries.first(where: { $0.key == key }) {
                    InboxEntryView(entry: entry)
                }
            }
            .refreshable { await events.handle(.manualRefresh) }
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        Task { await events.handle(.manualRefresh) }
                    } label: {
                        Label("Refresh", systemImage: "arrow.clockwise")
                    }
                    .disabled(sync.status == .checking)
                    .accessibilityIdentifier("inbox.refresh")
                }
            }
        }
    }
}

struct SyncStatusLine: View {
    let status: MessageSync.Status
    let lastSuccess: Date?

    var body: some View {
        HStack(spacing: 8) {
            if status == .checking {
                ProgressView()
                    .accessibilityHidden(true)
            }
            text
                .font(.footnote)
                .foregroundStyle(isFailure ? .red : .secondary)
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("inbox.status")
    }

    private var isFailure: Bool {
        if case .failed = status { true } else { false }
    }

    private var text: Text {
        switch status {
        case .checking:
            Text("Checking now")
        case .failed(.http(let code, _)):
            Text("Couldn't check for messages: error \(code)")
        case .failed(.unreachable):
            Text("Couldn't reach the server")
        case .failed(.unreadable):
            Text("Couldn't read the server answer")
        case .idle:
            if let lastSuccess {
                Text("Last checked at \(lastSuccess.formatted(date: .omitted, time: .shortened))")
            } else {
                Text("Not checked yet")
            }
        }
    }
}

struct InboxRow: View {
    let entry: InboxEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(entry.source.label)
                    .font(.subheadline.weight(.semibold))
                Spacer()
                Text(entry.receivedAt, format: .dateTime.hour().minute().second())
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            Text(RawJSON.preview(entry.body))
                .font(.system(.footnote, design: .monospaced))
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("inbox.row")
    }
}

extension InboxSource {
    var label: LocalizedStringKey {
        switch self {
        case .push: "Silent push"
        case .server: "Server"
        }
    }
}
