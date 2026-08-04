import { Form, useSearchParams } from "react-router";
import type { Route } from "./+types/communio";
import { envContext } from "@worker/loadContext";
import { appMeta } from "~/seo";
import { getContext, requireNotDemo } from "@worker/context";
import {
  listGroups, createGroup, joinGroup, leaveGroup, shareSignal, listSharedSignals,
  listSpeakers, addSpeaker, listRequests, postRequest, postReply, listReplies,
  cohortSize, REQUEST_CATEGORIES, MIN_COHORT,
} from "@db/services/communio";
import { SHAREABLE_TYPES } from "@domain/communio";
import {
  PageHeader, Card, Chip, Empty, Button, Field, Input, Select, Textarea, formatDate,
} from "~/ui";

export function meta(_: Route.MetaArgs) {
  return appMeta("Communio");
}

/** The signal types a club would plausibly write by hand. */
const OFFERABLE = [
  { key: "attendance_trend", label: "Something about attendance" },
  { key: "membership_trend", label: "Something about membership" },
  { key: "project_completed", label: "A project that finished" },
  { key: "retention_win", label: "Something that worked" },
  { key: "club_milestone", label: "A milestone" },
] as const;

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = await getContext(request, context.get(envContext));
  ctx.require("communio.read");
  const env = context.get(envContext);
  const db = ctx.db();

  const [club, groups] = await Promise.all([
    db.first<{ id: string; name: string }>("clubs", { columns: "id, name" }),
    listGroups(db, env),
  ]);

  const url = new URL(request.url);
  const joined = groups.filter((g) => g.joined === 1);
  const activeId = url.searchParams.get("group") || joined[0]?.id || null;
  const active = groups.find((g) => g.id === activeId && g.joined === 1) ?? null;

  if (!active) {
    return { club, groups, active: null, signals: [], speakers: [], requests: [], canShare: false };
  }

  const [signals, speakers, requests, cohort] = await Promise.all([
    listSharedSignals(db, env, active.id),
    listSpeakers(db, env, active.id),
    listRequests(db, env, active.id),
    cohortSize(env, active.id),
  ]);

  const replies = await Promise.all(requests.map((r) => listReplies(env, r.id)));

  return {
    club,
    groups,
    active: { ...active, cohort_size: cohort },
    signals,
    speakers,
    requests: requests.map((r, i) => ({ ...r, replies: replies[i] ?? [] })),
    canShare: ctx.can("communio.share"),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const ctx = await getContext(request, context.get(envContext));
  const env = context.get(envContext);
  const db = ctx.db();
  const club = await db.first<{ id: string }>("clubs", { columns: "id" });

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const groupId = String(form.get("groupId") ?? "");

  /**
   * Reading Communio in the demo is the point; writing to it is not.
   *
   * Groups deliberately span tenants — that's the whole feature — so anything
   * posted from the demo would land in front of real clubs, written by whoever
   * happened to click the demo button. The sanitiser strips identifying detail
   * but it cannot strip intent.
   */
  requireNotDemo(ctx, "Posting to Communio");

  if (intent === "create") {
    ctx.require("communio.share");
    const name = String(form.get("name") ?? "").trim();
    if (!name) return { error: "What's the group called?" };
    await createGroup(
      db,
      {
        name,
        description: String(form.get("description") ?? "") || null,
        visibility: String(form.get("visibility") ?? "invite"),
        clubId: club?.id ?? null,
      },
      ctx.now,
    );
    return { ok: true };
  }

  if (intent === "join") {
    ctx.require("communio.read");
    await joinGroup(db, groupId, club?.id ?? null, "summary", ctx.now);
    return { ok: true };
  }

  if (intent === "leave") {
    ctx.require("communio.share");
    await leaveGroup(db, groupId, ctx.now);
    return { ok: true };
  }

  if (intent === "share") {
    ctx.require("communio.share");
    const result = await shareSignal(
      db,
      env,
      {
        groupId,
        clubId: club?.id ?? null,
        raw: {
          signalType: String(form.get("signalType") ?? "attendance_trend"),
          summary: String(form.get("summary") ?? ""),
        },
      },
      ctx.now,
    );
    // The sanitiser's reason goes straight back to the club. Being told
    // exactly why something wasn't shared is what makes the boundary feel
    // like a guard rather than a glitch.
    return result.ok ? { ok: true, shared: true } : { error: result.detail };
  }

  if (intent === "speaker") {
    ctx.require("communio.share");
    const name = String(form.get("name") ?? "").trim();
    const topic = String(form.get("topic") ?? "").trim();
    if (!name || !topic) return { error: "We need a name and what they speak about." };
    await addSpeaker(
      db,
      {
        groupId,
        clubId: club?.id ?? null,
        name,
        topic,
        bio: String(form.get("bio") ?? "") || null,
        contactEmail: String(form.get("contactEmail") ?? "") || null,
        travelRadius: String(form.get("travelRadius") ?? "") || null,
        feeNote: String(form.get("feeNote") ?? "") || null,
      },
      ctx.now,
    );
    return { ok: true };
  }

  if (intent === "ask") {
    ctx.require("communio.share");
    const title = String(form.get("title") ?? "").trim();
    const body = String(form.get("body") ?? "").trim();
    if (!title || !body) return { error: "Give it a title and say what you need." };
    await postRequest(
      db,
      { groupId, clubId: club?.id ?? null, category: String(form.get("category") ?? "advice"), title, body },
      ctx.now,
    );
    return { ok: true };
  }

  if (intent === "reply") {
    ctx.require("communio.share");
    const body = String(form.get("body") ?? "").trim();
    if (!body) return { error: "Write something first." };
    await postReply(db, { requestId: String(form.get("requestId") ?? ""), body }, ctx.now);
    return { ok: true };
  }

  return { error: "Nothing to do." };
}

export default function Communio({ loaderData, actionData }: Route.ComponentProps) {
  const { groups, active, signals, speakers, requests, canShare } = loaderData;
  const [params] = useSearchParams();
  const joined = groups.filter((g) => g.joined === 1);
  const open = groups.filter((g) => g.joined === 0);
  const tooSmall = active ? active.cohort_size < MIN_COHORT : false;

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <PageHeader
        title="Communio"
        subtitle="Swap what's working with other clubs, without anybody's roster leaving the building."
      />

      {actionData && "error" in actionData && actionData.error && (
        <Card className="mb-6 border-watch-500/40">
          <p className="text-pretty text-ink-800 dark:text-ink-200">{actionData.error}</p>
        </Card>
      )}
      {actionData && "shared" in actionData && actionData.shared && (
        <p className="mb-6 rounded-lg bg-steady-500/12 px-4 py-3 text-sm text-steady-500">
          Shared. It's stamped with the week rather than the moment, so nobody can work out
          which club posted it from the timing.
        </p>
      )}

      {joined.length === 0 ? (
        <>
          <Empty
            title="Not in a group yet"
            body={`Clubs in a group share short, anonymous notes about what's working — attendance recovering, a project that landed, a speaker worth booking. Nothing identifying ever leaves, and sharing only starts once ${MIN_COHORT} clubs have joined.`}
          />
          {open.length > 0 && (
            <div className="mt-6 space-y-3">
              {open.map((g) => (
                <Card key={g.id} className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-medium text-ink-900 dark:text-ink-100">{g.name}</p>
                    {g.description && (
                      <p className="text-sm text-ink-600 dark:text-ink-400">{g.description}</p>
                    )}
                    <p className="mt-0.5 text-xs text-ink-500">{g.cohort_size} clubs</p>
                  </div>
                  <Form method="post">
                    <input type="hidden" name="intent" value="join" />
                    <input type="hidden" name="groupId" value={g.id} />
                    <Button type="submit" variant="secondary">
                      Join
                    </Button>
                  </Form>
                </Card>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          {joined.length > 1 && (
            <Form method="get" className="pb-6">
              <Select name="group" defaultValue={active?.id ?? ""} aria-label="Group" onChange={(e) => e.currentTarget.form?.submit()}>
                {joined.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </Select>
            </Form>
          )}

          {active && (
            <>
              <div className="flex flex-wrap items-baseline justify-between gap-3 pb-6">
                <div>
                  <h2 className="text-lg font-medium text-ink-900 dark:text-ink-100">{active.name}</h2>
                  <p className="text-sm text-ink-500">
                    {active.cohort_size} {active.cohort_size === 1 ? "club" : "clubs"}
                  </p>
                </div>
                {canShare && (
                  <Form method="post">
                    <input type="hidden" name="intent" value="leave" />
                    <input type="hidden" name="groupId" value={active.id} />
                    <Button type="submit" variant="quiet">
                      Leave this group
                    </Button>
                  </Form>
                )}
              </div>

              {/* A group too small to anonymise says so, and says why. */}
              {tooSmall && (
                <Card className="mb-6 border-watch-500/40">
                  <p className="text-pretty text-ink-800 dark:text-ink-200">
                    Sharing starts once {MIN_COHORT} clubs have joined. Below that an anonymous
                    note isn't anonymous — with two clubs in a group, "a club reports rising
                    attendance" names the other one.
                  </p>
                </Card>
              )}

              {/* ── What clubs are saying ── */}
              <section className="pb-8">
                <h3 className="pb-3 text-sm font-medium tracking-wide text-ink-500 uppercase">
                  What clubs are saying
                </h3>
                {signals.length === 0 ? (
                  <p className="text-sm text-ink-500">Nothing shared yet this season.</p>
                ) : (
                  <ul className="space-y-2">
                    {signals.map((s) => (
                      <li
                        key={s.id}
                        className="rounded-lg border border-ink-200 px-4 py-3 dark:border-ink-800"
                      >
                        <p className="text-pretty text-ink-800 dark:text-ink-200">
                          {s.signal_summary}
                        </p>
                        <p className="mt-1 flex items-center gap-2 text-xs text-ink-500">
                          <span>week of {formatDate(s.week_start)}</span>
                          {s.mine === 1 && <Chip tone="brand">yours</Chip>}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}

                {canShare && !tooSmall && (
                  <Card className="mt-4">
                    <h4 className="text-sm font-medium text-ink-900 dark:text-ink-100">
                      Share something
                    </h4>
                    <p className="mt-1 text-sm text-pretty text-ink-600 dark:text-ink-400">
                      One sentence about what's happening. Leave names, numbers you'd not put on
                      a noticeboard, and anything with contact details out — we'll stop it
                      anyway and tell you why.
                    </p>
                    <Form method="post" className="mt-4 space-y-3">
                      <input type="hidden" name="intent" value="share" />
                      <input type="hidden" name="groupId" value={active.id} />
                      <Select name="signalType" defaultValue="attendance_trend" aria-label="What sort of thing">
                        {OFFERABLE.filter((o) => SHAREABLE_TYPES.has(o.key)).map((o) => (
                          <option key={o.key} value={o.key}>
                            {o.label}
                          </option>
                        ))}
                      </Select>
                      <Textarea
                        name="summary"
                        rows={2}
                        required
                        maxLength={400}
                        placeholder="Attendance is up ten points since we moved the meeting to Thursdays."
                      />
                      <Button type="submit" variant="secondary">
                        Share it
                      </Button>
                    </Form>
                  </Card>
                )}
              </section>

              {/* ── Speakers ── */}
              <section className="pb-8">
                <h3 className="pb-1 text-sm font-medium tracking-wide text-ink-500 uppercase">
                  Speakers worth booking
                </h3>
                <p className="pb-3 text-sm text-ink-600 dark:text-ink-400">
                  Vouched for by the club that added them. This one does carry a contact
                  address — that's the point of it.
                </p>
                {speakers.length === 0 ? (
                  <p className="text-sm text-ink-500">Nobody in the directory yet.</p>
                ) : (
                  <ul className="space-y-3">
                    {speakers.map((s) => (
                      <li key={s.id} className="rounded-lg border border-ink-200 px-4 py-3 dark:border-ink-800">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <p className="font-medium text-ink-900 dark:text-ink-100">{s.name}</p>
                          {s.mine === 1 && <Chip tone="brand">yours</Chip>}
                        </div>
                        <p className="text-sm text-ink-700 dark:text-ink-300">{s.topic}</p>
                        {s.bio && (
                          <p className="mt-1 text-sm text-pretty text-ink-600 dark:text-ink-400">{s.bio}</p>
                        )}
                        <p className="mt-1.5 flex flex-wrap gap-x-3 text-xs text-ink-500">
                          {s.contact_email && <span>{s.contact_email}</span>}
                          {s.travel_radius && <span>travels {s.travel_radius}</span>}
                          {s.fee_note && <span>{s.fee_note}</span>}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}

                {canShare && (
                  <details className="mt-4">
                    <summary className="cursor-pointer text-sm text-ink-500 hover:text-ink-700">
                      Add a speaker
                    </summary>
                    <Form method="post" className="mt-3 space-y-3">
                      <input type="hidden" name="intent" value="speaker" />
                      <input type="hidden" name="groupId" value={active.id} />
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="Name" name="speakerName">
                          <Input id="speakerName" name="name" required />
                        </Field>
                        <Field label="What they speak about" name="topic">
                          <Input id="topic" name="topic" required />
                        </Field>
                      </div>
                      <Field label="A line about them" name="bio">
                        <Input id="bio" name="bio" />
                      </Field>
                      <div className="grid gap-3 sm:grid-cols-3">
                        <Field label="How to reach them" name="contactEmail">
                          <Input id="contactEmail" name="contactEmail" type="email" />
                        </Field>
                        <Field label="How far they travel" name="travelRadius">
                          <Input id="travelRadius" name="travelRadius" placeholder="an hour or so" />
                        </Field>
                        <Field label="Fee" name="feeNote">
                          <Input id="feeNote" name="feeNote" placeholder="no charge" />
                        </Field>
                      </div>
                      <Button type="submit" variant="secondary">
                        Add them
                      </Button>
                    </Form>
                  </details>
                )}
              </section>

              {/* ── Asks ── */}
              <section>
                <h3 className="pb-3 text-sm font-medium tracking-wide text-ink-500 uppercase">
                  Asking for help
                </h3>
                {requests.length === 0 ? (
                  <p className="text-sm text-ink-500">Nobody's asked for anything lately.</p>
                ) : (
                  <ul className="space-y-3">
                    {requests.map((r) => (
                      <li key={r.id} className="rounded-lg border border-ink-200 px-4 py-3 dark:border-ink-800">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <p className="font-medium text-ink-900 dark:text-ink-100">{r.title}</p>
                          <Chip tone="neutral">
                            {REQUEST_CATEGORIES.find((c) => c.key === r.category)?.label ?? r.category}
                          </Chip>
                        </div>
                        <p className="mt-1 text-pretty text-ink-700 dark:text-ink-300">{r.body}</p>

                        {r.replies.length > 0 && (
                          <ul className="mt-3 space-y-2 border-l-2 border-ink-200 pl-3 dark:border-ink-800">
                            {r.replies.map((rep) => (
                              <li key={rep.id} className="text-sm text-pretty text-ink-600 dark:text-ink-400">
                                {rep.body}
                              </li>
                            ))}
                          </ul>
                        )}

                        {canShare && (
                          <Form method="post" className="mt-3 flex gap-2">
                            <input type="hidden" name="intent" value="reply" />
                            <input type="hidden" name="requestId" value={r.id} />
                            <Input name="body" placeholder="We could help with that…" className="flex-1" />
                            <Button type="submit" variant="quiet">
                              Reply
                            </Button>
                          </Form>
                        )}
                      </li>
                    ))}
                  </ul>
                )}

                {canShare && (
                  <details className="mt-4">
                    <summary className="cursor-pointer text-sm text-ink-500 hover:text-ink-700">
                      Ask for something
                    </summary>
                    <Form method="post" className="mt-3 space-y-3">
                      <input type="hidden" name="intent" value="ask" />
                      <input type="hidden" name="groupId" value={active.id} />
                      <div className="grid gap-3 sm:grid-cols-[auto_1fr]">
                        <Select name="category" defaultValue="advice" aria-label="What sort of ask" className="w-auto">
                          {REQUEST_CATEGORIES.map((c) => (
                            <option key={c.key} value={c.key}>
                              {c.label}
                            </option>
                          ))}
                        </Select>
                        <Input name="title" required placeholder="Speaker for a September meeting?" />
                      </div>
                      <Textarea name="body" rows={2} required placeholder="Anything on the environment would suit us." />
                      <Button type="submit" variant="secondary">
                        Post it
                      </Button>
                    </Form>
                  </details>
                )}
              </section>
            </>
          )}
        </>
      )}

      {canShare && (
        <Card className="mt-10">
          <h2 className="font-medium text-ink-900 dark:text-ink-100">Start a group</h2>
          <p className="mt-1 text-sm text-pretty text-ink-600 dark:text-ink-400">
            Usually a district, sometimes a handful of clubs with something in common.
          </p>
          <Form method="post" className="mt-4 grid gap-3 sm:grid-cols-[1fr_2fr_auto]">
            <input type="hidden" name="intent" value="create" />
            <Field label="Name" name="name">
              <Input id="name" name="name" required placeholder="District 5950" />
            </Field>
            <Field label="What it's for" name="description">
              <Input id="description" name="description" />
            </Field>
            <div className="flex items-end">
              <Button type="submit" variant="secondary">
                Create
              </Button>
            </div>
          </Form>
        </Card>
      )}
    </div>
  );
}
