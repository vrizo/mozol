// A dropdown with a search field inside its list: typing filters the options, arrows and Enter pick one.
import { type FocusEvent, type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { copy } from "../copy/en";

type Option = { value: string; label: string };

// Options whose name starts with the query come first, then a word inside the name, then the code, then any match.
function rankMatches(options: Option[], query: string): Option[] {
  const q = query.trim().toLowerCase();
  if (!q) return options;
  const rank = (o: Option) => {
    const name = o.label.toLowerCase();
    if (name.startsWith(q)) return 0;
    if (name.split(/[\s(-]+/).some((word) => word.startsWith(q))) return 1;
    if (o.value.toLowerCase().startsWith(q)) return 2;
    if (name.includes(q)) return 3;
    return null;
  };
  return options
    .map((o) => ({ o, r: rank(o) }))
    .filter((m): m is { o: Option; r: number } => m.r !== null)
    .sort((a, b) => a.r - b.r)
    .map((m) => m.o);
}

export function ComboBox({
  label,
  hint,
  error,
  options,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  options: Option[];
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const listId = `${id}-list`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const selected = options.find((o) => o.value === value);
  const matches = useMemo(() => rankMatches(options, query), [options, query]);

  const show = () => {
    setQuery("");
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  };

  const close = (refocus: boolean) => {
    setOpen(false);
    setQuery("");
    if (refocus) triggerRef.current?.focus();
  };

  const pick = (option: Option) => {
    onChange(option.value);
    close(true);
  };

  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  const onTriggerKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      show();
    }
  };

  const onSearchKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => Math.min(Math.max(i + step, 0), matches.length - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const option = matches[active];
      if (option) pick(option);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close(true);
    } else if (e.key === "Tab") {
      close(false);
    }
  };

  const onBlur = (e: FocusEvent<HTMLDivElement>) => {
    if (open && !e.currentTarget.contains(e.relatedTarget)) close(false);
  };

  const describedBy =
    [hint ? `${id}-hint` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined;
  const activeOption = matches[active];

  return (
    <div className="field">
      <label id={`${id}-label`} htmlFor={id}>
        {label}
      </label>
      <div className="combobox" onBlur={onBlur}>
        <button
          ref={triggerRef}
          id={id}
          type="button"
          className="combobox-trigger"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          onClick={() => (open ? close(true) : show())}
          onKeyDown={onTriggerKeyDown}
        >
          {selected?.label ?? ""}
        </button>
        {open && (
          <div className="combobox-popup">
            <input
              ref={searchRef}
              className="combobox-search"
              type="search"
              role="combobox"
              autoComplete="off"
              spellCheck={false}
              placeholder={copy.common.search}
              aria-label={copy.common.search}
              aria-expanded
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={activeOption ? `${id}-${activeOption.value}` : undefined}
              value={query}
              onKeyDown={onSearchKeyDown}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
            />
            <ul ref={listRef} id={listId} className="combobox-list" role="listbox" aria-labelledby={`${id}-label`}>
              {matches.length === 0 ? (
                <li className="combobox-empty">{copy.common.noMatches}</li>
              ) : (
                matches.map((o, i) => (
                  <li
                    key={o.value}
                    id={`${id}-${o.value}`}
                    role="option"
                    data-index={i}
                    aria-selected={o.value === value}
                    className={i === active ? "is-active" : undefined}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseMove={() => setActive(i)}
                    onClick={() => pick(o)}
                  >
                    {o.label}
                  </li>
                ))
              )}
            </ul>
          </div>
        )}
      </div>
      {hint && (
        <p id={`${id}-hint`} className="field-hint">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}
