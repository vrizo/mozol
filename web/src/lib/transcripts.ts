// Pure helpers of the Transcript page.
import type { Category, Finding, Severity, Transcript } from "shared";

const SEVERITY_ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

// Findings grouped by category; groups and findings inside them ordered high severity first, then result order.
export function groupFindings(findings: Finding[]): { category: Category; findings: Finding[] }[] {
  const sorted = findings
    .map((finding, index) => ({ finding, index }))
    .sort(
      (a, b) => SEVERITY_ORDER[a.finding.severity] - SEVERITY_ORDER[b.finding.severity] || a.index - b.index,
    )
    .map(({ finding }) => finding);
  const groups = new Map<Category, Finding[]>();
  for (const finding of sorted) {
    const group = groups.get(finding.category);
    if (group) group.push(finding);
    else groups.set(finding.category, [finding]);
  }
  return Array.from(groups, ([category, list]) => ({ category, findings: list }));
}

export function isBusy(status: Transcript["status"]): boolean {
  return status === "received" || status === "queued" || status === "analyzing";
}

// "45 s", "12 min", "1 h 05 min".
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`;
}
