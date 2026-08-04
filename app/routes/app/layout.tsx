import { Form, Link, NavLink, Outlet, redirect } from "react-router";
import type { Route } from "./+types/layout";
import { envContext } from "@worker/loadContext";
import { brand } from "@content/brand";
import { Logo, Icon } from "~/brand";
import { getContext } from "@worker/context";
import type { Capability } from "@domain/roles";

/**
 * Navigation, gated by capability.
 *
 * A link that 403s when clicked is worse than no link — it teaches people the
 * product is unreliable rather than that they lack permission. Each route's
 * loader enforces the same capability again; this only decides what to show.
 */
/**
 * `place` decides where a section appears on a wide screen.
 *
 * The row is a fixed-width budget of about eight labels, and it has now been
 * overspent twice — once by Website, once by Events and Documents together —
 * each time colliding with the user's name at 1280px. Demoting whichever item
 * seemed least important that week is not a fix, because the next section will
 * do it again.
 *
 * So the tail goes behind a "More" menu that grows instead of the row. The
 * split is by how often somebody opens the thing, not by how important it is:
 * a club's committees matter enormously and get visited twice a year.
 *
 * Below lg none of this applies — the burger holds every section in order.
 */
type Place = "row" | "more" | "account";

const NAV: { to: string; label: string; end: boolean; needs?: Capability; place: Place }[] = [
  { to: "/app", label: "This week", end: true, place: "row" },
  { to: "/app/people", label: "People", end: false, needs: "people.read", place: "row" },
  { to: "/app/membership", label: "Membership", end: false, needs: "membership.read", place: "row" },
  { to: "/app/meetings", label: "Meetings", end: false, needs: "meetings.read", place: "row" },
  { to: "/app/events", label: "Events", end: false, needs: "events.read", place: "row" },
  { to: "/app/documents", label: "Documents", end: false, needs: "documents.read", place: "row" },
  { to: "/app/tasks", label: "Tasks", end: false, needs: "tasks.read_all", place: "row" },
  { to: "/app/dues", label: "Dues", end: false, needs: "dues.read", place: "row" },

  { to: "/app/committees", label: "Committees", end: false, needs: "committees.read", place: "more" },
  { to: "/app/projects", label: "Projects", end: false, needs: "projects.read", place: "more" },
  { to: "/app/site", label: "Website", end: false, needs: "site.edit", place: "more" },
  { to: "/app/communio", label: "Communio", end: false, needs: "communio.read", place: "more" },
  { to: "/app/district", label: "District", end: false, needs: "district.read", place: "more" },
  { to: "/app/import", label: "Import", end: false, needs: "import.run", place: "more" },

  // Account rather than "More": it is about this person, not about the club.
  { to: "/app/settings", label: "Settings", end: false, needs: "settings.read", place: "account" },
];

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = await getContext(request, context.get(envContext));
  if (!ctx.user) {
    const url = new URL(request.url);
    return redirect(`/login?redirectTo=${encodeURIComponent(url.pathname + url.search)}`);
  }

  return {
    isDemo: ctx.isDemo,
    user: { name: ctx.user.displayName ?? ctx.user.email, email: ctx.user.email },
    // Titles are what a Rotarian recognises, and they're also the clearest
    // answer to "why can't I see that?" — you can see what you hold.
    titles: ctx.authority.titles.map((t) => t.label),
    nav: NAV.filter((item) => !item.needs || ctx.can(item.needs)).map(
      ({ to, label, end, place }) => ({ to, label, end, place }),
    ),
  };
}

export default function AppLayout({ loaderData }: Route.ComponentProps) {
  return (
    <div className="flex min-h-svh flex-col bg-ink-50 dark:bg-ink-950">
      {/* Said at the top of every screen, because somebody who forgot they are
          in the demo and starts entering their real roster has been badly
          served by a subtle badge in a corner. */}
      {loaderData.isDemo && (
        <div className="bg-gold-500/15 px-6 py-2 text-center text-sm text-ink-800 dark:text-ink-200">
          <strong className="font-semibold">Demo club.</strong> Everything here is invented, and
          it all resets overnight. Break whatever you like —{" "}
          <Link to="/signup" className="font-medium text-brand-600 hover:underline">
            start a real club
          </Link>{" "}
          when you're ready.
        </div>
      )}
      <header className="border-b border-ink-200 bg-white/85 backdrop-blur-md dark:border-ink-800 dark:bg-ink-900/85">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-6">
            <Link
              to="/app"
              className="-m-2 flex shrink-0 items-center gap-2 p-2 font-semibold tracking-tight text-ink-900 dark:text-ink-50"
            >
              <Logo className="h-6 w-6" />
              <span className="hidden sm:inline">{brand.name}</span>
            </Link>
            {/* Wide screens get the row. Below lg it went into a clipped
                horizontal scroller with no affordance — "Meetings" rendered as
                "Me" and eight sections were unreachable on a phone. */}
            <nav className="hidden items-center gap-5 text-sm lg:flex" aria-label="Sections">
              {loaderData.nav
                .filter((item) => item.place === "row")
                .map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    prefetch="intent"
                    className={({ isActive }) =>
                      isActive
                        ? "shrink-0 font-medium text-ink-900 dark:text-ink-100"
                        : "shrink-0 text-ink-600 hover:text-ink-900 dark:text-ink-400 dark:hover:text-ink-100"
                    }
                  >
                    {item.label}
                  </NavLink>
                ))}

              {/* The overflow. A <details> so it opens before hydration, and
                  so the row's width stops being a thing that has to be
                  re-argued every time a section is added. */}
              {loaderData.nav.some((item) => item.place === "more") && (
                <details className="group relative">
                  <summary className="flex shrink-0 cursor-pointer list-none items-center gap-1 text-ink-600 marker:content-none hover:text-ink-900 dark:text-ink-400 dark:hover:text-ink-100 [&::-webkit-details-marker]:hidden">
                    More
                    <span aria-hidden className="text-ink-400 transition group-open:rotate-180">
                      ⌄
                    </span>
                  </summary>
                  <div className="absolute left-0 z-50 mt-2 w-52 rounded-xl border border-ink-200 bg-white p-2 shadow-lg dark:border-ink-800 dark:bg-ink-900">
                    {loaderData.nav
                      .filter((item) => item.place === "more")
                      .map((item) => (
                        <NavLink
                          key={item.to}
                          to={item.to}
                          end={item.end}
                          className={({ isActive }) =>
                            `block rounded-lg px-3 py-2.5 ${
                              isActive
                                ? "bg-ink-100 font-medium text-ink-900 dark:bg-ink-800 dark:text-ink-100"
                                : "text-ink-700 hover:bg-ink-50 dark:text-ink-300 dark:hover:bg-ink-800/60"
                            }`
                          }
                        >
                          {item.label}
                        </NavLink>
                      ))}
                  </div>
                </details>
              )}
            </nav>
          </div>

          <div className="flex shrink-0 items-center gap-3 text-sm">
            {/* Account only: this person's settings and the way out. Club
                sections live in the row or behind "More". Below lg the burger
                to the right holds everything and this is hidden. */}
            <details className="group relative hidden lg:block">
              <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-2 py-1.5 text-right marker:content-none hover:bg-ink-100 dark:hover:bg-ink-800 [&::-webkit-details-marker]:hidden">
                <span className="min-w-0">
                  <span className="block max-w-40 truncate text-ink-800 dark:text-ink-200">
                    {loaderData.user.name}
                  </span>
                  {loaderData.titles.length > 0 && (
                    <span className="block max-w-40 truncate text-xs text-ink-500">
                      {loaderData.titles.join(" · ")}
                    </span>
                  )}
                </span>
                <span aria-hidden className="text-ink-400 transition group-open:rotate-180">
                  ⌄
                </span>
              </summary>
              <div className="absolute right-0 z-50 mt-2 w-56 rounded-xl border border-ink-200 bg-white p-2 shadow-lg dark:border-ink-800 dark:bg-ink-900">
                {loaderData.nav
                  .filter((item) => item.place === "account")
                  .map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.end}
                      className={({ isActive }) =>
                        `block rounded-lg px-3 py-2.5 ${
                          isActive
                            ? "bg-ink-100 font-medium text-ink-900 dark:bg-ink-800 dark:text-ink-100"
                            : "text-ink-700 hover:bg-ink-50 dark:text-ink-300 dark:hover:bg-ink-800/60"
                        }`
                      }
                    >
                      {item.label}
                    </NavLink>
                  ))}
                <Form method="post" action="/logout">
                  <button
                    type="submit"
                    className="w-full rounded-lg px-3 py-2.5 text-left text-ink-700 hover:bg-ink-50 dark:text-ink-300 dark:hover:bg-ink-800/60"
                  >
                    Sign out
                  </button>
                </Form>
              </div>
            </details>

            {/* Below lg, everything lives in here. A <details> works before
                hydration and with JavaScript off, which matters most on the
                phone a secretary is using at the door of a meeting. */}
            <details className="group relative lg:hidden">
              <summary
                className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg text-ink-700 marker:content-none hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-ink-800 [&::-webkit-details-marker]:hidden"
                aria-label="Menu"
              >
                <Icon.Menu className="group-open:hidden" />
                <Icon.Close className="hidden group-open:block" />
              </summary>
              <div className="absolute right-0 z-50 mt-2 w-64 rounded-xl border border-ink-200 bg-white p-2 shadow-lg dark:border-ink-800 dark:bg-ink-900">
                {/* Always shown now: the header's own name-and-title block
                    moved to lg and up, so between sm and lg this menu is the
                    only place it appears. */}
                <div className="border-b border-ink-200 px-3 pb-2 dark:border-ink-800">
                  <p className="truncate text-sm text-ink-800 dark:text-ink-200">
                    {loaderData.user.name}
                  </p>
                  {loaderData.titles.length > 0 && (
                    <p className="truncate text-xs text-ink-500">
                      {loaderData.titles.join(" · ")}
                    </p>
                  )}
                </div>
                <nav className="pt-1" aria-label="Sections">
                  {loaderData.nav.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.end}
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
                </nav>
                <div className="mt-1.5 border-t border-ink-200 pt-1.5 dark:border-ink-800">
                  <Form method="post" action="/logout">
                    <button
                      type="submit"
                      className="w-full rounded-lg px-3 py-2.5 text-left text-sm text-ink-600 hover:bg-ink-100 dark:text-ink-400 dark:hover:bg-ink-800"
                    >
                      Sign out
                    </button>
                  </Form>
                </div>
              </div>
            </details>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  );
}
