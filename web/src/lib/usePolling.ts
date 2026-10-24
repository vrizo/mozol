// Calls the callback every `ms` milliseconds while `enabled` is true and the page is visible.
import { useEffect, useRef } from "react";

export function usePolling(callback: () => void, ms: number, enabled: boolean) {
  const latest = useRef(callback);
  latest.current = callback;

  useEffect(() => {
    if (!enabled) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") latest.current();
    }, ms);
    return () => window.clearInterval(timer);
  }, [ms, enabled]);
}
