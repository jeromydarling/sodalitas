/**
 * dues.ts — invoicing, payments and receipts.
 *
 * Money is integer cents throughout. The only place dollars exist is the form
 * field a treasurer types into and the string a member reads.
 *
 * The tone matters more here than anywhere else in the product. Unpaid dues are
 * usually a symptom rather than a cause — somebody drifting away stops paying
 * before they resign — so nothing in this module chases, threatens or shames.
 * A club that hounds a member for $150 and loses them has made a bad trade.
 */

import type { TenantDb } from "../scope";
import { newId } from "@domain/ids";
import { logInteraction } from "./interactions";

export type InvoiceStatus = "open" | "paid" | "partial" | "waived" | "void";

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  open: "Unpaid",
  paid: "Paid",
  partial: "Part paid",
  waived: "Waived",
  void: "Cancelled",
};

export type PaymentMethod = "manual" | "stripe" | "check" | "cash";

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  manual: "Recorded by hand",
  stripe: "Card",
  check: "Cheque",
  cash: "Cash",
};

export interface InvoiceRow {
  id: string;
  club_id: string;
  person_id: string;
  membership_id: string | null;
  period_label: string;
  amount_cents: number;
  paid_cents: number;
  due_on: string | null;
  status: InvoiceStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface InvoiceWithPerson extends InvoiceRow {
  first_name: string;
  last_name: string;
  preferred_name: string | null;
  email: string | null;
}

export function listInvoices(
  db: TenantDb,
  clubId: string,
  opts: { period?: string; status?: InvoiceStatus } = {},
): Promise<InvoiceWithPerson[]> {
  const clauses = ["d.tenant_id = {{tenant}}", "d.club_id = ?"];
  const params: unknown[] = [clubId];
  if (opts.period) {
    clauses.push("d.period_label = ?");
    params.push(opts.period);
  }
  if (opts.status) {
    clauses.push("d.status = ?");
    params.push(opts.status);
  }

  return db.raw<InvoiceWithPerson>(
    `SELECT d.*, p.first_name, p.last_name, p.preferred_name, p.email
       FROM dues_invoices d
       JOIN people p ON p.id = d.person_id AND p.tenant_id = {{tenant}} AND p.deleted_at IS NULL
      WHERE ${clauses.join(" AND ")}
      ORDER BY
        CASE d.status WHEN 'open' THEN 0 WHEN 'partial' THEN 1 ELSE 2 END,
        d.due_on,
        p.last_name`,
    params,
  );
}

/** The billing periods this club has used, most recent first. */
export async function listPeriods(db: TenantDb, clubId: string): Promise<string[]> {
  const rows = await db.raw<{ period_label: string }>(
    `SELECT DISTINCT period_label FROM dues_invoices
      WHERE tenant_id = {{tenant}} AND club_id = ?
      ORDER BY period_label DESC LIMIT 12`,
    [clubId],
  );
  return rows.map((r) => r.period_label);
}

export interface DuesSummary {
  billedCents: number;
  collectedCents: number;
  outstandingCents: number;
  openCount: number;
  overdueCount: number;
  paidCount: number;
}

export async function summarise(
  db: TenantDb,
  clubId: string,
  today: string,
  period?: string,
): Promise<DuesSummary> {
  // Conditional aggregation over one scan — D1 caps a compound SELECT at five
  // terms, and this is six numbers.
  const clauses = ["tenant_id = {{tenant}}", "club_id = ?", "status != 'void'"];
  const params: unknown[] = [today, clubId];
  if (period) {
    clauses.push("period_label = ?");
    params.push(period);
  }

  const rows = await db.raw<{
    billed: number; collected: number; open_count: number;
    overdue_count: number; paid_count: number;
  }>(
    `SELECT
       COALESCE(SUM(amount_cents), 0) AS billed,
       COALESCE(SUM(paid_cents), 0) AS collected,
       SUM(CASE WHEN status IN ('open','partial') THEN 1 ELSE 0 END) AS open_count,
       SUM(CASE WHEN status IN ('open','partial') AND due_on < ? THEN 1 ELSE 0 END) AS overdue_count,
       SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) AS paid_count
     FROM dues_invoices
    WHERE ${clauses.join(" AND ")}`,
    params,
  );

  const r = rows[0];
  const billed = Number(r?.billed ?? 0);
  const collected = Number(r?.collected ?? 0);
  return {
    billedCents: billed,
    collectedCents: collected,
    outstandingCents: Math.max(0, billed - collected),
    openCount: Number(r?.open_count ?? 0),
    overdueCount: Number(r?.overdue_count ?? 0),
    paidCount: Number(r?.paid_count ?? 0),
  };
}

/**
 * Bill every current member for a period.
 *
 * Skips anyone already invoiced for it, so running it twice is safe — which
 * matters, because "did that work?" followed by a second click is exactly what
 * a treasurer does when a page is slow.
 *
 * Honorary members are skipped by default. Billing somebody the club made
 * honorary is a small insult that takes a while to undo.
 */
export async function billPeriod(
  db: TenantDb,
  input: {
    clubId: string;
    periodLabel: string;
    amountCents: number;
    dueOn: string | null;
    includeHonorary?: boolean;
  },
  now: string,
): Promise<{ created: number; skipped: number }> {
  const types = input.includeHonorary ? ["active", "honorary", "corporate"] : ["active", "corporate"];

  const members = await db.raw<{ membership_id: string; person_id: string }>(
    `SELECT m.id AS membership_id, m.person_id
       FROM memberships m
      WHERE m.tenant_id = {{tenant}} AND m.club_id = ?
        AND m.stage IN ('active','at_risk')
        AND m.membership_type IN (${types.map(() => "?").join(",")})`,
    [input.clubId, ...types],
  );

  const already = await db.raw<{ person_id: string }>(
    `SELECT person_id FROM dues_invoices
      WHERE tenant_id = {{tenant}} AND club_id = ? AND period_label = ? AND status != 'void'`,
    [input.clubId, input.periodLabel],
  );
  const billed = new Set(already.map((a) => a.person_id));

  const fresh = members.filter((m) => !billed.has(m.person_id));
  if (fresh.length === 0) return { created: 0, skipped: members.length };

  // Chunked: a 300-member club exceeds what D1 will take in one batch.
  const CHUNK = 100;
  for (let i = 0; i < fresh.length; i += CHUNK) {
    await db.insertMany(
      "dues_invoices",
      fresh.slice(i, i + CHUNK).map((m) => ({
        id: newId("invoice"),
        club_id: input.clubId,
        person_id: m.person_id,
        membership_id: m.membership_id,
        period_label: input.periodLabel,
        amount_cents: input.amountCents,
        paid_cents: 0,
        due_on: input.dueOn,
        status: "open",
        created_at: now,
        updated_at: now,
      })),
    );
  }

  return { created: fresh.length, skipped: members.length - fresh.length };
}

export interface RecordPaymentInput {
  invoiceId: string;
  clubId: string;
  amountCents: number;
  method: PaymentMethod;
  receivedOn: string;
  externalId?: string | null;
  feeCents?: number;
  coveredFee?: boolean;
  notes?: string | null;
}

/**
 * Record a payment against an invoice.
 *
 * Overpayment is allowed and lands the invoice on `paid` rather than erroring —
 * a member who rounds up to the nearest fifty is being generous, and refusing
 * their money because the arithmetic doesn't match is absurd.
 */
export async function recordPayment(
  db: TenantDb,
  input: RecordPaymentInput,
  now: string,
  actorUserId: string | null,
): Promise<{ ok: boolean; status: InvoiceStatus } | null> {
  const invoice = await db.byId<InvoiceRow>("dues_invoices", input.invoiceId);
  if (!invoice) return null;

  const paid = invoice.paid_cents + input.amountCents;
  const status: InvoiceStatus =
    paid >= invoice.amount_cents ? "paid" : paid > 0 ? "partial" : "open";

  await db.insert("payments", {
    id: newId("payment"),
    club_id: input.clubId,
    person_id: invoice.person_id,
    invoice_id: invoice.id,
    kind: "dues",
    amount_cents: input.amountCents,
    fee_cents: input.feeCents ?? 0,
    covered_fee: input.coveredFee ? 1 : 0,
    method: input.method,
    external_id: input.externalId ?? null,
    received_on: input.receivedOn,
    notes: input.notes ?? null,
    created_at: now,
  });

  await db.update("dues_invoices", invoice.id, {
    paid_cents: paid,
    status,
    updated_at: now,
  });

  await logInteraction(
    db,
    {
      clubId: input.clubId,
      personId: invoice.person_id,
      kind: "gift",
      subject: `Dues paid — ${invoice.period_label}`,
      refType: "dues_invoice",
      refId: invoice.id,
      actorUserId,
    },
    now,
  );

  return { ok: true, status };
}

/**
 * Waive an invoice.
 *
 * Kept as a first-class action rather than something a treasurer fakes by
 * marking it paid. A club that quietly covers somebody's dues should be able
 * to record that honestly, and the member should not appear in an arrears
 * report for a debt the club chose to forgive.
 */
export function waiveInvoice(
  db: TenantDb,
  invoiceId: string,
  reason: string | null,
  now: string,
): Promise<number> {
  return db.update("dues_invoices", invoiceId, {
    status: "waived",
    notes: reason,
    updated_at: now,
  });
}

export function voidInvoice(db: TenantDb, invoiceId: string, now: string): Promise<number> {
  return db.update("dues_invoices", invoiceId, { status: "void", updated_at: now });
}

/** Suggest the next period label from the Rotary year, which runs July–June. */
export function suggestPeriodLabel(today: string): string {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const startYear = month >= 7 ? year : year - 1;
  const half = month >= 7 && month <= 12 ? "first half" : "second half";
  return `${startYear}–${String(startYear + 1).slice(2)} ${half}`;
}

export function listPaymentsForPerson(
  db: TenantDb,
  personId: string,
  limit = 20,
): Promise<{ amount_cents: number; method: string; received_on: string; kind: string }[]> {
  return db.all("payments", {
    columns: "amount_cents, method, received_on, kind",
    where: "person_id = ?",
    params: [personId],
    orderBy: "received_on DESC",
    limit,
  });
}
