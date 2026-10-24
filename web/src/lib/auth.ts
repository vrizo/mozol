// Pure helpers for the sign-in pages: the app return address and field errors from API issues.
import type { Issue } from "../api";

export function isAppReturn(value: string | null): value is string {
  return !!value && value.startsWith("mozol://") && value.length > "mozol://".length;
}

export function withCode(address: string, code: string): string {
  const separator = address.includes("?") ? "&" : "?";
  return `${address}${separator}code=${encodeURIComponent(code)}`;
}

// The first issue per top-level field: { email: "invalid_format" }.
export function fieldErrors(issues: Issue[]): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of issues) {
    const field = issue.path.split(".")[0] ?? "";
    if (!(field in errors)) errors[field] = issue.code;
  }
  return errors;
}
