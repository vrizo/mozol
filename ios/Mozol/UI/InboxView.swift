import MozolCore
import SwiftData
import SwiftUI

/// What MOZOL placed in Reminders, newest first: docs/ios/messages.md.
struct InboxView: View {
    @Environment(DeliverySync.self) private var sync
    @Environment(AppEventHandler.self) private var events
    @Environment(\.openURL) private var openURL
    @Query(sort: \DeliveryRecord.at, order: .reverse) private var records: [DeliveryRecord]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Space.s6) {
                    SyncStatusLine(status: sync.status, lastSuccess: sync.lastSuccess)
                    if sync.status == .needsRemindersAccess {
                        accessNotice
                    }
                    if records.isEmpty {
                        emptyState
                    } else {
                        SectionLabel(text: "Recent")
                        LazyVStack(spacing: Space.s4) {
                            ForEach(records) { record in
                                PlacedRow(record: record)
                                    .accessibilityIdentifier("placed.row")
                            }
                        }
                        .padding(.trailing, Outline.shadow)
                    }
                }
                .padding(.horizontal, Space.s4)
                .padding(.vertical, Space.s4)
            }
            .paperBackground()
            .navigationTitle("Placed in Reminders")
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
                    .accessibilityIdentifier("placed.refresh")
                }
            }
        }
    }
}

extension InboxView {
    private var accessNotice: some View {
        VStack(alignment: .leading, spacing: Space.s3) {
            Text("MOZOL needs full access to Reminders to place items.")
                .font(.bodyText)
                .foregroundStyle(Color.ink)
                .accessibilityIdentifier("placed.noAccess")
            Button("Open Settings") { openURL(URL(string: UIApplication.openSettingsURLString)!) }
                .buttonStyle(.secondary)
        }
        .padding(Space.s4)
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
    }

    private var emptyState: some View {
        VStack(alignment: .leading, spacing: Space.s4) {
            Image("InboxEmpty")
                .resizable()
                .scaledToFit()
                .frame(width: 128)
                .foregroundStyle(Color.muted)
                .accessibilityHidden(true)
                .accessibilityIdentifier("inbox.emptyIcon")
            Text("Nothing placed yet. Items from your calls appear here, as lines in your reminders or as new reminders.")
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
    let status: DeliverySync.Status
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
        .accessibilityIdentifier("placed.status")
    }

    private var isFailure: Bool {
        if case .failed = status { true } else { false }
    }

    private var text: Text {
        switch status {
        case .checking:
            Text("Checking now")
        case .failed(.http(let code, _)):
            Text("Couldn't check for new items: error \(code)")
        case .failed(.unreachable):
            Text("Couldn't reach the server")
        case .failed(.unreadable):
            Text("Couldn't read the server answer")
        case .idle, .needsRemindersAccess:
            if let lastSuccess {
                Text("Last checked at \(lastSuccess.formatted(date: .omitted, time: .shortened))")
            } else {
                Text("Not checked yet")
            }
        }
    }
}

struct PlacedRow: View {
    let record: DeliveryRecord

    var body: some View {
        VStack(alignment: .leading, spacing: Space.s2) {
            HStack(alignment: .firstTextBaseline) {
                Tag(text: record.kind.label)
                Spacer()
                Text(record.at, format: .dateTime.month().day().hour().minute())
                    .font(.mono(.caption))
                    .foregroundStyle(Color.ink2)
            }
            Text(record.title)
                .font(.bodyText)
                .foregroundStyle(Color.ink)
                .lineLimit(2)
            outcome
                .font(.secondaryText)
                .foregroundStyle(record.outcome == nil ? Color.danger : Color.ink2)
        }
        .padding(Space.s4)
        .frame(maxWidth: .infinity, alignment: .leading)
        .card(raised: true)
        .accessibilityElement(children: .combine)
    }

    private var outcome: Text {
        switch record.outcome {
        case .embedUpdated: Text("Updated a line in your reminder")
        case .reminderUpdated: Text("Updated a MOZOL reminder")
        case .embedded: Text("Added a line to your reminder")
        case .created: Text("Created a reminder")
        case nil:
            switch record.errorCode {
            case "reminders_access": Text("Failed: no full access to Reminders")
            case "no_default_list": Text("Failed: no default list in Reminders")
            case "eventkit_save": Text("Failed: Reminders refused the save")
            default: Text("Failed: \(record.errorCode ?? "")")
            }
        }
    }
}

extension RecommendationKind {
    var label: LocalizedStringKey {
        switch self {
        case .mistake: "Mistake"
        case .word: "Word"
        case .phrase: "Phrase"
        case .rewrite: "Rewrite"
        }
    }
}
