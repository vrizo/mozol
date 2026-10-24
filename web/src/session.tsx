// The signed-in user: loaded once from GET /api/me, shared through a context.

import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import type { User } from "shared";
import { ApiError, signOut as apiSignOut, getMe } from "./api";
import { copy } from "./copy/en";
import { navigate } from "./router";
import { ErrorState, Loading } from "./ui/states";

type Session =
  | { status: "loading"; user: null; error: null }
  | { status: "signed-in"; user: User; error: null }
  | { status: "signed-out"; user: null; error: null }
  | { status: "error"; user: null; error: unknown };

type SessionApi = Session & {
  refresh: () => Promise<void>;
  setUser: (user: User | null) => void;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<SessionApi | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session>({ status: "loading", user: null, error: null });

  const refresh = useCallback(async () => {
    try {
      setSession({ status: "signed-in", user: await getMe(), error: null });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setSession({ status: "signed-out", user: null, error: null });
      } else {
        setSession({ status: "error", user: null, error });
      }
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setUser = useCallback((user: User | null) => {
    setSession(
      user ? { status: "signed-in", user, error: null } : { status: "signed-out", user: null, error: null },
    );
  }, []);

  // A 401 means the session already ended on the worker, so the user is signed out either way.
  const signOut = useCallback(async () => {
    try {
      await apiSignOut();
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 401)) throw error;
    }
    setSession({ status: "signed-out", user: null, error: null });
  }, []);

  return (
    <SessionContext.Provider value={{ ...session, refresh, setUser, signOut }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionApi {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession outside SessionProvider");
  return session;
}

export function useUser(): User {
  const { user } = useSession();
  if (!user) throw new Error("useUser outside RequireUser");
  return user;
}

export function signInPath(): string {
  return `/signin?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
}

// Renders the page only for a signed-in user; a signed-out visitor goes to sign-in and comes back.
export function RequireUser({ children }: { children: ReactNode }) {
  const session = useSession();

  useEffect(() => {
    if (session.status === "signed-out") navigate(signInPath(), { replace: true });
  }, [session.status]);

  if (session.status === "error") {
    return (
      <main id="main-content" className="page" tabIndex={-1}>
        <ErrorState what={copy.states.session} error={session.error} onRetry={session.refresh} />
      </main>
    );
  }
  if (session.status !== "signed-in") {
    return (
      <main id="main-content" className="page" tabIndex={-1}>
        <Loading />
      </main>
    );
  }
  return children;
}
