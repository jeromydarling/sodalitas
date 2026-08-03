import { Link } from "react-router";
import type { Route } from "./+types/district";
import { envContext } from "@worker/loadContext";
import { appMeta } from "~/seo";
import { getContext } from "@worker/context";
import { shiftDays } from "@db/services/membership";
import {
  PageHeader, Card, Table, Th, Td, Chip, Empty, toneFor, statusLabel, formatDate,
} from "~/ui";

export function meta(_: Route.MetaArgs) {
  return appMeta("District");
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = await getContext(request, context.get(envContext));
  ctx.require("district.read");
  const db = ctx.db();

  // Which clubs may this person see? A district governor sees all of them; an
  // assistant governor sees the ones assigned to them and no others. Reading
  // the whole district and filtering in the view would be the obvious mistake.
  const canSeeAll = ctx.can("district.write");
  const visibleClubIds = canSeeAll ? null : [...ctx.authority.readableClubs];

  if (visibleClubIds && visibleClubIds.length === 0) {
    return { clubs: [], totals: null, assignedOnly: true, asOf: null };
  }

  const clubFilter = visibleClubIds
    ? `AND c.id IN (${visibleClubIds.map(() => "?").join(",")})`
    : "";
  const clubParams = visibleClubIds ?? [];

  // The latest snapshot per club, plus this quarter's movement. One query
  // rather than one per club: a district with sixty clubs cannot be sixty
  // round trips on a page load.
  const rows = await db.raw<{
    club_id: string; name: string; city: string | null;
    score: number | null; status: string | null; as_of: string | null;
    member_count: number | null; net_change_90d: number | null;
    attendance_rate: number | null; active_prospects: number | null;
    open_signals: number;
  }>(
    `SELECT c.id AS club_id, c.name, c.city,
            h.score, h.status, h.as_of, h.member_count, h.net_change_90d,
            h.attendance_rate, h.active_prospects,
            (SELECT COUNT(*) FROM signals s
              WHERE s.tenant_id = {{tenant}} AND s.club_id = c.id AND s.status = 'open') AS open_signals
       FROM clubs c
       LEFT JOIN club_health_snapshots h
         ON h.club_id = c.id
        AND h.tenant_id = {{tenant}}
        AND h.as_of = (SELECT MAX(as_of) FROM club_health_snapshots
                        WHERE club_id = c.id AND tenant_id = {{tenant}})
      WHERE c.tenant_id = {{tenant}} AND c.status = 'active' ${clubFilter}
      ORDER BY
        CASE h.status WHEN 'at_risk' THEN 0 WHEN 'watch' THEN 1 ELSE 2 END,
        h.score,
        c.name`,
    clubParams,
  );

  const scored = rows.filter((r) => r.score !== null);
  const totals = {
    clubs: rows.length,
    members: rows.reduce((n, r) => n + (r.member_count ?? 0), 0),
    netChange: rows.reduce((n, r) => n + (r.net_change_90d ?? 0), 0),
    prospects: rows.reduce((n, r) => n + (r.active_prospects ?? 0), 0),
    atRisk: rows.filter((r) => r.status === "at_risk").length,
    watch: rows.filter((r) => r.status === "watch").length,
    // Averaged over clubs that have a snapshot, not over all clubs — a club
    // with no data would otherwise drag the district's number down for having
    // joined last week.
    unscored: rows.length - scored.length,
  };

  return {
    clubs: rows,
    totals,
    assignedOnly: !canSeeAll,
    asOf: rows.find((r) => r.as_of)?.as_of ?? null,
  };
}

export default function District({ loaderData }: Route.ComponentProps) {
  const { clubs, totals, assignedOnly, asOf } = loaderData;

  if (!totals || clubs.length === 0) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-10">
        <PageHeader title="District" />
        <Empty
          title={assignedOnly ? "No clubs assigned to you yet" : "No clubs in this district yet"}
          body={
            assignedOnly
              ? "An assistant governor sees the clubs they've been given. Ask the district governor to assign yours."
              : "Clubs appear here once they're added to the district."
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <PageHeader
        title="District"
        subtitle={
          assignedOnly
            ? "The clubs assigned to you. You can read them and leave a note — running them stays with their own officers."
            : "Every club, hardest first."
        }
      />

      <div className="grid grid-cols-2 gap-4 pb-8 sm:grid-cols-5">
        <Stat label="Clubs" value={totals.clubs} />
        <Stat label="Members" value={totals.members} />
        <Stat
          label="Net, 90 days"
          value={`${totals.netChange >= 0 ? "+" : ""}${totals.netChange}`}
          tone={totals.netChange < 0 ? "risk" : "steady"}
        />
        <Stat label="In conversation" value={totals.prospects} />
        <Stat label="Need attention" value={totals.atRisk} tone={totals.atRisk > 0 ? "risk" : "neutral"} />
      </div>

      <Table>
        <thead>
          <tr>
            <Th>Club</Th>
            <Th>How they're doing</Th>
            <Th className="hidden sm:table-cell">Members</Th>
            <Th className="hidden sm:table-cell">90 days</Th>
            <Th className="hidden md:table-cell">Attendance</Th>
            <Th>Open</Th>
          </tr>
        </thead>
        <tbody>
          {clubs.map((c) => (
            <tr key={c.club_id} className="hover:bg-ink-50 dark:hover:bg-ink-800/40">
              <Td>
                <span className="font-medium text-ink-900 dark:text-ink-100">{c.name}</span>
                {c.city && <div className="text-xs text-ink-500">{c.city}</div>}
              </Td>
              <Td>
                {c.status ? (
                  <Chip tone={toneFor(c.status)}>{statusLabel(c.status)}</Chip>
                ) : (
                  // Not "0" and not "at risk". A club with no snapshot hasn't
                  // been measured, which is a different thing from doing badly.
                  <span className="text-xs text-ink-500">not enough recorded yet</span>
                )}
              </Td>
              <Td className="hidden tabular-nums text-ink-700 sm:table-cell dark:text-ink-300">
                {c.member_count ?? "—"}
              </Td>
              <Td className="hidden tabular-nums sm:table-cell">
                {c.net_change_90d === null ? (
                  <span className="text-ink-500">—</span>
                ) : (
                  <span className={c.net_change_90d < 0 ? "text-risk-500" : "text-ink-700 dark:text-ink-300"}>
                    {c.net_change_90d >= 0 ? "+" : ""}
                    {c.net_change_90d}
                  </span>
                )}
              </Td>
              <Td className="hidden tabular-nums text-ink-700 md:table-cell dark:text-ink-300">
                {c.attendance_rate === null ? "—" : `${Math.round(c.attendance_rate * 100)}%`}
              </Td>
              <Td className="tabular-nums text-ink-600 dark:text-ink-400">{c.open_signals}</Td>
            </tr>
          ))}
        </tbody>
      </Table>

      {totals.unscored > 0 && (
        <p className="pt-4 text-sm text-ink-500">
          {totals.unscored} {totals.unscored === 1 ? "club hasn't" : "clubs haven't"} recorded
          enough yet to be scored. That's usually a club still getting set up, not a club in
          trouble.
        </p>
      )}

      {asOf && (
        <p className="pt-2 text-sm text-ink-500">
          Worked out overnight, as of {formatDate(asOf)}. The full method is on our site — it's
          rules over what your clubs record, not a model.
        </p>
      )}

      <Card className="mt-8">
        <h2 className="font-medium text-ink-900 dark:text-ink-100">What a district can and can't do</h2>
        <ul className="mt-3 space-y-1.5 text-sm text-ink-600 dark:text-ink-400">
          <li>You see club-level health, counts and trends across the district.</li>
          <li>Assistant governors read the clubs assigned to them, and can leave a task or a note.</li>
          <li>
            Personal notes a club writes about its own members stay in that club. Nothing on this
            page names a member.
          </li>
          <li>Neither a governor nor an assistant governor can run a club that hasn't asked them to.</li>
        </ul>
      </Card>
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string | number;
  tone?: "neutral" | "risk" | "steady";
}) {
  const colour =
    tone === "risk" ? "text-risk-500" : tone === "steady" ? "text-steady-500" : "text-ink-900 dark:text-ink-100";
  return (
    <div className="rounded-xl border border-ink-200 px-4 py-3 dark:border-ink-800">
      <div className={`text-2xl font-semibold tabular-nums ${colour}`}>{value}</div>
      <div className="mt-0.5 text-xs text-ink-500">{label}</div>
    </div>
  );
}
