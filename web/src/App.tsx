import type { ReactNode } from "react";
import { copy } from "./copy/en";
import { Home } from "./home/Home";
import { Layout } from "./Layout";
import { TranscriptPage } from "./pages/activity";
import { AppSignInPage, SignInPage, SignUpPage } from "./pages/auth";
import { PatternsPage, WordsPage } from "./pages/knowledge";
import { NotFoundPage } from "./pages/NotFound";
import { ProfilePage } from "./pages/profile";
import { RecommendationPage, RecommendationsPage } from "./pages/recommendations";
import { ConnectionPage, PastePage, SourcesPage } from "./pages/sources";
import { type RouteName, RouterProvider, useRoute } from "./router";
import { RequireUser, SessionProvider } from "./session";

const pages: Record<RouteName, { page: () => ReactNode; user?: boolean }> = {
  home: { page: Home },
  signup: { page: SignUpPage },
  signin: { page: SignInPage },
  appSignin: { page: AppSignInPage },
  activity: { page: RecommendationsPage, user: true },
  transcript: { page: TranscriptPage, user: true },
  patterns: { page: PatternsPage, user: true },
  words: { page: WordsPage, user: true },
  sources: { page: SourcesPage, user: true },
  paste: { page: PastePage, user: true },
  connection: { page: ConnectionPage, user: true },
  recommendation: { page: RecommendationPage, user: true },
  recommendations: { page: RecommendationsPage, user: true },
  profile: { page: ProfilePage, user: true },
  notFound: { page: NotFoundPage },
};

function CurrentPage() {
  const route = useRoute();
  const { page: Page, user } = pages[route.name];
  if (route.name === "home") return <Page />;
  return <Layout>{user ? <RequireUser key={route.name}>{<Page />}</RequireUser> : <Page />}</Layout>;
}

export function App() {
  return (
    <RouterProvider>
      <SessionProvider>
        <a className="skip-link" href="#main-content">
          {copy.skipLink}
        </a>
        <CurrentPage />
      </SessionProvider>
    </RouterProvider>
  );
}
