// Site header with the wordmark and, for a signed-in user, the main navigation.
import { type ReactNode, useEffect, useState } from "react";
import { copy } from "./copy/en";
import { Link, navigate, type RouteName, useRoute } from "./router";
import { useSession } from "./session";

const navItems: { href: string; label: string; match: RouteName[] }[] = [
  { href: "/activity", label: copy.nav.activity, match: ["activity", "transcript"] },
  { href: "/patterns", label: copy.nav.patterns, match: ["patterns"] },
  { href: "/words", label: copy.nav.words, match: ["words"] },
  { href: "/sources", label: copy.nav.sources, match: ["sources", "paste", "connection"] },
  { href: "/recommendations", label: copy.nav.recommendations, match: ["recommendations", "recommendation"] },
  { href: "/profile", label: copy.nav.profile, match: ["profile"] },
];

export function Layout({ children }: { children: ReactNode }) {
  const session = useSession();
  const route = useRoute();
  const [open, setOpen] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: close the menu on every navigation
  useEffect(() => setOpen(false), [route]);

  const signOut = async () => {
    navigate("/");
    await session.signOut();
  };

  return (
    <>
      <header className="site-header">
        <div className="site-header-inner">
          <Link href={session.user ? "/activity" : "/"} className="wordmark" aria-label={copy.nav.homeLink}>
            <img src="/brand/mozol-wordmark.svg" alt="" height="18" />
          </Link>
          {session.user && (
            <>
              <button
                type="button"
                className="menu-button"
                aria-expanded={open}
                aria-controls="site-nav"
                onClick={() => setOpen(!open)}
              >
                {open ? copy.nav.closeMenu : copy.nav.menu}
              </button>
              <nav
                id="site-nav"
                className="site-nav"
                data-open={open || undefined}
                aria-label={copy.nav.label}
              >
                <ul>
                  {navItems.map((item) => (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={item.match.includes(route.name) ? "page" : undefined}
                      >
                        {item.label}
                      </Link>
                    </li>
                  ))}
                  <li>
                    <button type="button" className="nav-signout" onClick={signOut}>
                      {copy.nav.signOut}
                    </button>
                  </li>
                </ul>
              </nav>
            </>
          )}
        </div>
      </header>
      {children}
    </>
  );
}
