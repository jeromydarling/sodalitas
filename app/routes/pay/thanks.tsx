import { Link } from "react-router";
import type { Route } from "./+types/thanks";
import { envContext } from "@worker/loadContext";
import { marketingMeta } from "~/seo";
import { brand } from "@content/brand";

export function meta(_: Route.MetaArgs) {
  return marketingMeta({
    title: "Thank you",
    description: "Your payment is being confirmed.",
    path: "/pay/thanks",
    noIndex: true,
  });
}

/**
 * Where Stripe sends a payer afterwards.
 *
 * Careful about what this page claims. **A success redirect is not proof of
 * payment** — it is a URL anyone can type, and the money is only real when the
 * signed webhook says so. So this page reads the checkout row we wrote before
 * the payer left and reports its actual state, which is usually still `open`
 * for the second or two Stripe takes to deliver the event.
 *
 * The wording therefore thanks them without asserting anything the ledger
 * hasn't confirmed. Saying "paid!" and being wrong is how a club ends up
 * chasing somebody who genuinely did pay, or crediting somebody who didn't.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.get(envContext);
  const id = new URL(request.url).searchParams.get("c");

  if (!id) return { state: "unknown" as const, clubName: null, amountCents: null };

  // Read without a tenant: the payer has no session, and this row's own id is
  // the only thing they hold. Nothing tenant-owned is exposed — just the club's
  // name and the amount they themselves just paid.
  const row = await env.DB.prepare(
    `SELECT k.status, k.amount_cents, k.charged_cents, c.name AS club_name
       FROM checkout_sessions k
       JOIN clubs c ON c.id = k.club_id AND c.tenant_id = k.tenant_id
      WHERE k.id = ?`,
  )
    .bind(id)
    .first<{ status: string; amount_cents: number; charged_cents: number; club_name: string }>();

  if (!row) return { state: "unknown" as const, clubName: null, amountCents: null };

  return {
    state: row.status === "complete" ? ("confirmed" as const) : ("pending" as const),
    clubName: row.club_name,
    amountCents: row.charged_cents,
  };
}

export default function PayThanks({ loaderData }: Route.ComponentProps) {
  const { state, clubName } = loaderData;

  return (
    <main className="grid min-h-svh place-items-center bg-ink-50 px-6 dark:bg-ink-950">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-semibold text-ink-900 dark:text-ink-50">Thank you.</h1>

        {state === "confirmed" ? (
          <p className="mt-3 text-pretty text-ink-600 dark:text-ink-400">
            That's gone through{clubName ? ` to ${clubName}` : ""}. Stripe has emailed you a
            receipt.
          </p>
        ) : state === "pending" ? (
          <p className="mt-3 text-pretty text-ink-600 dark:text-ink-400">
            {clubName ? `${clubName} will see this shortly.` : "This will be confirmed shortly."}{" "}
            Stripe confirms payments a moment after they're made, and your receipt is on its way by
            email. Nothing further is needed from you.
          </p>
        ) : (
          <p className="mt-3 text-pretty text-ink-600 dark:text-ink-400">
            If you've just paid, your receipt will arrive by email shortly.
          </p>
        )}

        <p className="mt-8 text-sm text-ink-500">
          <Link to="/" className="hover:text-brand-600">
            {brand.name}
          </Link>
        </p>
      </div>
    </main>
  );
}
