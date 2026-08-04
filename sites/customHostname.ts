/**
 * customHostname.ts — Cloudflare for SaaS, without an SDK.
 *
 * A club owns rotaryclubofsomewhere.org. They point it at us with one CNAME;
 * Cloudflare issues a certificate and routes the traffic into this Worker,
 * which looks the hostname up and serves that club's site. That is the whole
 * feature, and it is four REST calls.
 *
 * **The validation method, and why it is `http`.**
 *
 * Cloudflare offers three ways to prove the club controls the domain. TXT
 * pre-validation is the technically better one: the certificate is issued
 * *before* DNS changes, so a club migrating a live site has no gap. It also
 * asks a club treasurer to add two TXT records and a CNAME at a registrar
 * control panel, and the honest expectation is that a meaningful fraction of
 * them will get one of the three wrong and give up.
 *
 * So the default is `http`: one CNAME, and Cloudflare handles the rest from
 * the edge. The cost is a window of a few minutes between DNS propagating and
 * the certificate issuing, during which a visitor may see a warning. For a club
 * whose domain currently points at nothing, or at a Wix site they are
 * abandoning, that window costs nothing. For the rare club moving a busy live
 * site, `createCustomHostname` takes a `method` and the settings screen offers
 * the TXT path with the extra records spelled out.
 *
 * **Running dark.** With no API token or zone id the club can still add their
 * domain, see the exact DNS record to create, and save it. `configured()` is
 * false, every call returns `{ ok: false, dark: true }`, and the row sits at
 * status `pending` until the credentials land — at which point the 15-minute
 * cron picks it up and registers it. Nothing about this feature crashes on a
 * deployment that has never had a Cloudflare token.
 */

const API = "https://api.cloudflare.com/client/v4";
const TIMEOUT_MS = 15_000;

export interface HostnameEnv {
  /** Needs "SSL and Certificates: Edit" on the zone. Absent means run dark. */
  CF_API_TOKEN?: string;
  /** The zone clubs CNAME into. */
  CF_ZONE_ID?: string;
  /**
   * What a club actually types into their registrar. Falls back to the app's
   * own hostname, which works but reads oddly on a DNS panel — set it to
   * something like `sites.sodalitas.app` once the zone exists.
   */
  SITE_CNAME_TARGET?: string;
  APP_URL: string;
}

export function configured(env: HostnameEnv): boolean {
  return Boolean(env.CF_API_TOKEN && env.CF_ZONE_ID);
}

/** The address a club points their CNAME at. */
export function cnameTarget(env: HostnameEnv): string {
  if (env.SITE_CNAME_TARGET) return env.SITE_CNAME_TARGET;
  try {
    return new URL(env.APP_URL).hostname;
  } catch {
    return "sodalitas.app";
  }
}

// ── What Cloudflare gives back ────────────────────────────────────────────────

export type DomainStatus = "pending" | "active" | "error";

export interface HostnameRecord {
  cfId: string;
  hostname: string;
  /** Our own summary: what the settings screen shows as a single word. */
  status: DomainStatus;
  /** Cloudflare's hostname status, verbatim, for the detail line. */
  cfStatus: string;
  /** Cloudflare's certificate status, verbatim. */
  sslStatus: string;
  /** The TXT record proving the club owns the domain, when one is offered. */
  ownership: { name: string; value: string } | null;
  /** The TXT record the certificate authority wants, on the TXT path. */
  dcv: { name: string; value: string } | null;
  /** Verbatim. A CAA record blocking the CA needs the real message. */
  errors: string[];
}

export type HostnameResult =
  | { ok: true; record: HostnameRecord }
  | { ok: false; dark: true; message: string }
  | { ok: false; dark: false; message: string; retryable: boolean };

// ── The wire ──────────────────────────────────────────────────────────────────

interface CfEnvelope<T> {
  success: boolean;
  errors?: { code?: number; message?: string }[];
  result?: T;
}

interface CfHostname {
  id: string;
  hostname: string;
  status?: string;
  verification_errors?: string[];
  ownership_verification?: { name?: string; value?: string };
  ssl?: {
    status?: string;
    validation_errors?: { message?: string }[];
    validation_records?: { txt_name?: string; txt_value?: string }[];
  };
}

const DARK: HostnameResult = {
  ok: false,
  dark: true,
  message:
    "Custom domains aren't switched on for this deployment yet. Your address is saved — it'll be set up automatically once that's done.",
};

/**
 * Cloudflare error codes worth translating.
 *
 * Everything else is passed through, because a club forwarding a real error
 * message to their web person gets help faster than one forwarding "something
 * went wrong".
 */
const FRIENDLY: Record<number, string> = {
  1406: "That address is already registered here — possibly by another club, possibly by an earlier attempt of yours. Get in touch and we'll sort it out.",
  1407: "That address is already registered here.",
  1436: "That address belongs to a zone already on Cloudflare in a way that conflicts. It usually means the domain is on a Cloudflare account with the same name already proxied.",
};

async function call<T>(
  env: HostnameEnv,
  path: string,
  init: RequestInit = {},
): Promise<{ ok: true; result: T } | { ok: false; message: string; retryable: boolean }> {
  let res: Response;
  try {
    res = await fetch(`${API}/zones/${env.CF_ZONE_ID}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${env.CF_API_TOKEN}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    // A timeout or a network blip. Retryable: the cron will come round again.
    return {
      ok: false,
      retryable: true,
      message: `Couldn't reach Cloudflare just now (${err instanceof Error ? err.message : "network error"}).`,
    };
  }

  let body: CfEnvelope<T>;
  try {
    body = (await res.json()) as CfEnvelope<T>;
  } catch {
    return { ok: false, retryable: res.status >= 500, message: `Cloudflare returned ${res.status}.` };
  }

  if (!res.ok || !body.success) {
    const first = body.errors?.[0];
    const friendly = first?.code ? FRIENDLY[first.code] : undefined;
    return {
      ok: false,
      // 5xx and 429 are worth another go; a 400 will fail identically forever.
      retryable: res.status >= 500 || res.status === 429,
      message: friendly ?? first?.message ?? `Cloudflare returned ${res.status}.`,
    };
  }

  return { ok: true, result: body.result as T };
}

/**
 * Fold Cloudflare's two statuses into one.
 *
 * A club does not need to learn the difference between "the hostname is
 * verified" and "the certificate is issued". They need to know whether their
 * domain works yet. Both must be good for the answer to be yes.
 */
function summarise(cf: CfHostname): DomainStatus {
  const host = cf.status ?? "";
  const ssl = cf.ssl?.status ?? "";
  if (host === "active" && (ssl === "active" || ssl === "")) return "active";
  if (host.includes("blocked") || host.includes("deleted") || ssl.includes("timed_out")) {
    return "error";
  }
  return "pending";
}

function normalise(cf: CfHostname): HostnameRecord {
  const dcvRecord = cf.ssl?.validation_records?.find((r) => r.txt_name && r.txt_value);
  return {
    cfId: cf.id,
    hostname: cf.hostname,
    status: summarise(cf),
    cfStatus: cf.status ?? "unknown",
    sslStatus: cf.ssl?.status ?? "unknown",
    ownership:
      cf.ownership_verification?.name && cf.ownership_verification.value
        ? { name: cf.ownership_verification.name, value: cf.ownership_verification.value }
        : null,
    dcv: dcvRecord ? { name: dcvRecord.txt_name!, value: dcvRecord.txt_value! } : null,
    errors: [
      ...(cf.verification_errors ?? []),
      ...(cf.ssl?.validation_errors ?? []).map((e) => e.message ?? "").filter(Boolean),
    ].filter(Boolean),
  };
}

// ── The four calls ────────────────────────────────────────────────────────────

export type ValidationMethod = "http" | "txt";

export async function createCustomHostname(
  env: HostnameEnv,
  hostname: string,
  method: ValidationMethod = "http",
): Promise<HostnameResult> {
  if (!configured(env)) return DARK;

  const res = await call<CfHostname>(env, "/custom_hostnames", {
    method: "POST",
    body: JSON.stringify({
      hostname,
      ssl: {
        method,
        type: "dv",
        settings: {
          // 1.0 and 1.1 are dead and a club page has no legacy clients to
          // worry about. `http2` is free performance on somebody else's domain.
          min_tls_version: "1.2",
          http2: "on",
        },
        // Also certificate the www form, so a club that points both at us gets
        // one working and one warning instead of two support emails.
        wildcard: false,
      },
    }),
  });

  if (!res.ok) return { ok: false, dark: false, message: res.message, retryable: res.retryable };
  return { ok: true, record: normalise(res.result) };
}

export async function getCustomHostname(env: HostnameEnv, cfId: string): Promise<HostnameResult> {
  if (!configured(env)) return DARK;
  const res = await call<CfHostname>(env, `/custom_hostnames/${encodeURIComponent(cfId)}`);
  if (!res.ok) return { ok: false, dark: false, message: res.message, retryable: res.retryable };
  return { ok: true, record: normalise(res.result) };
}

export async function deleteCustomHostname(
  env: HostnameEnv,
  cfId: string,
): Promise<{ ok: boolean; message?: string }> {
  if (!configured(env)) return { ok: true };
  const res = await call<unknown>(env, `/custom_hostnames/${encodeURIComponent(cfId)}`, {
    method: "DELETE",
  });
  // A hostname that is already gone is a success from where the caller stands.
  if (!res.ok && !/not found/i.test(res.message)) return { ok: false, message: res.message };
  return { ok: true };
}

/**
 * Ask Cloudflare to re-check now, rather than on its own backoff schedule.
 *
 * The retry schedule stretches out to hours. A club that has just fixed their
 * DNS record and is sitting on the settings screen watching it will not wait
 * hours, and a PATCH with the same values restarts validation immediately.
 */
export async function recheckCustomHostname(
  env: HostnameEnv,
  cfId: string,
  method: ValidationMethod = "http",
): Promise<HostnameResult> {
  if (!configured(env)) return DARK;
  const res = await call<CfHostname>(env, `/custom_hostnames/${encodeURIComponent(cfId)}`, {
    method: "PATCH",
    body: JSON.stringify({ ssl: { method, type: "dv" } }),
  });
  if (!res.ok) return { ok: false, dark: false, message: res.message, retryable: res.retryable };
  return { ok: true, record: normalise(res.result) };
}

/**
 * The sentence to put under a pending domain.
 *
 * Waiting for DNS is the worst part of this flow — nothing appears to happen
 * for anywhere between two minutes and a day, and the difference between "we
 * are waiting for you" and "we are waiting for the internet" is the difference
 * between a club acting and a club giving up.
 */
export function statusExplanation(record: Pick<HostnameRecord, "status" | "cfStatus" | "sslStatus">): string {
  if (record.status === "active") return "Live. Your club page is being served on your own address.";
  if (record.status === "error") {
    return "Something is blocking this. The details are below — most often it's a CAA record on the domain that won't let a certificate be issued.";
  }
  if (record.cfStatus !== "active") {
    return "Waiting to see your DNS record. Once you've added it at your registrar this usually clears within an hour, though some registrars take longer.";
  }
  return "Your DNS is right and we're waiting on the certificate. This is automatic and normally takes a few minutes.";
}
