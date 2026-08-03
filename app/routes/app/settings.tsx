import { Form, Link } from "react-router";
import type { Route } from "./+types/settings";
import { envContext } from "@worker/loadContext";
import { appMeta } from "~/seo";
import { getContext } from "@worker/context";
import { ROLES, rolesForScope } from "@domain/roles";
import { listPeople, displayName } from "@db/services/people";
import { newId } from "@domain/ids";
import { normalizeEmail, looksLikeEmail, issueToken } from "@worker/auth/crypto";
import { PageHeader, Card, Table, Th, Td, Chip, Button, Field, Input, Select, formatDate } from "~/ui";

export function meta(_: Route.MetaArgs) {
  return appMeta("Settings");
}

/**
 * The Rotary year runs July to June, and offices turn over with it. Defaulting
 * an end date to the coming 30 June is the difference between access that
 * expires on its own and a club where last year's treasurer still has the keys
 * in November.
 */
function endOfRotaryYear(today: string): string {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  return `${month >= 7 ? year + 1 : year}-06-30`;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = await getContext(request, context.get(envContext));
  ctx.require("settings.read");
  const db = ctx.db();

  const club = await db.first<{ id: string; name: string; slug: string }>("clubs", {
    columns: "id, name, slug",
  });
  if (!club) return { club: null, assignments: [], people: [], canAssign: false, defaultEnd: "" };

  const [assignments, page] = await Promise.all([
    db.raw<{
      id: string; role_key: string; starts_on: string | null; ends_on: string | null;
      first_name: string | null; last_name: string | null; email: string;
    }>(
      `SELECT r.id, r.role_key, r.starts_on, r.ends_on,
              p.first_name, p.last_name, u.email
         FROM role_assignments r
         JOIN users u ON u.id = r.user_id
         LEFT JOIN people p ON p.id = r.person_id AND p.tenant_id = {{tenant}}
        WHERE r.tenant_id = {{tenant}} AND r.scope_type = 'club' AND r.scope_id = ?
        ORDER BY r.created_at`,
      [club.id],
    ),
    listPeople(db, { role: "member", limit: 200 }),
  ]);

  return {
    club,
    today: ctx.today,
    defaultEnd: endOfRotaryYear(ctx.today),
    canAssign: ctx.can("roles.assign", club.id),
    people: page.people.map((p) => ({ id: p.id, name: displayName(p), email: p.email })),
    assignments: assignments.map((a) => ({
      id: a.id,
      roleKey: a.role_key,
      roleLabel: ROLES[a.role_key]?.label ?? a.role_key,
      blurb: ROLES[a.role_key]?.blurb ?? "",
      name: a.first_name ? `${a.first_name} ${a.last_name}` : a.email,
      email: a.email,
      startsOn: a.starts_on,
      endsOn: a.ends_on,
      expired: Boolean(a.ends_on && a.ends_on < ctx.today),
    })),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const ctx = await getContext(request, context.get(envContext));
  const db = ctx.db();
  const club = await db.first<{ id: string }>("clubs", { columns: "id" });
  if (!club) return { error: "This account has no club yet." };
  ctx.require("roles.assign", club.id);

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "remove") {
    await db.remove("role_assignments", String(form.get("assignmentId") ?? ""), ctx.now);
    return { ok: true };
  }

  const email = String(form.get("email") ?? "").trim();
  const roleKey = String(form.get("roleKey") ?? "");
  if (!looksLikeEmail(email)) return { error: "We need an email address to send the invitation to." };
  if (!ROLES[roleKey]) return { error: "Pick an office." };

  const emailNorm = normalizeEmail(email);
  const personId = String(form.get("personId") ?? "") || null;

  // Reuse the login if this address already has one — somebody who serves two
  // clubs should have one account, not two.
  let userId: string;
  const existing = await db.unsafeDb
    .prepare(`SELECT id FROM users WHERE email_norm = ?`)
    .bind(emailNorm)
    .first<{ id: string }>();

  if (existing) {
    userId = existing.id;
  } else {
    userId = newId("user");
    await db.unsafeDb
      .prepare(
        `INSERT INTO users (id, email, email_norm, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(userId, email, emailNorm, ctx.now, ctx.now)
      .run();
  }

  await db.unsafeDb
    .prepare(
      `INSERT INTO tenant_users (tenant_id, user_id, status, created_at)
       VALUES (?, ?, 'active', ?)
       ON CONFLICT (tenant_id, user_id) DO NOTHING`,
    )
    .bind(ctx.tenantId, userId, ctx.now)
    .run();

  await db.insert("role_assignments", {
    id: newId("role"),
    user_id: userId,
    person_id: personId,
    role_key: roleKey,
    scope_type: "club",
    scope_id: club.id,
    extra_caps: "",
    starts_on: String(form.get("startsOn") ?? "") || null,
    ends_on: String(form.get("endsOn") ?? "") || null,
    created_at: ctx.now,
    updated_at: ctx.now,
  });

  // The token is stored only as a hash — a leaked backup is not a leaked
  // mailbox. Mail goes out through the queue and degrades to the console.
  const { hash } = await issueToken();
  await db.insert("invites", {
    id: newId("invite"),
    club_id: club.id,
    email_norm: emailNorm,
    person_id: personId,
    role_key: roleKey,
    token_hash: hash,
    invited_by: ctx.user?.id ?? null,
    expires_at: new Date(Date.now() + 7 * 86400_000).toISOString(),
    created_at: ctx.now,
  });

  return { ok: true, invited: email };
}

export default function Settings({ loaderData, actionData }: Route.ComponentProps) {
  const { club, assignments, people, canAssign, defaultEnd } = loaderData;

  if (!club) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-10">
        <PageHeader title="Settings" />
        <p className="text-ink-600 dark:text-ink-400">This account isn't attached to a club.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <PageHeader
        title="Settings"
        subtitle={`${club.name} — who holds which office, and until when.`}
      />

      <Card className="mb-8">
        <h2 className="font-medium text-ink-900 dark:text-ink-100">Your public page</h2>
        <p className="mt-1 text-sm text-ink-600 dark:text-ink-400">
          Anyone can find the club here. It shows meetings, projects, officers and a form for
          visitors — never your roster.
        </p>
        <Link
          to={`/club/${club.slug}`}
          className="mt-2 inline-block text-brand-600 hover:underline"
        >
          /club/{club.slug}
        </Link>
      </Card>

      {/* ── Officers ── */}
      <h2 className="pb-3 font-medium text-ink-900 dark:text-ink-100">Officers</h2>
      <p className="pb-4 text-sm text-pretty text-ink-600 dark:text-ink-400">
        Access ends on the date it says. The Rotary year runs to 30 June, so an office set to
        expire then simply stops working at the handover — nobody has to remember to take the
        keys back.
      </p>

      {assignments.length > 0 && (
        <Table>
          <thead>
            <tr>
              <Th>Who</Th>
              <Th>Office</Th>
              <Th>Until</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {assignments.map((a) => (
              <tr key={a.id}>
                <Td>
                  <span className="text-ink-900 dark:text-ink-100">{a.name}</span>
                  <div className="text-xs text-ink-500">{a.email}</div>
                </Td>
                <Td>
                  <span className="text-ink-800 dark:text-ink-200">{a.roleLabel}</span>
                  <div className="text-xs text-pretty text-ink-500">{a.blurb}</div>
                </Td>
                <Td>
                  {a.endsOn ? (
                    <span className={a.expired ? "text-ink-500 line-through" : "text-ink-700 dark:text-ink-300"}>
                      {formatDate(a.endsOn)}
                    </span>
                  ) : (
                    <span className="text-ink-500">open-ended</span>
                  )}
                  {a.expired && (
                    <div className="mt-0.5">
                      <Chip tone="neutral">term ended</Chip>
                    </div>
                  )}
                </Td>
                <Td>
                  {canAssign && (
                    <Form method="post">
                      <input type="hidden" name="intent" value="remove" />
                      <input type="hidden" name="assignmentId" value={a.id} />
                      <Button type="submit" variant="quiet">
                        Remove
                      </Button>
                    </Form>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      {canAssign && (
        <Card className="mt-6">
          <h3 className="font-medium text-ink-900 dark:text-ink-100">Give somebody an office</h3>
          <Form method="post" className="mt-4 space-y-4">
            <input type="hidden" name="intent" value="assign" />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Email" name="email" hint="We'll send them a link — no password to make up.">
                <Input id="email" name="email" type="email" required />
              </Field>
              <Field label="Office" name="roleKey">
                <Select id="roleKey" name="roleKey" defaultValue="club_secretary">
                  {rolesForScope("club").map((r) => (
                    <option key={r.key} value={r.key}>
                      {r.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Which member is this?" name="personId" hint="Optional — links the office to their record.">
                <Select id="personId" name="personId" defaultValue="">
                  <option value="">Not on the roster yet</option>
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label="Until"
                name="endsOn"
                hint="Defaults to the end of the Rotary year."
              >
                <Input id="endsOn" name="endsOn" type="date" defaultValue={defaultEnd} />
              </Field>
            </div>

            {actionData && "error" in actionData && actionData.error && (
              <p className="text-sm text-risk-500">{actionData.error}</p>
            )}
            {actionData && "invited" in actionData && actionData.invited && (
              <p className="text-sm text-steady-500">
                Invited {actionData.invited}. They'll get a link to sign in.
              </p>
            )}

            <Button type="submit">Send the invitation</Button>
          </Form>
        </Card>
      )}
    </div>
  );
}
