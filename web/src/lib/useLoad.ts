// Loads data for a key, reloads on retry, and lets a page change the loaded data after an action.
import { useCallback, useEffect, useState } from "react";

export type Load<T> =
  | { status: "loading" }
  | { status: "error"; error: unknown }
  | { status: "ready"; data: T };

// Loads data for the current key and reloads on retry; `set` changes the loaded data after an action.
export function useLoad<T>(load: () => Promise<T>, key: string) {
  const [state, setState] = useState<Load<T>>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reload when the key or the attempt changes
  useEffect(() => {
    let live = true;
    setState({ status: "loading" });
    load().then(
      (data) => live && setState({ status: "ready", data }),
      (error: unknown) => live && setState({ status: "error", error }),
    );
    return () => {
      live = false;
    };
  }, [key, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const set = useCallback((update: (data: T) => T) => {
    setState((s) => (s.status === "ready" ? { status: "ready", data: update(s.data) } : s));
  }, []);
  return { state, retry, set };
}
