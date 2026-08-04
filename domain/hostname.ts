/**
 * hostname.ts — deciding whether a club may claim a domain.
 *
 * A club types something into a box and we hand it to Cloudflare's custom
 * hostname API, which then tries to obtain a publicly trusted certificate for
 * it. That makes this box more consequential than it looks, and the checks fall
 * into three groups:
 *
 *   **Is it a hostname at all?** People paste `https://www.example.org/about`,
 *   `WWW.Example.Org.`, and `example.org ` with a trailing space. All three
 *   mean the same domain and all three should work.
 *
 *   **Is it something we must never take?** An IP literal, `localhost`, a bare
 *   TLD, a wildcard. None of these can be certificated, and letting one through
 *   produces a support conversation about an error message from a CA.
 *
 *   **Is it ours?** A club must not be able to claim `app.sodalitas.app` or
 *   anything under our Workers domain. Cloudflare would reject a hostname that
 *   matches the zone itself, but not one that shadows an application route —
 *   and a custom hostname pointing at the app's own login page is a phishing
 *   surface we would have handed over ourselves.
 */

export interface HostnameOk {
  ok: true;
  /** Lowercased, punycode, no trailing dot. This is what gets stored. */
  hostname: string;
  /** True for `example.org`, false for `www.example.org`. */
  isApex: boolean;
}

export interface HostnameError {
  ok: false;
  /** Written for a club officer, not for us. */
  reason: string;
}

export type HostnameResult = HostnameOk | HostnameError;

/**
 * Suffixes a club can never claim.
 *
 * `workers.dev` and our own product domain are ours. The others are
 * infrastructure suffixes that a certificate authority will refuse anyway, and
 * refusing them here means the club sees a sentence instead of a CA error.
 */
export const RESERVED_SUFFIXES = [
  "sodalitas.app",
  "workers.dev",
  "pages.dev",
  "cloudflareaccess.com",
  "localhost",
  "local",
  "internal",
  "test",
  "invalid",
  "example",
  "onion",
] as const;

const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * Clean up whatever was pasted.
 *
 * Runs the value through `URL`, which handles punycode for us — a club in
 * Québec typing `rotaryclubdemontréal.ca` gets the xn-- form stored, which is
 * what Cloudflare's API and DNS both want.
 */
export function normaliseHostname(input: string): string {
  let raw = input.trim().toLowerCase();
  if (!raw) return "";
  // Strip a scheme, credentials, path, query — anything after the authority.
  if (!raw.includes("://")) raw = `https://${raw}`;
  try {
    const url = new URL(raw);
    return url.hostname.replace(/\.$/, "");
  } catch {
    return "";
  }
}

export function validateHostname(input: string): HostnameResult {
  if (!input || !input.trim()) {
    return { ok: false, reason: "Type the address you want your club page to live at." };
  }

  const hostname = normaliseHostname(input);
  if (!hostname) {
    return { ok: false, reason: "That doesn't look like a web address. Something like rotaryclubofsomewhere.org." };
  }
  if (hostname.length > 253) {
    return { ok: false, reason: "That address is too long to be a real domain." };
  }
  if (hostname.startsWith("*")) {
    return { ok: false, reason: "We can't take a wildcard address. Point one specific address at us — www is the usual choice." };
  }
  if (IPV4.test(hostname) || hostname.includes(":") || hostname.startsWith("[")) {
    return { ok: false, reason: "That's an IP address. A certificate needs a domain name." };
  }

  const labels = hostname.split(".");
  if (labels.length < 2) {
    return { ok: false, reason: "That's missing the ending — try rotaryclubofsomewhere.org rather than rotaryclubofsomewhere." };
  }
  for (const label of labels) {
    if (!LABEL.test(label)) {
      return {
        ok: false,
        reason: `"${label.slice(0, 30)}" isn't a valid part of a domain. Letters, numbers and hyphens only, and it can't start or end with a hyphen.`,
      };
    }
  }

  const tld = labels[labels.length - 1]!;
  if (!/^[a-z]{2,}$/.test(tld) && !tld.startsWith("xn--")) {
    return { ok: false, reason: `".${tld}" isn't a domain ending we recognise.` };
  }

  for (const reserved of RESERVED_SUFFIXES) {
    if (hostname === reserved || hostname.endsWith(`.${reserved}`)) {
      return {
        ok: false,
        reason:
          reserved === "sodalitas.app" || reserved === "workers.dev"
            ? "That address belongs to Sodalitas. Use a domain your club owns — your club page already works at its sodalitas address."
            : `Addresses ending in .${reserved} can't be given a certificate, so they can't be used here.`,
      };
    }
  }

  return { ok: true, hostname, isApex: labels.length === 2 };
}

/**
 * What to tell the club to do at their registrar.
 *
 * An apex domain (`example.org` with no `www`) cannot hold a CNAME — that is a
 * rule of DNS, not a limitation of ours, and it is the single most common place
 * a club gets stuck. Most registrars now offer ALIAS/ANAME/"CNAME flattening"
 * for exactly this; where they don't, `www` is the answer and it is not a
 * consolation prize.
 */
export function dnsInstructions(
  hostname: string,
  cnameTarget: string,
): { type: "CNAME" | "ALIAS"; name: string; value: string; note: string } {
  const labels = hostname.split(".");
  const isApex = labels.length === 2;
  const name = isApex ? "@" : labels[0]!;

  return {
    type: isApex ? "ALIAS" : "CNAME",
    name,
    value: cnameTarget,
    note: isApex
      ? "Your registrar may call this ALIAS, ANAME, or CNAME flattening — they're the same thing. If yours doesn't offer any of them, use www instead and set the bare domain to redirect to it."
      : "A plain CNAME. If your registrar asks for a TTL, anything is fine — an hour is typical.",
  };
}
