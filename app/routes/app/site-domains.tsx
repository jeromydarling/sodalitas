import { Form, Link, useNavigation } from "react-router";
import type { Route } from "./+types/site-domains";
import { envContext } from "@worker/loadContext";
import { appMeta } from "~/seo";
import { getContext, requireNotDemo } from "@worker/context";
import {
  siteFor, getOrCreateSite, listDomains, recordDomain, domainById,
  updateDomainStatus, removeDomain, domainErrors,
} from "@db/services/sites";
import { validateHostname, dnsInstructions } from "@domain/hostname";
import {
  configured, cnameTarget, createCustomHostname, getCustomHostname,
  deleteCustomHostname, recheckCustomHostname, statusExplanation,
} from "@sites/customHostname";
import { PageHeader, Card, Chip, Button, Field, Input, formatDate } from "~/ui";

export function meta(_: Route.MetaArgs) {
  return appMeta("Your own address");
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = await getContext(request, context.get(envContext));
  ctx.require("site.domain");
  const db = ctx.db();

  const club = await db.first<{
    id: string; name: string; slug: string; city: string | null;
    state_code: string | null; charter_date: string | null;
  }>("clubs", { columns: "id, name, slug, city, state_code, charter_date" });
  if (!club) throw new Response("This account has no club yet.", { status: 404 });

  const site = await getOrCreateSite(db, club, ctx.now, ctx.user?.id ?? null);
  const domains = await listDomains(db, club.id);
  const target = cnameTarget(ctx.env);

  return {
    club: { name: club.name, slug: club.slug },
    siteLive: site.status === "live",
    target,
    dark: !configured(ctx.env),
    publicUrl: `${ctx.env.APP_URL}/club/${club.slug}`,
    domains: domains.map((d) => ({
      id: d.id,
      hostname: d.hostname,
      status: d.status,
      explanation: statusExplanation({
        status: d.status === "deleted" ? "error" : d.status,
        cfStatus: d.cf_status ?? "",
        sslStatus: d.ssl_status ?? "",
      }),
      dns: dnsInstructions(d.hostname, target),
      ownership:
        d.ownership_name && d.ownership_value
          ? { name: d.ownership_name, value: d.ownership_value }
          : null,
      dcv: d.dcv_txt_name && d.dcv_txt_value ? { name: d.dcv_txt_name, value: d.dcv_txt_value } : null,
      errors: domainErrors(d),
      lastCheckedAt: d.last_checked_at,
      registered: Boolean(d.cf_hostname_id),
    })),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const ctx = await getContext(request, context.get(envContext));
  ctx.require("site.domain");
  const db = ctx.db();

  const club = await db.first<{
    id: string; name: string; city: string | null;
    state_code: string | null; charter_date: string | null;
  }>("clubs", { columns: "id, name, city, state_code, charter_date" });
  if (!club) return { error: "This account has no club yet." };

  const site = (await siteFor(db, club.id)) ?? (await getOrCreateSite(db, club, ctx.now, ctx.user?.id ?? null));
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "add") {
    // Anyone can sign in to the demo, and this reaches a real Cloudflare
    // account and asks a certificate authority for a certificate.
    requireNotDemo(ctx, "Adding a custom address");

    const verdict = validateHostname(String(form.get("hostname") ?? ""));
    if (!verdict.ok) return { error: verdict.reason };

    const recorded = await recordDomain(
      db,
      { clubId: club.id, siteId: site.id, hostname: verdict.hostname },
      ctx.now,
      ctx.user?.id ?? null,
    );
    if (!recorded.ok) return { error: recorded.message };

    // Registering with Cloudflare can fail without losing the club's work:
    // the row exists, the instructions render, and the 15-minute cron retries.
    const result = await createCustomHostname(ctx.env, verdict.hostname);
    if (result.ok) {
      await updateDomainStatus(
        db,
        recorded.id!,
        {
          cfHostnameId: result.record.cfId,
          status: result.record.status,
          cfStatus: result.record.cfStatus,
          sslStatus: result.record.sslStatus,
          ownership: result.record.ownership,
          dcv: result.record.dcv,
          errors: result.record.errors,
        },
        ctx.now,
      );
      return { ok: true };
    }

    if (result.dark) return { ok: true, note: result.message };
    return { ok: true, note: `Saved. Cloudflare said: ${result.message}. We'll keep trying.` };
  }

  if (intent === "check") {
    const domain = await domainById(db, String(form.get("domainId") ?? ""));
    if (!domain) return { error: "We couldn't find that address." };

    const result = domain.cf_hostname_id
      ? await recheckCustomHostname(ctx.env, domain.cf_hostname_id)
      : await createCustomHostname(ctx.env, domain.hostname);

    if (!result.ok) {
      return result.dark ? { ok: true, note: result.message } : { error: result.message };
    }

    await updateDomainStatus(
      db,
      domain.id,
      {
        cfHostnameId: result.record.cfId,
        status: result.record.status,
        cfStatus: result.record.cfStatus,
        sslStatus: result.record.sslStatus,
        ownership: result.record.ownership,
        dcv: result.record.dcv,
        errors: result.record.errors,
      },
      ctx.now,
    );
    return { ok: true };
  }

  if (intent === "remove") {
    const domain = await domainById(db, String(form.get("domainId") ?? ""));
    if (!domain) return { error: "We couldn't find that address." };
    if (domain.cf_hostname_id) await deleteCustomHostname(ctx.env, domain.cf_hostname_id);
    await removeDomain(db, domain.id, ctx.now);
    return { ok: true };
  }

  return { error: "We didn't recognise that." };
}

function Record({ type, name, value }: { type: string; name: string; value: string }) {
  return (
    <div className="overflow-x-auto rounded-lg bg-ink-50 p-3 dark:bg-ink-800/40">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="text-xs tracking-wide text-ink-500 uppercase">
            <th className="pr-4 pb-1 font-medium">Type</th>
            <th className="pr-4 pb-1 font-medium">Name</th>
            <th className="pb-1 font-medium">Value</th>
          </tr>
        </thead>
        <tbody>
          <tr className="font-mono text-ink-800 dark:text-ink-200">
            <td className="pr-4">{type}</td>
            <td className="pr-4">{name}</td>
            <td className="break-all">{value}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export default function SiteDomains({ loaderData, actionData }: Route.ComponentProps) {
  const { domains, target, dark, siteLive, publicUrl, club } = loaderData;
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <PageHeader
        title="Your own address"
        subtitle={
          <>
            Serve {club.name}'s{" "}
            <Link to="/app/site" className="underline underline-offset-4">
              website
            </Link>{" "}
            at an address your club owns, with a certificate we obtain for you. There's no charge
            for this.
          </>
        }
      />

      {actionData && "error" in actionData && actionData.error && (
        <p className="mb-6 rounded-lg border border-risk-500/30 bg-risk-500/5 px-4 py-3 text-sm text-ink-800 dark:text-ink-200">
          {actionData.error}
        </p>
      )}
      {actionData && "note" in actionData && actionData.note && (
        <p className="mb-6 rounded-lg border border-watch-500/30 bg-watch-500/5 px-4 py-3 text-sm text-ink-800 dark:text-ink-200">
          {actionData.note}
        </p>
      )}

      {!siteLive && (
        <Card className="mb-6 border-watch-500/30 bg-watch-500/5">
          <p className="text-sm text-ink-800 dark:text-ink-200">
            Your site isn't live yet, so an address pointed here would show nothing. Set it up now
            by all means — DNS takes a while anyway — but{" "}
            <Link to="/app/site" className="underline underline-offset-4">
              put the site live
            </Link>{" "}
            before you tell anybody.
          </p>
        </Card>
      )}

      <div className="space-y-6">
        {domains.map((domain) => (
          <Card key={domain.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-medium text-ink-900 dark:text-ink-100">{domain.hostname}</h2>
                <p className="mt-1 max-w-xl text-sm text-ink-600 dark:text-ink-400">
                  {domain.explanation}
                </p>
              </div>
              <Chip
                tone={
                  domain.status === "active" ? "steady" : domain.status === "error" ? "risk" : "watch"
                }
              >
                {domain.status === "active"
                  ? "Live"
                  : domain.status === "error"
                    ? "Needs attention"
                    : "Waiting"}
              </Chip>
            </div>

            {domain.status !== "active" && (
              <div className="mt-4 space-y-4">
                <div>
                  <p className="mb-2 text-sm font-medium text-ink-800 dark:text-ink-200">
                    Add this record where your domain is registered
                  </p>
                  <Record type={domain.dns.type} name={domain.dns.name} value={domain.dns.value} />
                  <p className="mt-2 text-sm text-ink-600 dark:text-ink-400">{domain.dns.note}</p>
                </div>

                {domain.ownership && (
                  <div>
                    <p className="mb-2 text-sm font-medium text-ink-800 dark:text-ink-200">
                      And this one, to prove the domain is yours
                    </p>
                    <Record type="TXT" name={domain.ownership.name} value={domain.ownership.value} />
                  </div>
                )}

                {domain.dcv && (
                  <div>
                    <p className="mb-2 text-sm font-medium text-ink-800 dark:text-ink-200">
                      And this one, for the certificate
                    </p>
                    <Record type="TXT" name={domain.dcv.name} value={domain.dcv.value} />
                  </div>
                )}

                {domain.errors.length > 0 && (
                  <div className="rounded-lg border border-risk-500/30 bg-risk-500/5 px-4 py-3 text-sm">
                    <p className="font-medium text-ink-800 dark:text-ink-200">
                      What Cloudflare is reporting
                    </p>
                    {/* Verbatim. A club forwarding a real error to their web
                        person gets help; one forwarding "something went wrong"
                        does not. */}
                    <ul className="mt-1 list-disc space-y-1 pl-5 font-mono text-xs text-ink-700 dark:text-ink-300">
                      {domain.errors.map((error, i) => (
                        <li key={i}>{error}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <Form method="post">
                <input type="hidden" name="intent" value="check" />
                <input type="hidden" name="domainId" value={domain.id} />
                <Button variant="secondary" disabled={busy}>
                  {busy ? "Checking…" : "Check it now"}
                </Button>
              </Form>
              <Form method="post">
                <input type="hidden" name="intent" value="remove" />
                <input type="hidden" name="domainId" value={domain.id} />
                <Button variant="quiet">Remove</Button>
              </Form>
              {domain.lastCheckedAt && (
                <span className="text-xs text-ink-500">
                  Last checked {formatDate(domain.lastCheckedAt)}
                </span>
              )}
            </div>
          </Card>
        ))}

        <Card>
          <h2 className="font-medium text-ink-900 dark:text-ink-100">
            {domains.length ? "Add another" : "Point your address here"}
          </h2>
          <p className="mt-1 mb-4 max-w-2xl text-sm text-ink-600 dark:text-ink-400">
            Type the address you want the site to appear at. Most clubs use the www form —{" "}
            <code className="rounded bg-ink-100 px-1 py-0.5 text-xs dark:bg-ink-800">
              www.rotaryclubofsomewhere.org
            </code>{" "}
            — because a bare domain can't hold the kind of record this needs at every registrar.
          </p>

          <Form method="post" className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="intent" value="add" />
            <div className="min-w-64 flex-1">
              <Field label="Address" name="hostname">
                <Input
                  id="hostname"
                  name="hostname"
                  placeholder="www.rotaryclubofsomewhere.org"
                  spellCheck={false}
                  autoCapitalize="off"
                  required
                />
              </Field>
            </div>
            <Button disabled={busy}>Add it</Button>
          </Form>

          <div className="mt-6 border-t border-ink-100 pt-5 text-sm text-ink-600 dark:border-ink-800 dark:text-ink-400">
            <p className="font-medium text-ink-800 dark:text-ink-200">How this goes</p>
            <ol className="mt-2 list-decimal space-y-1 pl-5">
              <li>You add the address here.</li>
              <li>
                You add one record at your registrar, pointing at{" "}
                <code className="rounded bg-ink-100 px-1 py-0.5 text-xs dark:bg-ink-800">{target}</code>.
              </li>
              <li>
                We obtain a certificate. That's automatic and usually takes minutes, though DNS
                itself can take up to a day.
              </li>
              <li>Your site serves at your address. The one at {publicUrl.replace(/^https:\/\//, "")} keeps working too.</li>
            </ol>
            <p className="mt-4">
              Only the public site moves. Everything you and your officers use stays at our address
              — a club's own domain can't serve the app, by design.
            </p>
          </div>

          {dark && (
            <p className="mt-5 rounded-lg bg-ink-50 px-4 py-3 text-sm text-ink-700 dark:bg-ink-800/40 dark:text-ink-300">
              Custom addresses aren't fully switched on for this deployment yet. You can add yours
              now and see exactly what to put at your registrar — it'll be set up automatically once
              that's done.
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}
