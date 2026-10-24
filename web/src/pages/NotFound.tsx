import { copy } from "../copy/en";
import { Link } from "../router";
import { PageHeader } from "../ui/states";

export function NotFoundPage() {
  return (
    <main id="main-content" className="page" tabIndex={-1}>
      <PageHeader title={copy.notFound.title} />
      <p>{copy.notFound.text}</p>
      <Link href="/">{copy.notFound.home}</Link>
    </main>
  );
}

// The same state inside a page, for an id that does not exist or belongs to another user.
export function NotFoundState() {
  return (
    <>
      <PageHeader title={copy.notFound.title} />
      <p>{copy.notFound.text}</p>
    </>
  );
}
