import { Form, Link } from "react-router";
import type { Route } from "./+types/committees";
import { envContext } from "@worker/loadContext";
import { appMeta } from "~/seo";
import { getContext } from "@worker/context";
import {
  listCommittees, listCommitteeMembers, createCommittee, addCommitteeMember,
  removeCommitteeMember, membersNotInvolved,
  SUGGESTED_COMMITTEES, COMMITTEE_ROLE_LABELS, type CommitteeRole,
} from "@db/services/work";
import { listPeople, displayName } from "@db/services/people";
import { PageHeader, Card, Chip, Empty, Button, Field, Input, Select, formatDate } from "~/ui";

export function meta(_: Route.MetaArgs) {
  return appMeta("Committees");
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = await getContext(request, context.get(envContext));
  ctx.require("committees.read");
  const db = ctx.db();

  const club = await db.first<{ id: string; name: string }>("clubs", { columns: "id, name" });
  if (!club) return { club: null, committees: [], people: [], uninvolved: [], canWrite: false };

  const committees = await listCommittees(db, club.id);

  const [rosters, page, uninvolved] = await Promise.all([
    Promise.all(committees.map((c) => listCommitteeMembers(db, c.id))),
    listPeople(db, { role: "member", clubId: club.id, limit: 300 }),
    membersNotInvolved(db, club.id, ctx.today, 12),
  ]);

  return {
    club,
    canWrite: ctx.can("committees.write", club.id),
    people: page.people.map((p) => ({ id: p.id, name: displayName(p) })),
    uninvolved: uninvolved.map((u) => ({
      id: u.person_id,
      name: `${u.first_name} ${u.last_name}`,
      joinedOn: u.joined_on,
    })),
    committees: committees.map((c, i) => ({
      id: c.id,
      name: c.name,
      purpose: c.purpose,
      chairName: c.chair_name,
      members: (rosters[i] ?? []).map((m) => ({
        id: m.id,
        personId: m.person_id,
        name: `${m.preferred_name || m.first_name} ${m.last_name}`,
        role: m.role,
      })),
    })),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const ctx = await getContext(request, context.get(envContext));
  const db = ctx.db();
  const club = await db.first<{ id: string }>("clubs", { columns: "id" });
  if (!club) return { error: "This account has no club yet." };
  ctx.require("committees.write", club.id);

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "create") {
    const name = String(form.get("name") ?? "").trim();
    if (!name) return { error: "What's the committee called?" };
    await createCommittee(
      db,
      { clubId: club.id, name, purpose: String(form.get("purpose") ?? "") || null },
      ctx.now,
    );
    return { ok: true };
  }

  // One click sets a club up with the committees it almost certainly already
  // has, rather than making somebody type six names.
  if (intent === "suggested") {
    for (const s of SUGGESTED_COMMITTEES) {
      await createCommittee(db, { clubId: club.id, name: s.name, purpose: s.purpose }, ctx.now);
    }
    return { ok: true, created: SUGGESTED_COMMITTEES.length };
  }

  if (intent === "add") {
    const added = await addCommitteeMember(
      db,
      {
        committeeId: String(form.get("committeeId") ?? ""),
        clubId: club.id,
        personId: String(form.get("personId") ?? ""),
        role: (String(form.get("role") ?? "member") as CommitteeRole) || "member",
      },
      ctx.now,
      ctx.user?.id ?? null,
    );
    return added ? { ok: true } : { error: "They're already on that committee." };
  }

  if (intent === "remove") {
    await removeCommitteeMember(db, String(form.get("memberId") ?? ""), ctx.now);
    return { ok: true };
  }

  return { error: "Nothing to do." };
}

export default function Committees({ loaderData, actionData }: Route.ComponentProps) {
  const { club, committees, people, uninvolved, canWrite } = loaderData;

  if (!club) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-10">
        <Empty title="No club yet" body="This account isn't attached to a club." />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <PageHeader
        title="Committees"
        subtitle="Members on a committee are far more likely to still be here next year. This is the lever you can actually pull."
      />

      {actionData && "error" in actionData && actionData.error && (
        <p className="mb-6 rounded-lg bg-risk-500/10 px-4 py-3 text-sm text-risk-500">
          {actionData.error}
        </p>
      )}

      {committees.length === 0 ? (
        <Empty
          title="No committees yet"
          body="Most clubs run roughly the same handful. We can set those up now and you can rename or remove any of them."
          action={
            canWrite ? (
              <Form method="post">
                <input type="hidden" name="intent" value="suggested" />
                <Button type="submit">Set up the usual {SUGGESTED_COMMITTEES.length}</Button>
              </Form>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-5">
          {committees.map((c) => (
            <Card key={c.id}>
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <div>
                  <h2 className="font-medium text-ink-900 dark:text-ink-100">{c.name}</h2>
                  {c.purpose && (
                    <p className="mt-0.5 text-sm text-pretty text-ink-600 dark:text-ink-400">
                      {c.purpose}
                    </p>
                  )}
                </div>
                <span className="text-sm text-ink-500">
                  {c.members.length} {c.members.length === 1 ? "person" : "people"}
                </span>
              </div>

              {c.members.length > 0 && (
                <ul className="mt-4 divide-y divide-ink-100 dark:divide-ink-800/60">
                  {c.members.map((m) => (
                    <li key={m.id} className="flex items-center justify-between gap-3 py-2">
                      <div className="flex items-center gap-2.5">
                        <Link
                          to={`/app/people/${m.personId}`}
                          prefetch="intent"
                          className="text-sm text-ink-800 hover:text-brand-600 dark:text-ink-200"
                        >
                          {m.name}
                        </Link>
                        {m.role !== "member" && (
                          <Chip tone="brand">{COMMITTEE_ROLE_LABELS[m.role]}</Chip>
                        )}
                      </div>
                      {canWrite && (
                        <Form method="post">
                          <input type="hidden" name="intent" value="remove" />
                          <input type="hidden" name="memberId" value={m.id} />
                          <Button type="submit" variant="quiet">
                            Remove
                          </Button>
                        </Form>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {canWrite && (
                <Form method="post" className="mt-4 flex flex-wrap items-end gap-3">
                  <input type="hidden" name="intent" value="add" />
                  <input type="hidden" name="committeeId" value={c.id} />
                  <div className="min-w-48 flex-1">
                    <Select name="personId" aria-label={`Add someone to ${c.name}`} required>
                      <option value="">Add someone…</option>
                      {people.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <Select name="role" defaultValue="member" aria-label="Role" className="w-auto">
                    {(Object.keys(COMMITTEE_ROLE_LABELS) as CommitteeRole[]).map((r) => (
                      <option key={r} value={r}>
                        {COMMITTEE_ROLE_LABELS[r]}
                      </option>
                    ))}
                  </Select>
                  <Button type="submit" variant="secondary">
                    Add
                  </Button>
                </Form>
              )}
            </Card>
          ))}
        </div>
      )}

      {/* ── Who to ask ── */}
      {canWrite && uninvolved.length > 0 && (
        <Card className="mt-8">
          <h2 className="font-medium text-ink-900 dark:text-ink-100">Who you could ask</h2>
          <p className="mt-1 text-sm text-pretty text-ink-600 dark:text-ink-400">
            These members aren't on a committee or a project. Longest-serving first — somebody
            who has been here twenty years and hasn't been asked in a decade is usually the
            easiest yes.
          </p>
          <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
            {uninvolved.map((u) => (
              <li key={u.id}>
                <Link
                  to={`/app/people/${u.id}`}
                  prefetch="intent"
                  className="text-ink-800 hover:text-brand-600 dark:text-ink-200"
                >
                  {u.name}
                </Link>
                {u.joinedOn && (
                  <span className="ml-1.5 text-xs text-ink-500">since {formatDate(u.joinedOn).slice(-4)}</span>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {canWrite && committees.length > 0 && (
        <Card className="mt-8">
          <h2 className="font-medium text-ink-900 dark:text-ink-100">Add a committee</h2>
          <Form method="post" className="mt-4 grid gap-3 sm:grid-cols-[1fr_2fr_auto]">
            <input type="hidden" name="intent" value="create" />
            <Field label="Name" name="name">
              <Input id="name" name="name" required />
            </Field>
            <Field label="What it's for" name="purpose">
              <Input id="purpose" name="purpose" />
            </Field>
            <div className="flex items-end">
              <Button type="submit" variant="secondary">
                Add
              </Button>
            </div>
          </Form>
        </Card>
      )}
    </div>
  );
}
