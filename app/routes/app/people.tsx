import { Form, Link, useSearchParams } from "react-router";
import type { Route } from "./+types/people";
import { envContext } from "@worker/loadContext";
import { appMeta } from "~/seo";
import { getContext } from "@worker/context";
import { listPeople, parseRoles, displayName, PERSON_ROLES, type PersonRole } from "@db/services/people";
import { STAGE_LABELS, type Stage } from "@db/services/membership";
import {
  PageHeader, Table, Th, Td, Chip, Empty, ButtonLink, Input, Select, Button, toneFor,
} from "~/ui";

export function meta(_: Route.MetaArgs) {
  return appMeta("People");
}

const ROLE_LABELS: Record<PersonRole, string> = {
  member: "Members",
  prospective_member: "Prospective members",
  guest: "Guests",
  alumni: "Former members",
  donor: "Donors",
  speaker: "Speakers",
  sponsor_contact: "Sponsor contacts",
  partner_contact: "Partner contacts",
  volunteer: "Volunteers",
};

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = await getContext(request, context.get(envContext));
  ctx.require("people.read");
  const db = ctx.db();

  const url = new URL(request.url);
  const search = url.searchParams.get("q")?.trim() || undefined;
  const role = (url.searchParams.get("role") as PersonRole) || undefined;
  const cursor = url.searchParams.get("cursor");

  const page = await listPeople(db, {
    search,
    role: role && (PERSON_ROLES as readonly string[]).includes(role) ? role : undefined,
    cursor,
    limit: 50,
  });

  // The stage each person sits at, for the people who have a membership. One
  // query for the page rather than one per row.
  const ids = page.people.map((p) => p.id);
  const stages = ids.length
    ? await db.raw<{ person_id: string; stage: string }>(
        `SELECT person_id, stage FROM memberships
          WHERE tenant_id = {{tenant}} AND person_id IN (${ids.map(() => "?").join(",")})`,
        ids,
      )
    : [];
  const stageByPerson = new Map(stages.map((s) => [s.person_id, s.stage]));

  return {
    people: page.people.map((p) => ({
      id: p.id,
      slug: p.slug,
      name: displayName(p),
      email: p.email,
      employer: p.employer,
      classification: p.classification,
      roles: parseRoles(p.roles),
      stage: stageByPerson.get(p.id) ?? null,
    })),
    nextCursor: page.nextCursor,
    search: search ?? "",
    role: role ?? "",
    canWrite: ctx.can("people.write"),
  };
}

export default function People({ loaderData }: Route.ComponentProps) {
  const [params] = useSearchParams();
  const { people, nextCursor, search, role, canWrite } = loaderData;
  const filtered = Boolean(search || role);

  const nextParams = new URLSearchParams(params);
  if (nextCursor) nextParams.set("cursor", nextCursor);

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <PageHeader
        title="People"
        subtitle="Everyone the club knows — members, guests, donors and the rest."
        action={canWrite ? <ButtonLink to="/app/people/new">Add someone</ButtonLink> : undefined}
      />

      {/* GET, so a filtered view is a shareable URL and the back button works. */}
      <Form method="get" className="flex flex-wrap items-end gap-3 pb-6">
        <div className="min-w-56 flex-1">
          <Input
            name="q"
            defaultValue={search}
            placeholder="Search by name, email or employer"
            aria-label="Search people"
          />
        </div>
        <Select name="role" defaultValue={role} aria-label="Filter by role" className="w-auto">
          <option value="">Everyone</option>
          {PERSON_ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </Select>
        <Button type="submit" variant="secondary">
          Search
        </Button>
        {filtered && (
          <Link to="/app/people" className="text-sm text-ink-500 hover:text-ink-800">
            Clear
          </Link>
        )}
      </Form>

      {people.length === 0 ? (
        filtered ? (
          <Empty
            title="Nobody matched that"
            body="Try a shorter search, or clear the filters to see everyone."
          />
        ) : (
          <Empty
            title="No people yet"
            body="Import your roster from a CSV — the importer shows you exactly what it will do before it changes anything."
            action={<ButtonLink to="/app/import">Import a roster</ButtonLink>}
          />
        )
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th className="hidden sm:table-cell">Classification</Th>
                <Th className="hidden md:table-cell">Employer</Th>
                <Th>Standing</Th>
              </tr>
            </thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.id} className="hover:bg-ink-50 dark:hover:bg-ink-800/40">
                  <Td>
                    <Link
                      to={`/app/people/${p.slug ?? p.id}`}
                      prefetch="intent"
                      className="font-medium text-ink-900 hover:text-brand-600 dark:text-ink-100"
                    >
                      {p.name}
                    </Link>
                    {p.email && <div className="text-xs text-ink-500">{p.email}</div>}
                  </Td>
                  <Td className="hidden text-ink-600 sm:table-cell dark:text-ink-400">
                    {p.classification ?? "—"}
                  </Td>
                  <Td className="hidden text-ink-600 md:table-cell dark:text-ink-400">
                    {p.employer ?? "—"}
                  </Td>
                  <Td>
                    {p.stage ? (
                      <Chip tone={p.stage === "at_risk" ? "risk" : p.stage === "active" ? "steady" : "neutral"}>
                        {STAGE_LABELS[p.stage as Stage] ?? p.stage}
                      </Chip>
                    ) : (
                      <span className="text-xs text-ink-500">
                        {p.roles.length > 0 ? ROLE_LABELS[p.roles[0]!] : "—"}
                      </span>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>

          {nextCursor && (
            <div className="pt-6 text-center">
              {/* Keyset, not page numbers: the cursor is where the last row
                  ended, so page 40 costs what page 1 costs. */}
              <ButtonLink to={`/app/people?${nextParams}`} variant="secondary">
                Show more
              </ButtonLink>
            </div>
          )}
        </>
      )}
    </div>
  );
}
