import Foundation
import MozolCore
import Observation
import SwiftData

enum SyncOutcome: Equatable {
    case newData(count: Int)
    case noData
    case failed(APIError)
    case skipped
}

/// Claims deliveries, places them in Reminders and reports the outcomes: docs/ios/messages.md.
@Observable
final class DeliverySync {
    enum Status: Equatable {
        case idle
        case checking
        case needsRemindersAccess
        case failed(APIError)
    }

    static let lastSuccessKey = "mozol.deliveriesLastSuccess"
    static let lastBackgroundKey = "mozol.lastBackgroundRefresh"

    private(set) var status: Status = .idle
    private(set) var lastSuccess: Date?
    private(set) var lastBackgroundRun: Date?

    @ObservationIgnored private let api: APIClient
    @ObservationIgnored private let session: SessionStore
    @ObservationIgnored private let reminders: RemindersStore
    @ObservationIgnored private let context: ModelContext
    @ObservationIgnored private let defaults: UserDefaults

    init(api: APIClient, session: SessionStore, reminders: RemindersStore, context: ModelContext, defaults: UserDefaults) {
        self.api = api
        self.session = session
        self.reminders = reminders
        self.context = context
        self.defaults = defaults
        lastSuccess = defaults.object(forKey: Self.lastSuccessKey) as? Date
        lastBackgroundRun = defaults.object(forKey: Self.lastBackgroundKey) as? Date
    }

    func run(trigger: String) async -> SyncOutcome {
        guard status != .checking else {
            Log.sync.info("claim skipped trigger=\(trigger, privacy: .public): a run is in progress")
            return .skipped
        }
        reminders.refreshAuthorization()
        guard reminders.hasFullAccess else {
            status = .needsRemindersAccess
            Log.sync.info("claim skipped trigger=\(trigger, privacy: .public): no full access to Reminders")
            return .skipped
        }
        status = .checking
        Log.sync.info("claim start trigger=\(trigger, privacy: .public)")

        var placed = 0
        do {
            for _ in 0..<SyncPolicy.maxClaimRounds {
                let claim = try await claimRound()
                placed += claim.placed
                if claim.handedOut < SyncPolicy.claimLimit { break }
            }
        } catch {
            status = .failed(error)
            Log.sync.error("claim failed trigger=\(trigger, privacy: .public) error=\(String(describing: error), privacy: .public)")
            return .failed(error)
        }
        let now = Date.now
        lastSuccess = now
        defaults.set(now, forKey: Self.lastSuccessKey)
        status = .idle
        Log.sync.info("claim done trigger=\(trigger, privacy: .public) placed=\(placed)")
        return placed > 0 ? .newData(count: placed) : .noData
    }

    /// One claim, its deliveries applied in claim order, and the results.
    private func claimRound() async throws(APIError) -> (handedOut: Int, placed: Int) {
        let data = try await api.post(
            "api/deliveries/claim",
            json: ClaimBody(installationId: session.installationID, limit: SyncPolicy.claimLimit)
        )
        let claim = try api.decode(ClaimResponse.self, from: data, path: "api/deliveries/claim")
        Log.sync.info("claimed count=\(claim.deliveries.count) embed=\(claim.embedInMyReminders)")
        guard !claim.deliveries.isEmpty else { return (0, 0) }

        var snapshots: [ReminderSnapshot]?
        var fetchError: RemindersError?
        do {
            snapshots = try await reminders.allReminders()
        } catch {
            fetchError = error
        }

        var results: [DeliveryResult] = []
        for item in claim.deliveries {
            let result = apply(item, embed: claim.embedInMyReminders, snapshots: &snapshots, fetchError: fetchError)
            results.append(result)
            record(item, result)
        }
        saveRecords()

        let answer = try await api.post(
            "api/deliveries/results",
            json: ResultsBody(installationId: session.installationID, results: results)
        )
        let accepted = try api.decode(ResultsResponse.self, from: answer, path: "api/deliveries/results").accepted
        let placed = results.filter { $0.outcome != "failed" }.count
        Log.sync.info("results sent count=\(results.count) placed=\(placed) accepted=\(accepted)")
        return (claim.deliveries.count, placed)
    }

    private func apply(_ item: DeliveryItem, embed: Bool, snapshots: inout [ReminderSnapshot]?, fetchError: RemindersError?) -> DeliveryResult {
        let marker = item.recommendation.marker
        guard var current = snapshots else {
            let code = (fetchError ?? .fetchFailed).deliveryCode
            Log.sync.error("delivery failed marker=\(marker, privacy: .public) code=\(code, privacy: .public)")
            return .failed(item.deliveryId, code: code)
        }
        do {
            let plan = try DeliveryPlanner.plan(item, embedInMyReminders: embed, reminders: current, timeZone: .current)
            let changed = try reminders.apply(plan)
            for reminder in changed {
                if let index = current.firstIndex(where: { $0.id == reminder.id }) {
                    current[index] = reminder
                } else {
                    current.append(reminder)
                }
            }
            snapshots = current
            Log.sync.info("delivery applied marker=\(marker, privacy: .public) outcome=\(plan.outcome.rawValue, privacy: .public) reminders=\(changed.count)")
            return .applied(item.deliveryId, plan.outcome)
        } catch let error as DeliveryPlanner.Failure {
            Log.sync.error("delivery failed marker=\(marker, privacy: .public) code=\(error.code, privacy: .public)")
            return .failed(item.deliveryId, code: error.code)
        } catch let error as RemindersError {
            Log.sync.error("delivery failed marker=\(marker, privacy: .public) code=\(error.deliveryCode, privacy: .public)")
            return .failed(item.deliveryId, code: error.deliveryCode)
        } catch {
            fatalError("unexpected error while applying a delivery: \(error)")
        }
    }

    private func record(_ item: DeliveryItem, _ result: DeliveryResult) {
        let id = item.deliveryId
        let existing = FetchDescriptor<DeliveryRecord>(predicate: #Predicate { $0.deliveryID == id })
        let found: DeliveryRecord?
        do {
            found = try context.fetch(existing).first
        } catch {
            fatalError("delivery record fetch failed: \(error)")
        }
        if let found {
            found.outcomeRaw = result.outcome
            found.errorCode = result.errorCode
            found.at = .now
        } else {
            context.insert(DeliveryRecord(
                deliveryID: id,
                recommendationID: item.recommendation.id,
                kind: item.recommendation.kind,
                title: item.recommendation.title,
                outcome: result.outcome,
                errorCode: result.errorCode,
                at: .now
            ))
        }
    }

    private func saveRecords() {
        do {
            try context.save()
        } catch {
            fatalError("delivery records not saved: \(error)")
        }
    }

    func recordBackgroundRun(at date: Date = .now) {
        lastBackgroundRun = date
        defaults.set(date, forKey: Self.lastBackgroundKey)
    }

    /// Sign-out: deletes the records and the sync times.
    func reset() {
        do {
            try context.delete(model: DeliveryRecord.self)
            try context.save()
        } catch {
            fatalError("delivery records reset failed: \(error)")
        }
        Self.clearDefaults(defaults)
        lastSuccess = nil
        lastBackgroundRun = nil
        status = .idle
        Log.store.info("delivery records cleared")
    }

    static func clearDefaults(_ defaults: UserDefaults) {
        for key in [lastSuccessKey, lastBackgroundKey] { defaults.removeObject(forKey: key) }
    }
}
