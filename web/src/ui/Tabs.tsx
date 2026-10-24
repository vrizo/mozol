// Tabs as links that keep the chosen value in the URL query.
import { Link, useRoute } from "../router";

export function Tabs<T extends string>({
  label,
  param,
  values,
  current,
  names,
}: {
  label: string;
  param: string;
  values: readonly T[];
  current: T;
  names: Record<T, string>;
}) {
  const route = useRoute();
  const href = (value: T) => {
    const query = new URLSearchParams(route.query);
    query.set(param, value);
    return `${window.location.pathname}?${query}`;
  };
  return (
    <nav aria-label={label}>
      <ul className="tabs">
        {values.map((value) => (
          <li key={value}>
            <Link href={href(value)} aria-current={value === current ? "page" : undefined}>
              {names[value]}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
