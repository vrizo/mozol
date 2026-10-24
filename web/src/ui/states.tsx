// Shared page states: loading, empty, error and inline notices.
import type { ReactNode } from "react";
import { ApiError } from "../api";
import { copy } from "../copy/en";
import { Link } from "../router";

// The code shown to the user for a failed request (docs/rules/ui-copy.md): the API code, or "network".
export function errorCode(error: unknown): string {
  if (error instanceof ApiError) return error.code;
  if (error instanceof TypeError) return "network";
  return "app_error";
}

export function errorRid(error: unknown): string | null {
  return error instanceof ApiError ? error.rid : null;
}

export function Loading({ label = copy.states.loading }: { label?: string }) {
  return (
    <p className="loading" role="status">
      <span className="visually-hidden">{label}</span>
      <span aria-hidden="true" className="loading-marks">
        {Array.from({ length: 5 }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed row of marks
          <span key={i} style={{ animationDelay: `${i * 0.15}s` }}>
            +
          </span>
        ))}
      </span>
    </p>
  );
}

export function Empty({
  text,
  action,
  icon = true,
}: {
  text: string;
  action?: { href: string; label: string };
  icon?: boolean;
}) {
  return (
    <div className="empty">
      {icon && <span className="empty-icon" aria-hidden="true" />}
      <p>{text}</p>
      {action && (
        <Link className="button button-primary" href={action.href}>
          {action.label}
        </Link>
      )}
    </div>
  );
}

// What failed in plain words, the error code, and a retry button.
export function ErrorState({ what, error, onRetry }: { what: string; error: unknown; onRetry?: () => void }) {
  const rid = errorRid(error);
  return (
    <div className="error-state" role="alert">
      <p>{copy.states.failed(what, errorCode(error))}</p>
      {rid && <p className="mono small">{copy.states.requestId(rid)}</p>}
      {onRetry && (
        <button type="button" className="button button-secondary" onClick={onRetry}>
          {copy.states.retry}
        </button>
      )}
    </div>
  );
}

export function Notice({
  tone = "info",
  children,
}: {
  tone?: "info" | "error" | "success";
  children: ReactNode;
}) {
  return (
    <div className={`notice notice-${tone}`} role={tone === "error" ? "alert" : "status"}>
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  kicker,
  children,
}: {
  title: string;
  kicker?: string;
  children?: ReactNode;
}) {
  return (
    <header className="page-header">
      {kicker && <p className="label">{kicker}</p>}
      <h1>{title}</h1>
      {children && <div className="page-header-actions">{children}</div>}
    </header>
  );
}
