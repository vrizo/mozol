// Form controls and the confirm dialog, styled by the design system.
import {
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  useEffect,
  useId,
  useRef,
} from "react";
import { copy } from "../copy/en";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "link";
  busy?: boolean;
};

export function Button({
  variant = "secondary",
  busy,
  className,
  disabled,
  type,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type ?? "button"}
      className={`button button-${variant}${className ? ` ${className}` : ""}`}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...rest}
    >
      {children}
    </button>
  );
}

type FieldProps = { label: string; error?: string | null; hint?: ReactNode };

export function TextField({
  label,
  error,
  hint,
  multiline,
  ...rest
}: FieldProps & InputHTMLAttributes<HTMLInputElement> & { multiline?: boolean; rows?: number }) {
  const id = useId();
  const describedBy =
    [hint ? `${id}-hint` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {hint && (
        <p id={`${id}-hint`} className="field-hint">
          {hint}
        </p>
      )}
      {multiline ? (
        <textarea
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          {...(rest as unknown as React.TextareaHTMLAttributes<HTMLTextAreaElement>)}
        />
      ) : (
        <input id={id} aria-invalid={error ? true : undefined} aria-describedby={describedBy} {...rest} />
      )}
      {error && (
        <p id={`${id}-error`} className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}

export function Select({
  label,
  error,
  hint,
  options,
  ...rest
}: FieldProps & SelectHTMLAttributes<HTMLSelectElement> & { options: { value: string; label: string }[] }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {hint && <p className="field-hint">{hint}</p>}
      <select id={id} aria-invalid={error ? true : undefined} {...rest}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}

export function Checkbox({ label, ...rest }: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <div className="checkbox">
      <input id={id} type="checkbox" {...rest} />
      <label htmlFor={id}>{label}</label>
    </div>
  );
}

// A native modal dialog: open while `open` is true; Escape and Cancel call onCancel.
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  busy,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
    >
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          onConfirm();
        }}
      >
        <h2 id={titleId}>{title}</h2>
        {children}
        <div className="actions">
          <Button variant="danger" type="submit" busy={busy}>
            {confirmLabel}
          </Button>
          <Button onClick={onCancel}>{copy.common.cancel}</Button>
        </div>
      </form>
    </dialog>
  );
}
