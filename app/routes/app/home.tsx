import type { Route } from "./+types/home";
import { envContext } from "@worker/loadContext";
import { appMeta } from "~/seo";
import { WEEKLY_SIGNAL_CAP } from "@domain/signals";
import { getContext } from "@worker/context";

export function meta(_: Route.MetaArgs) {
  return appMeta("This week");
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = await getContext(request, context.get(envContext));
  if (!ctx.tenantId) {
    return { needsTenant: true as const, signals: [], clubName: null };
  }

  const db = ctx.db();
  // Independent reads, resolved together — never serialised in a loader.
  const [signals, clubs] = await Promise.all([
    db.all<{
      id: string; kind: string; severity: string; title: string;
      summary: string; suggested_action: string | null; evidence: string;
    }>("signals", {
      columns: "id, kind, severity, title, summary, suggested_action, evidence",
      where: "status = 'open'",
      orderBy: "created_at DESC",
      limit: WEEKLY_SIGNAL_CAP,
    }),
    db.all<{ name: string }>("clubs", { columns: "name", limit: 1 }),
  ]);

  return {
    needsTenant: false as const,
    signals,
    clubName: clubs[0]?.name ?? null,
  };
}

export default function AppHome({ loaderData }: Route.ComponentProps) {
  if (loaderData.needsTenant) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="text-2xl font-semibold text-ink-900 dark:text-ink-100">
          You're not in a club yet
        </h1>
        <p className="mt-3 text-pretty text-ink-600 dark:text-ink-400">
          Your account exists, but it isn't attached to a club or district. Whoever
          invited you can add you — or if you're setting the club up, start there.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-2xl font-semibold text-ink-900 dark:text-ink-100">This week</h1>
      <p className="mt-2 text-pretty text-ink-600 dark:text-ink-400">
        {loaderData.clubName
          ? `The few things worth doing at ${loaderData.clubName}.`
          : "The few things worth doing."}
      </p>

      {loaderData.signals.length === 0 ? (
        // An empty list is good news and should read like it, not like a
        // feature that hasn't loaded.
        <div className="mt-10 rounded-xl border border-ink-200 p-8 text-center dark:border-ink-800">
          <p className="font-medium text-ink-800 dark:text-ink-200">Nothing needs you this week.</p>
          <p className="mt-2 text-pretty text-ink-600 dark:text-ink-400">
            No guests waiting on a reply, nobody drifting. We'll say something the
            moment that changes.
          </p>
        </div>
      ) : (
        <ul className="mt-8 space-y-4">
          {loaderData.signals.map((s) => (
            <li
              key={s.id}
              className="rounded-xl border border-ink-200 bg-white p-5 dark:border-ink-800 dark:bg-ink-900"
            >
              <div className="flex items-start justify-between gap-4">
                <h2 className="font-medium text-ink-900 dark:text-ink-100">{s.title}</h2>
                <SeverityDot severity={s.severity} />
              </div>
              <p className="mt-1.5 text-pretty text-ink-600 dark:text-ink-400">{s.summary}</p>
              {s.suggested_action && (
                <p className="mt-3 text-sm text-pretty text-ink-700 dark:text-ink-300">
                  {s.suggested_action}
                </p>
              )}
              {/* Every signal can always answer "why am I seeing this?" */}
              <details className="mt-3">
                <summary className="cursor-pointer text-sm text-ink-500 hover:text-ink-700">
                  Why am I seeing this?
                </summary>
                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                  {Object.entries(safeParse(s.evidence)).map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="text-ink-500">{k.replace(/_/g, " ")}</dt>
                      <dd className="text-ink-700 dark:text-ink-300">{String(v ?? "—")}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SeverityDot({ severity }: { severity: string }) {
  const color =
    severity === "urgent" ? "bg-risk-500" : severity === "notice" ? "bg-watch-500" : "bg-ink-300";
  return (
    <span className="flex shrink-0 items-center gap-1.5 text-xs text-ink-500">
      <span aria-hidden className={`size-1.5 rounded-full ${color}`} />
      {severity}
    </span>
  );
}

function safeParse(json: string): Record<string, unknown> {
  try {
    const v = JSON.parse(json);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
