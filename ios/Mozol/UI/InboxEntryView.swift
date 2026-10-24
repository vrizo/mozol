import MozolCore
import SwiftUI
import UIKit

/// The full raw body of one Inbox entry.
struct InboxEntryView: View {
    let entry: InboxEntry

    @State private var didCopy = false

    var body: some View {
        List {
            Section {
                LabeledContent("Source") { Text(entry.source.label) }
                LabeledContent("Received") {
                    Text(entry.receivedAt, format: .dateTime.year().month().day().hour().minute().second())
                }
            }
            Section("Body") {
                Text(entry.body)
                    .font(.system(.footnote, design: .monospaced))
                    .textSelection(.enabled)
                    .accessibilityIdentifier("inboxEntry.body")
            }
        }
        .navigationTitle("Message")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button(action: copy) {
                    if didCopy {
                        Text("Copied")
                    } else {
                        Text("Copy")
                    }
                }
            }
        }
        .sensoryFeedback(.success, trigger: didCopy) { _, new in new }
    }

    private func copy() {
        UIPasteboard.general.string = entry.body
        Log.ui.info("inbox entry copied bytes=\(entry.body.utf8.count)")
        didCopy = true
        Task {
            try? await Task.sleep(for: .seconds(2))
            didCopy = false
        }
    }
}
