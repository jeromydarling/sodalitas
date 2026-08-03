import { Form, Link, NavLink, Outlet, redirect } from "react-router";
import type { Route } from "./+types/layout";
import { envContext } from "@worker/loadContext";
import { brand } from "@content/brand";
import { getContext } from "@worker/context";

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = await getContext(request, context.get(envContext));
  if (!ctx.user) {
    const url = new URL(request.url);
    return redirect(`/login?redirectTo=${encodeURIComponent(url.pathname + url.search)}`);
  }
  return {
    user: { name: ctx.user.displayName ?? ctx.user.email, email: ctx.user.email },
    titles: ctx.authority.titles.map((t) => t.label),
    hasTenant: ctx.tenantId !== null,
  };
}

const NAV = [
  { to: "/app", label: "This week", end: true },
  { to: "/app/people", label: "People", end: false },
  { to: "/app/membership", label: "Membership", end: false },
  { to: "/app/meetings", label: "Meetings", end: false },
  { to: "/app/tasks", label: "Tasks", end: false },
  { to: "/app/import", label: "Import", end: false },
];

export default function AppLayout({ loaderData }: Route.ComponentProps) {
  return (
    <div className="flex min-h-svh flex-col bg-ink-50 dark:bg-ink-950">
      <header className="border-b border-ink-200 bg-white dark:border-ink-800 dark:bg-ink-900">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-6 py-3">
          <div className="flex items-center gap-6">
            <Link to="/app" className="font-semibold tracking-tight text-ink-900 dark:text-ink-50">
              {brand.name}
            </Link>
            <nav className="flex gap-5 overflow-x-auto text-sm">
              {NAV.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  prefetch="intent"
                  className={({ isActive }) =>
                    isActive
                      ? "font-medium text-ink-900 dark:text-ink-100"
                      : "text-ink-600 hover:text-ink-900 dark:text-ink-400"
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-4 text-sm">
            <div className="hidden text-right sm:block">
              <p className="text-ink-800 dark:text-ink-200">{loaderData.user.name}</p>
              {loaderData.titles.length > 0 && (
                <p className="text-xs text-ink-500">{loaderData.titles.join(" · ")}</p>
              )}
            </div>
            <Form method="post" action="/logout">
              <button type="submit" className="text-ink-500 hover:text-ink-800 dark:hover:text-ink-200">
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
