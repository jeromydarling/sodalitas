import { Link, NavLink, Outlet } from "react-router";
import { brand } from "@content/brand";

const NAV = [
  { to: "/retention", label: "Keeping members" },
  { to: "/compare", label: "Compare" },
  { to: "/pricing", label: "Pricing" },
];

export default function MarketingLayout() {
  return (
    <div className="flex min-h-svh flex-col bg-ink-50 dark:bg-ink-950">
      <header className="border-b border-ink-200 dark:border-ink-800">
        <nav className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-6 py-4">
          <Link to="/" className="flex items-baseline gap-2" prefetch="intent">
            <span className="text-lg font-semibold tracking-tight text-ink-900 dark:text-ink-50">
              {brand.name}
            </span>
            <span className="hidden text-xs text-ink-400 sm:inline">for Rotary &amp; Rotaract</span>
          </Link>

          <div className="flex items-center gap-6 text-sm">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                prefetch="intent"
                className={({ isActive }) =>
                  isActive
                    ? "hidden font-medium text-ink-900 sm:inline dark:text-ink-100"
                    : "hidden text-ink-600 hover:text-ink-900 sm:inline dark:text-ink-300 dark:hover:text-ink-100"
                }
              >
                {item.label}
              </NavLink>
            ))}
            <Link
              to="/login"
              prefetch="intent"
              className="rounded-lg bg-brand-600 px-3.5 py-2 font-medium text-white hover:bg-brand-700"
            >
              Sign in
            </Link>
          </div>
        </nav>
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      <footer className="border-t border-ink-200 dark:border-ink-800">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-8 text-sm text-ink-500 sm:flex-row sm:items-center sm:justify-between">
          <p>
            {brand.name} — {brand.meaning}
          </p>
          <p className="text-ink-400">
            Not affiliated with or endorsed by Rotary International.
          </p>
        </div>
      </footer>
    </div>
  );
}
