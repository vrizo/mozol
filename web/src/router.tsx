// A small router: a route table with ":param" patterns, history navigation and a Link component.
import {
  type AnchorHTMLAttributes,
  createContext,
  type MouseEvent,
  useContext,
  useEffect,
  useState,
} from "react";

export const routes = [
  { name: "home", path: "/" },
  { name: "signup", path: "/signup" },
  { name: "signin", path: "/signin" },
  { name: "appSignin", path: "/app/signin" },
  { name: "activity", path: "/activity" },
  { name: "transcript", path: "/activity/:id" },
  { name: "patterns", path: "/patterns" },
  { name: "words", path: "/words" },
  { name: "sources", path: "/sources" },
  { name: "paste", path: "/sources/paste" },
  { name: "connection", path: "/sources/:id" },
  { name: "recommendation", path: "/r/:id" },
  { name: "recommendations", path: "/recommendations" },
  { name: "profile", path: "/profile" },
] as const;

export type RouteName = (typeof routes)[number]["name"] | "notFound";

export type Route = {
  name: RouteName;
  params: Record<string, string>;
  query: URLSearchParams;
};

export function matchPath(pathname: string): { name: RouteName; params: Record<string, string> } {
  const parts = pathname.replace(/\/+$/, "").split("/").slice(1);
  for (const route of routes) {
    const pattern = route.path.split("/").slice(1).filter(Boolean);
    if (pattern.length !== parts.filter(Boolean).length) continue;
    const params: Record<string, string> = {};
    const ok = pattern.every((segment, i) => {
      const part = parts[i] ?? "";
      if (segment.startsWith(":")) {
        params[segment.slice(1)] = decodeURIComponent(part);
        return part !== "";
      }
      return segment === part;
    });
    if (ok) return { name: route.name, params };
  }
  return { name: "notFound", params: {} };
}

function currentRoute(): Route {
  return { ...matchPath(window.location.pathname), query: new URLSearchParams(window.location.search) };
}

const RouteContext = createContext<Route | null>(null);

export function navigate(to: string, options: { replace?: boolean } = {}) {
  if (options.replace) window.history.replaceState(null, "", to);
  else window.history.pushState(null, "", to);
  window.dispatchEvent(new Event("mozol:navigate"));
}

// Changes the query of the current page without a new history entry for each filter change.
export function setQuery(changes: Record<string, string | undefined>) {
  const query = new URLSearchParams(window.location.search);
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined) query.delete(key);
    else query.set(key, value);
  }
  const search = query.toString();
  navigate(`${window.location.pathname}${search ? `?${search}` : ""}`, { replace: true });
}

export function RouterProvider({ children }: { children: React.ReactNode }) {
  const [route, setRoute] = useState(currentRoute);

  useEffect(() => {
    let lastPath = window.location.pathname;
    const update = () => {
      const samePage = window.location.pathname === lastPath;
      lastPath = window.location.pathname;
      setRoute(currentRoute());
      if (samePage) return;
      window.scrollTo(0, 0);
      requestAnimationFrame(() => document.getElementById("main-content")?.focus({ preventScroll: true }));
    };
    window.addEventListener("popstate", update);
    window.addEventListener("mozol:navigate", update);
    return () => {
      window.removeEventListener("popstate", update);
      window.removeEventListener("mozol:navigate", update);
    };
  }, []);

  return <RouteContext.Provider value={route}>{children}</RouteContext.Provider>;
}

export function useRoute(): Route {
  const route = useContext(RouteContext);
  if (!route) throw new Error("useRoute outside RouterProvider");
  return route;
}

export function Link({ href, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const handle = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (rest.target && rest.target !== "_self") return;
    event.preventDefault();
    navigate(href);
  };
  return <a href={href} onClick={handle} {...rest} />;
}

// Only a same-site path ("/x", never "//x" or "/\x") is a safe place to return to after sign-in.
export function safeNext(next: string | null, fallback = "/activity"): string {
  if (!next?.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}
