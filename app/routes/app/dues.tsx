import { Form, Link, redirect, useSearchParams } from "react-router";
import type { Route } from "./+types/dues";
import { envContext } from "@worker/loadContext";
import { appMeta } from "~/seo";
import { getContext, requireNotDemo } from "@worker/context";
import {
  listInvoices, listPeriods, summarise, billPeriod, recordPayment, waiveInvoice,
  suggestPeriodLabel, INVOICE_STATUS_LABELS, PAYMENT_METHOD_LABELS,
  type InvoiceStatus, type PaymentMethod,
} from "@db/services/dues";
import { capability, checkoutInvoice, PaymentUnavailable } from "@db/services/payments";
import { duesReminder } from "@emails/templates";
import { sendEmail } from "@emails/send";
import { issueUnsubscribeToken } from "@emails/unsubscribe";
import {
  PageHeader, Card, Table, Th, Td, Chip, Empty, Button, Field, Input, Select,
  formatDate, money,
} from "~/ui";

export function meta(_: Route.MetaArgs) {
  return appMeta("Dues");
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = await getContext(request, context.get(envContext));
  ctx.require("dues.read");
  const db = ctx.db();

  const club = await db.first<{ id: string; name: string }>("clubs", { columns: "id, name" });
  if (!club) {
    return {
      club: null, invoices: [], periods: [], summary: null, canWrite: false,
      today: ctx.today, period: null, suggested: "",
      cardsAccepted: false, coverFeeDefault: true,
    };
  }

  const url = new URL(request.url);
  const periods = await listPeriods(db, club.id);
  const period = url.searchParams.get("period") || periods[0] || null;

  const [invoices, summary, payments] = await Promise.all([
    listInvoices(db, club.id, { period: period ?? undefined }),
    summarise(db, club.id, ctx.today, period ?? undefined),
    capability(ctx.env, db, club.id),
  ]);

  return {
    club,
    today: ctx.today,
    cardsAccepted: payments.clubReady && payments.duesOnline,
    coverFeeDefault: payments.coverFeeDefault,
    period,
    periods,
    suggested: suggestPeriodLabel(ctx.today),
    summary,
    canWrite: ctx.can("dues.write", club.id),
    invoices: invoices.map((i) => ({
      id: i.id,
      personId: i.person_id,
      name: `${i.preferred_name || i.first_name} ${i.last_name}`,
      amountCents: i.amount_cents,
      paidCents: i.paid_cents,
      dueOn: i.due_on,
      email: i.email,
      periodLabel: i.period_label,
      status: i.status,
      overdue: Boolean(i.due_on && i.due_on < ctx.today && (i.status === "open" || i.status === "partial")),
    })),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const ctx = await getContext(request, context.get(envContext));
  const db = ctx.db();
  const club = await db.first<{ id: string }>("clubs", { columns: "id" });
  if (!club) return { error: "This account has no club yet." };
  ctx.require("dues.write", club.id);

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "bill") {
    const label = String(form.get("periodLabel") ?? "").trim();
    const amount = Number(form.get("amount") ?? 0);
    if (!label) return { error: "Give the period a name — something like “2026–27 first half”." };
    if (!Number.isFinite(amount) || amount <= 0) return { error: "How much are the dues?" };

    const result = await billPeriod(
      db,
      {
        clubId: club.id,
        periodLabel: label,
        // Dollars in, cents stored. One conversion, one place.
        amountCents: Math.round(amount * 100),
        dueOn: String(form.get("dueOn") ?? "") || null,
        includeHonorary: form.get("includeHonorary") === "on",
      },
      ctx.now,
    );
    return { billed: result };
  }

  if (intent === "pay") {
    const amount = Number(form.get("amount") ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) return { error: "How much came in?" };
    const done = await recordPayment(
      db,
      {
        invoiceId: String(form.get("invoiceId") ?? ""),
        clubId: club.id,
        amountCents: Math.round(amount * 100),
        method: (String(form.get("method") ?? "manual") as PaymentMethod) || "manual",
        receivedOn: String(form.get("receivedOn") ?? ctx.today),
      },
      ctx.now,
      ctx.user?.id ?? null,
    );
    return done ? { ok: true } : { error: "That invoice isn't here any more." };
  }

  /**
   * Take a card payment at the desk.
   *
   * Redirects the treasurer straight to Stripe's own payment page, which is
   * exactly what's wanted when a member is standing there with a card at the
   * end of a meeting. Nothing is marked paid here — the webhook does that when
   * the money actually moves.
   */
  if (intent === "card" || intent === "email-link") {
    ctx.require("payments.write", club.id);
    requireNotDemo(ctx, "Taking a card payment");
    const invoiceId = String(form.get("invoiceId") ?? "");
    const clubRow = await db.byId<{ name: string }>("clubs", club.id, { columns: "name" });

    try {
      const checkout = await checkoutInvoice(
        ctx.env,
        db,
        {
          invoiceId,
          clubId: club.id,
          clubName: clubRow?.name ?? "the club",
          coverFee: form.get("coverFee") === "on",
          payerEmail: String(form.get("payerEmail") ?? "") || null,
        },
        ctx.now,
      );

      if (intent === "card") return redirect(checkout.url);

      const to = String(form.get("payerEmail") ?? "");
      if (!to) return { error: "That member has no email address on file." };

      const invoice = await db.byId<{ amount_cents: number; paid_cents: number; period_label: string }>(
        "dues_invoices",
        invoiceId,
        { columns: "amount_cents, paid_cents, period_label" },
      );
      const template = duesReminder({
        firstName: String(form.get("firstName") ?? "there"),
        clubName: clubRow?.name ?? "the club",
        amount: money((invoice?.amount_cents ?? 0) - (invoice?.paid_cents ?? 0)),
        periodLabel: invoice?.period_label ?? "",
        payUrl: checkout.url,
        unsubscribeToken: await issueUnsubscribeToken(db, to, ctx.now),
        appUrl: ctx.env.APP_URL,
      });
      await sendEmail(
        ctx.env,
        db,
        {
          to,
          subject: template.subject,
          text: template.text,
          clubId: club.id,
          personId: String(form.get("personId") ?? "") || null,
          templateKey: "duesReminder",
          // Transactional: a payment link the treasurer was asked for is not
          // marketing, and somebody who unsubscribed from the newsletter still
          // needs to be able to pay their dues.
          transactional: true,
        },
        ctx.now,
      );
      return { ok: true, emailed: to };
    } catch (err) {
      if (err instanceof PaymentUnavailable) return { error: err.message };
      throw err;
    }
  }

  if (intent === "waive") {
    await waiveInvoice(db, String(form.get("invoiceId") ?? ""), String(form.get("reason") ?? "") || null, ctx.now);
    return { ok: true };
  }

  return { error: "Nothing to do." };
}

export default function Dues({ loaderData, actionData }: Route.ComponentProps) {
  const {
    club, invoices, periods, period, summary, canWrite, today, suggested,
    cardsAccepted, coverFeeDefault,
  } = loaderData;
  const [params] = useSearchParams();

  if (!club || !summary) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-10">
        <Empty title="No club yet" body="This account isn't attached to a club." />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <PageHeader
        title="Dues"
        subtitle="What's been billed, what's come in, and who to have a quiet word with."
        action={
          periods.length > 1 ? (
            <Form method="get">
              <Select name="period" defaultValue={period ?? ""} aria-label="Period" onChange={(e) => e.currentTarget.form?.submit()}>
                {periods.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </Select>
            </Form>
          ) : undefined
        }
      />

      {actionData && "error" in actionData && actionData.error && (
        <p className="mb-6 rounded-lg bg-risk-500/10 px-4 py-3 text-sm text-risk-500">
          {actionData.error}
        </p>
      )}
      {actionData && "emailed" in actionData && actionData.emailed && (
        <p className="mb-6 rounded-lg bg-steady-500/12 px-4 py-3 text-sm text-steady-500">
          Sent a payment link to {actionData.emailed}.
        </p>
      )}
      {actionData && "billed" in actionData && actionData.billed && (
        <p className="mb-6 rounded-lg bg-steady-500/12 px-4 py-3 text-sm text-steady-500">
          Billed {actionData.billed.created}{" "}
          {actionData.billed.created === 1 ? "member" : "members"}
          {actionData.billed.skipped > 0 &&
            `. ${actionData.billed.skipped} already had an invoice for this period, so they were left alone.`}
        </p>
      )}

      {invoices.length > 0 && (
        <div className="grid grid-cols-2 gap-4 pb-8 sm:grid-cols-4">
          <Stat label="Billed" value={money(summary.billedCents)} />
          <Stat label="Come in" value={money(summary.collectedCents)} />
          <Stat label="Outstanding" value={money(summary.outstandingCents)} />
          <Stat
            label="Past due"
            value={summary.overdueCount}
            tone={summary.overdueCount > 0 ? "watch" : "neutral"}
          />
        </div>
      )}

      {invoices.length === 0 ? (
        <Empty
          title="Nothing billed yet"
          body="Bill the whole club for a period in one go. You can still record cash and cheques by hand afterwards — nothing here forces anyone to pay online."
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Member</Th>
              <Th>Amount</Th>
              <Th className="hidden sm:table-cell">Due</Th>
              <Th>Status</Th>
              {canWrite && <Th />}
            </tr>
          </thead>
          <tbody>
            {invoices.map((i) => (
              <tr key={i.id}>
                <Td>
                  <Link
                    to={`/app/people/${i.personId}`}
                    prefetch="intent"
                    className="-my-1.5 block py-1.5 text-ink-900 hover:text-brand-600 dark:text-ink-100"
                  >
                    {i.name}
                  </Link>
                </Td>
                <Td className="tabular-nums text-ink-700 dark:text-ink-300">
                  {money(i.amountCents)}
                  {i.paidCents > 0 && i.paidCents < i.amountCents && (
                    <span className="text-xs text-ink-500"> · {money(i.paidCents)} in</span>
                  )}
                </Td>
                <Td className="hidden text-ink-600 sm:table-cell dark:text-ink-400">
                  {formatDate(i.dueOn)}
                </Td>
                <Td>
                  <Chip
                    tone={
                      i.status === "paid" ? "steady"
                        : i.status === "waived" ? "neutral"
                        : i.overdue ? "watch"
                        : "neutral"
                    }
                  >
                    {INVOICE_STATUS_LABELS[i.status as InvoiceStatus]}
                  </Chip>
                </Td>
                {canWrite && (
                  <Td>
                    {(i.status === "open" || i.status === "partial") && (
                      <details>
                        <summary className="-my-2 cursor-pointer py-2 text-sm text-ink-500 hover:text-ink-700">
                          Record
                        </summary>
                        <div className="mt-2 space-y-3">
                          <Form method="post" className="flex flex-wrap items-end gap-2">
                            <input type="hidden" name="intent" value="pay" />
                            <input type="hidden" name="invoiceId" value={i.id} />
                            <Input
                              name="amount"
                              type="number"
                              step="0.01"
                              min="0"
                              defaultValue={((i.amountCents - i.paidCents) / 100).toFixed(2)}
                              aria-label="Amount"
                              className="w-24"
                            />
                            <Select name="method" defaultValue="check" aria-label="How" className="w-auto">
                              {(Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[])
                                .filter((m) => m !== "stripe")
                                .map((m) => (
                                  <option key={m} value={m}>
                                    {PAYMENT_METHOD_LABELS[m]}
                                  </option>
                                ))}
                            </Select>
                            <Input name="receivedOn" type="date" defaultValue={today} aria-label="When" className="w-36" />
                            <Button type="submit" variant="secondary">
                              Paid
                            </Button>
                          </Form>
                          {cardsAccepted && (
                            <div className="flex flex-wrap items-end gap-2">
                              {/* Straight to Stripe — the case this is for is a
                                  member standing at the desk with a card at the
                                  end of a meeting. */}
                              <Form method="post" className="flex items-end gap-2">
                                <input type="hidden" name="intent" value="card" />
                                <input type="hidden" name="invoiceId" value={i.id} />
                                <input type="hidden" name="payerEmail" value={i.email ?? ""} />
                                {coverFeeDefault && <input type="hidden" name="coverFee" value="on" />}
                                <Button type="submit" variant="secondary">
                                  Take a card
                                </Button>
                              </Form>
                              {i.email && (
                                <Form method="post" className="flex items-end gap-2">
                                  <input type="hidden" name="intent" value="email-link" />
                                  <input type="hidden" name="invoiceId" value={i.id} />
                                  <input type="hidden" name="payerEmail" value={i.email} />
                                  <input type="hidden" name="personId" value={i.personId} />
                                  <input type="hidden" name="firstName" value={i.name.split(" ")[0] ?? ""} />
                                  {coverFeeDefault && <input type="hidden" name="coverFee" value="on" />}
                                  <Button type="submit" variant="quiet">
                                    Email a payment link
                                  </Button>
                                </Form>
                              )}
                            </div>
                          )}
                          {/* Waiving is a first-class action, not something a
                              treasurer fakes by marking it paid. A club that
                              quietly covers someone's dues should be able to
                              record that honestly. */}
                          <Form method="post" className="flex flex-wrap items-end gap-2">
                            <input type="hidden" name="intent" value="waive" />
                            <input type="hidden" name="invoiceId" value={i.id} />
                            <Input name="reason" placeholder="Why, for the record" aria-label="Reason" className="w-56" />
                            <Button type="submit" variant="quiet">
                              Waive
                            </Button>
                          </Form>
                        </div>
                      </details>
                    )}
                  </Td>
                )}
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      {summary.overdueCount > 0 && (
        <Card className="mt-8">
          <h2 className="font-medium text-ink-900 dark:text-ink-100">
            {summary.overdueCount} past due
          </h2>
          {/* The most useful sentence on this page. */}
          <p className="mt-1.5 text-pretty text-ink-600 dark:text-ink-400">
            Worth a call rather than another reminder. Unpaid dues are usually about something
            else — somebody drifting away stops paying before they resign, and a club that
            hounds a member for a hundred and fifty pounds and loses them has made a bad trade.
          </p>
        </Card>
      )}

      {canWrite && (
        <Card className="mt-8">
          <h2 className="font-medium text-ink-900 dark:text-ink-100">Bill a period</h2>
          <p className="mt-1 text-sm text-ink-600 dark:text-ink-400">
            Creates an invoice for every current member. Safe to run twice — anyone already
            invoiced for the period is left alone.
          </p>
          <Form method="post" className="mt-4 space-y-4">
            <input type="hidden" name="intent" value="bill" />
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Period" name="periodLabel">
                <Input id="periodLabel" name="periodLabel" required defaultValue={suggested} />
              </Field>
              <Field label="Amount each" name="amount" hint="In dollars.">
                <Input id="amount" name="amount" type="number" step="0.01" min="0" required />
              </Field>
              <Field label="Due by" name="dueOn">
                <Input id="dueOn" name="dueOn" type="date" />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm text-ink-600 dark:text-ink-400">
              <input type="checkbox" name="includeHonorary" className="rounded border-ink-300" />
              Include honorary members
            </label>
            <Button type="submit">Create the invoices</Button>
          </Form>
        </Card>
      )}
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
  tone?: "neutral" | "watch";
}) {
  return (
    <div className="rounded-xl border border-ink-200 px-4 py-3 dark:border-ink-800">
      <div
        className={`text-2xl font-semibold tabular-nums ${tone === "watch" ? "text-watch-500" : "text-ink-900 dark:text-ink-100"}`}
      >
        {value}
      </div>
      <div className="mt-0.5 text-xs text-ink-500">{label}</div>
    </div>
  );
}
