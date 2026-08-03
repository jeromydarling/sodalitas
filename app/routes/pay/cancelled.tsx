import { Link } from "react-router";
import type { Route } from "./+types/cancelled";
import { marketingMeta } from "~/seo";
import { brand } from "@content/brand";

export function meta(_: Route.MetaArgs) {
  return marketingMeta({
    title: "Payment cancelled",
    description: "Nothing was charged.",
    path: "/pay/cancelled",
    noIndex: true,
  });
}

/**
 * Where Stripe sends somebody who backed out.
 *
 * Deliberately unbothered. A person who changed their mind at a payment screen
 * has done nothing wrong, and a page that scolds them or begs them to
 * reconsider is the reason people avoid clicking these links at all. The
 * checkout row is left `open`; Stripe expires it on its own schedule and the
 * webhook marks it expired then.
 */
export default function PayCancelled() {
  return (
    <main className="grid min-h-svh place-items-center bg-ink-50 px-6 dark:bg-ink-950">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-semibold text-ink-900 dark:text-ink-50">
          Nothing was charged.
        </h1>
        <p className="mt-3 text-pretty text-ink-600 dark:text-ink-400">
          You can come back to it whenever you like, or sort it out with the club directly —
          cheques and cash are just as welcome.
        </p>
        <p className="mt-8 text-sm text-ink-500">
          <Link to="/" className="hover:text-brand-600">
            {brand.name}
          </Link>
        </p>
      </div>
    </main>
  );
}
