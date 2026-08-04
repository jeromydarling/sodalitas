import { Form, Link, NavLink, Outlet, redirect } from "react-router";
import type { Route } from "./+types/layout";
import { envContext } from "@worker/loadContext";
import { brand } from "@content/brand";
import { getContext } from "@worker/context";
import type { Capability } from "@domain/roles";

/**
 * Navigation, gated by capability.
 *
 * A link that 403s when clicked is worse than no link — it teaches people the
 * product is unreliable rather than that they lack permission. Each route's
 * loader enforces the same capability again; this only decides what to show.
 */
const NAV: { to: string; label: string; end: boolean; needs?: Capability }[] = [
  { to: "/app", label: "This week", end: true },
  { to: "/app/people", label: "People", end: false, needs: "people.read" },
  { to: "/app/membership", label: "Membership", end: false, needs: "membership.read" },
  { to: "/app/meetings", label: "Meetings", end: false, needs: "meetings.read" },
  { to: "/app/committees", label: "Committees", end: false, needs: "committees.read" },
  { to: "/app/projects", label: "Projects", end: false, needs: "projects.read" },
  { to: "/app/tasks", label: "Tasks", end: false, needs: "tasks.read_all" },
  { to: "/app/dues", label: "Dues", end: false, needs: "dues.read" },
  { to: "/app/communio", label: "Communio", end: false, needs: "communio.read" },
  { to: "/app/district", label: "District", end: false, needs: "district.read" },
  { to: "/app/import", label: "Import", end: false, needs: "import.run" },
  { to: "/app/settings", label: "Settings", end: false, needs: "settings.read" },
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
    nav: NAV.filter((item) => !item.needs || ctx.can(item.needs)).map(({ to, label, end }) => ({
      to,
      label,
      end,
    })),
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
      <header className="border-b border-ink-200 bg-white dark:border-ink-800 dark:bg-ink-900">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-6 py-3">
          <div className="flex min-w-0 items-center gap-6">
            <Link
              to="/app"
              className="shrink-0 font-semibold tracking-tight text-ink-900 dark:text-ink-50"
            >
              {brand.name}
            </Link>
            <nav className="flex gap-5 overflow-x-auto text-sm">
              {loaderData.nav.map((item) => (
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
            </nav>
          </div>

          <div className="flex shrink-0 items-center gap-4 text-sm">
            <div className="hidden text-right sm:block">
              <p className="text-ink-800 dark:text-ink-200">{loaderData.user.name}</p>
              {loaderData.titles.length > 0 && (
                <p className="text-xs text-ink-500">{loaderData.titles.join(" · ")}</p>
              )}
            </div>
            <Form method="post" action="/logout">
              <button
                type="submit"
                className="text-ink-500 hover:text-ink-800 dark:hover:text-ink-200"
              >
                Sign out
              </button>
            </Form>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  );
}
