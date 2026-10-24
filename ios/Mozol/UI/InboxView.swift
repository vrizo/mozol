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
            ScrollView {
                VStack(alignment: .leading, spacing: Space.s6) {
                    SyncStatusLine(status: sync.status, lastSuccess: sync.lastSuccess)
                    if entries.isEmpty {
                        emptyState
                    } else {
                        SectionLabel(text: "Messages")
                        LazyVStack(spacing: Space.s4) {
                            ForEach(entries) { entry in
                                NavigationLink(value: entry.key) {
                                    InboxRow(entry: entry)
                                }
                                .buttonStyle(.plain)
                                .accessibilityIdentifier("inbox.row")
                            }
                        }
                        .padding(.trailing, Outline.shadow)
                    }
                }
                .padding(.horizontal, Space.s4)
                .padding(.vertical, Space.s4)
            }
            .paperBackground()
            .navigationTitle("Inbox")
            .navigationDestination(for: String.self) { key in
                if let entry = entries.first(where: { $0.key == key }) {
                    InboxEntryView(entry: entry)
                }
            }
            .refreshable { await events.handle(.manualRefresh) }
            .tint(Color.ink)
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        Task { await events.handle(.manualRefresh) }
                    } label: {
                        Label("Refresh", systemImage: "arrow.clockwise")
                    }
                    .tint(Color.ink)
                    .disabled(sync.status == .checking)
                    .accessibilityIdentifier("inbox.refresh")
                }
            }
        }
    }
}

extension InboxView {
    private var emptyState: some View {
        VStack(alignment: .leading, spacing: Space.s4) {
            Text("No messages yet. Messages and silent pushes from the MOZOL server appear here.")
                .font(.bodyText)
                .foregroundStyle(Color.ink2)
            Button {
                Task { await events.handle(.manualRefresh) }
            } label: {
                Text("Check Now")
            }
            .buttonStyle(.primary)
            .disabled(sync.status == .checking)
        }
        .padding(.top, Space.s8)
    }
}

struct SyncStatusLine: View {
    let status: MessageSync.Status
    let lastSuccess: Date?

    var body: some View {
        HStack(spacing: Space.s2) {
            if status == .checking {
                PlusLoadingRow()
            }
            text
                .font(.mono(.footnote))
                .foregroundStyle(isFailure ? Color.danger : Color.ink2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
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
        VStack(alignment: .leading, spacing: Space.s2) {
            HStack(alignment: .firstTextBaseline) {
                Tag(text: entry.source.label)
                Spacer()
                Text(entry.receivedAt, format: .dateTime.hour().minute().second())
                    .font(.mono(.caption))
                    .foregroundStyle(Color.ink2)
            }
            Text(RawJSON.preview(entry.body))
                .font(.mono(.footnote))
                .foregroundStyle(Color.ink)
                .lineLimit(1)
        }
        .padding(Space.s4)
        .frame(maxWidth: .infinity, alignment: .leading)
        .card(raised: true)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
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
