import { Link, NavLink, Outlet } from "react-router";
import { brand } from "@content/brand";
import { Logo, Icon } from "~/brand";

/**
 * The public shell.
 *
 * The header nav used to be `hidden sm:inline`, which meant that below 640px
 * the site had no navigation at all — every link gone, "Sign in" the only thing
 * left. On a phone that isn't a thin site, it's a broken one, and phones are
 * how a club president reads anything between meetings.
 *
 * The fix is a `<details>` disclosure rather than a React state toggle: it
 * works before hydration, works with JavaScript off, closes on Escape, and is
 * announced correctly by screen readers without a single aria attribute of our
 * own. There is no reason to reimplement that in useState.
 */

const NAV = [
  { to: "/features", label: "Features" },
  { to: "/retention", label: "Keeping members" },
  { to: "/guides", label: "Guides" },
  { to: "/compare", label: "Compare" },
  { to: "/pricing", label: "Pricing" },
];

const FOOTER: { heading: string; links: { to: string; label: string }[] }[] = [
  {
    heading: "Product",
    links: [
      { to: "/features", label: "Features" },
      { to: "/retention", label: "How retention works" },
      { to: "/integrations", label: "Integrations" },
      { to: "/pricing", label: "Pricing" },
      { to: "/demo", label: "See the demo club" },
    ],
  },
  {
    heading: "Deciding",
    links: [
      { to: "/compare", label: "Compare with ClubRunner & DACdb" },
      { to: "/guides", label: "Guides for officers" },
      { to: "/guides/what-clubs-pay", label: "What clubs actually pay" },
      { to: "/guides/moving-club-software", label: "Moving off another system" },
      { to: "/contact", label: "Ask a question" },
    ],
  },
  {
    heading: "About",
    links: [
      { to: "/about", label: "Why this exists" },
      { to: "/legal/privacy", label: "Privacy" },
      { to: "/legal/terms", label: "Terms" },
      { to: "/legal/ai-transparency", label: "How we use AI" },
    ],
  },
];

export default function MarketingLayout() {
  return (
    <div className="flex min-h-svh flex-col bg-ink-50 dark:bg-ink-950">
      <header className="sticky top-0 z-40 border-b border-ink-200/70 bg-ink-50/85 backdrop-blur-md dark:border-ink-800/70 dark:bg-ink-950/85">
        <nav className="mx-auto max-w-6xl px-6" aria-label="Main">
          <div className="flex items-center justify-between gap-6 py-3.5">
            <Link to="/" prefetch="intent" className="flex items-center gap-2.5">
              <Logo className="h-7 w-7 shrink-0" />
              <span className="text-lg font-semibold tracking-tight text-ink-900 dark:text-ink-50">
                {brand.name}
              </span>
              <span className="hidden text-xs text-ink-400 md:inline">
                for Rotary &amp; Rotaract
              </span>
            </Link>

            <div className="flex items-center gap-1">
              <div className="hidden items-center gap-1 lg:flex">
                {NAV.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    prefetch="intent"
                    className={({ isActive }) =>
                      `rounded-lg px-3 py-2 text-sm transition-colors ${
                        isActive
                          ? "font-medium text-ink-900 dark:text-ink-100"
                          : "text-ink-600 hover:bg-ink-200/50 hover:text-ink-900 dark:text-ink-300 dark:hover:bg-ink-800/50 dark:hover:text-ink-100"
                      }`
                    }
                  >
                    {item.label}
                  </NavLink>
                ))}
              </div>

              <Link
                to="/login"
                prefetch="intent"
                className="ml-1 rounded-lg px-3 py-2 text-sm text-ink-600 transition-colors hover:text-ink-900 dark:text-ink-300 dark:hover:text-ink-100"
              >
                Sign in
              </Link>
              <Link
                to="/signup"
                prefetch="intent"
                className="hidden rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700 sm:inline-block"
              >
                Start free
              </Link>

              {/* Below lg the links live in here. No JavaScript involved. */}
              <details className="group relative lg:hidden">
                <summary
                  className="flex cursor-pointer items-center rounded-lg p-2 text-ink-700 marker:content-none hover:bg-ink-200/50 dark:text-ink-300 dark:hover:bg-ink-800/50 [&::-webkit-details-marker]:hidden"
                  aria-label="Menu"
                >
                  <Icon.Menu className="group-open:hidden" />
                  <Icon.Close className="hidden group-open:block" />
                </summary>
                <div className="absolute right-0 z-50 mt-2 w-60 rounded-xl border border-ink-200 bg-white p-2 shadow-lg dark:border-ink-800 dark:bg-ink-900">
                  {NAV.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      className={({ isActive }) =>
                        `block rounded-lg px-3 py-2.5 text-sm ${
                          isActive
                            ? "bg-brand-500/10 font-medium text-brand-600"
                            : "text-ink-700 hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-ink-800"
                        }`
                      }
                    >
                      {item.label}
                    </NavLink>
                  ))}
                  <div className="my-1.5 h-px bg-ink-200 dark:bg-ink-800" />
                  <Link
                    to="/signup"
                    className="block rounded-lg bg-brand-600 px-3 py-2.5 text-center text-sm font-medium text-white"
                  >
                    Start free
                  </Link>
                </div>
              </details>
            </div>
          </div>
        </nav>
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      <footer className="mt-24 border-t border-ink-200 dark:border-ink-800">
        <div className="mx-auto max-w-6xl px-6 py-14">
          <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <Link to="/" className="flex items-center gap-2.5">
                <Logo className="h-7 w-7" />
                <span className="font-semibold tracking-tight text-ink-900 dark:text-ink-50">
                  {brand.name}
                </span>
              </Link>
              <p className="mt-3 text-sm text-pretty text-ink-500">{brand.meaning}</p>
            </div>

            {FOOTER.map((col) => (
              <div key={col.heading}>
                <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-500">
                  {col.heading}
                </h2>
                <ul className="mt-3 space-y-2">
                  {col.links.map((l) => (
                    <li key={l.to}>
                      <Link
                        to={l.to}
                        prefetch="intent"
                        className="text-sm text-ink-600 transition-colors hover:text-brand-600 dark:text-ink-400"
                      >
                        {l.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="mt-12 flex flex-col gap-3 border-t border-ink-200 pt-6 text-sm text-ink-500 sm:flex-row sm:items-center sm:justify-between dark:border-ink-800">
            <p>
              © {new Date().getUTCFullYear()} {brand.name}
            </p>
            {/* Stated on every page, not buried in the legal section. Clubs are
                careful about implied endorsement, and rightly so. */}
            <p className="text-ink-400">
              Not affiliated with, endorsed by, or sponsored by Rotary International.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
