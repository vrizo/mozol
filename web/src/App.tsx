import { copy } from "./copy/en";
import { Home } from "./home/Home";

export function App() {
  return (
    <>
      <a className="skip-link" href="#main-content">
        {copy.skipLink}
      </a>
      <Home />
    </>
  );
}
