/**
 * analytics.ts — letting a club add their own tracking without handing anyone a
 * script tag.
 *
 * Clubs ask for this. A membership chair who has run a Facebook ad wants their
 * pixel on the join page, and a district that funds a website wants Analytics
 * on it. The usual implementation is a textarea labelled "custom head HTML",
 * and that textarea is a cross-site scripting vulnerability with a form label.
 * It is also a permanent one: it survives every rewrite, because by then three
 * hundred customers have pasted things into it.
 *
 * So: a club pastes an **id**. We validate it against a strict per-provider
 * format, store the id, and generate the vendor's own snippet ourselves. There
 * is no field anywhere in this product that accepts markup.
 *
 * Re-validated on read as well as on write. A row written by a future bug, or
 * edited by someone with database access, still cannot become arbitrary
 * JavaScript on a club's public page.
 */

export interface ProviderDef {
  key: string;
  name: string;
  /** What the club is looking for, in their vendor's own words. */
  hint: string;
  /** Where to find it, because "your measurement ID" helps nobody. */
  where: string;
  pattern: RegExp;
  placeholder: string;
}

export const ANALYTICS_PROVIDERS: ProviderDef[] = [
  {
    key: "ga4",
    name: "Google Analytics",
    hint: "Your measurement ID. It starts with G-.",
    where: "Google Analytics → Admin → Data streams → your website.",
    pattern: /^G-[A-Z0-9]{6,12}$/,
    placeholder: "G-XXXXXXXXXX",
  },
  {
    key: "gtm",
    name: "Google Tag Manager",
    hint: "Your container ID. It starts with GTM-.",
    where: "Tag Manager → the container ID beside your workspace name.",
    pattern: /^GTM-[A-Z0-9]{4,10}$/,
    placeholder: "GTM-XXXXXXX",
  },
  {
    key: "metaPixel",
    name: "Meta Pixel",
    hint: "The pixel ID — a long number, nothing else.",
    where: "Meta Events Manager → Data sources → your pixel.",
    pattern: /^\d{10,20}$/,
    placeholder: "123456789012345",
  },
  {
    key: "plausible",
    name: "Plausible",
    hint: "The domain you registered with Plausible.",
    where: "Plausible → site settings. It's the domain, e.g. rotaryclubofsomewhere.org.",
    pattern: /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/,
    placeholder: "rotaryclubofsomewhere.org",
  },
];

export type AnalyticsKey = string;
export type AnalyticsConfig = Record<AnalyticsKey, string>;

const byKey = new Map(ANALYTICS_PROVIDERS.map((p) => [p.key, p]));

/** Normalise before matching: clubs paste `g-abc123` and mean `G-ABC123`. */
function normalise(key: string, value: string): string {
  const raw = value.trim();
  if (key === "plausible") return raw.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  // Spaces and hyphens only — a club reading a pixel id off a screen types it
  // in groups. Stripping *every* non-digit would quietly turn
  // "123456789012345';alert(1)" into a valid-looking id, which is worse than
  // rejecting it: it would look accepted and then measure nothing.
  if (key === "metaPixel") return raw.replace(/[\s-]/g, "");
  return raw.toUpperCase();
}

export interface FieldVerdict {
  ok: boolean;
  value: string;
  message?: string;
}

/** Check one id. Empty is valid and means "not set". */
export function validateId(key: string, value: string): FieldVerdict {
  const provider = byKey.get(key);
  if (!provider) return { ok: false, value: "", message: "We don't support that one." };
  if (!value.trim()) return { ok: true, value: "" };

  const cleaned = normalise(key, value);
  if (!provider.pattern.test(cleaned)) {
    return {
      ok: false,
      value: "",
      message: `That doesn't look like a ${provider.name} ID. It should look like ${provider.placeholder}. ${provider.where}`,
    };
  }
  return { ok: true, value: cleaned };
}

/** Keep only the ids that pass. Used on every read; nothing else is trusted. */
export function validateAnalytics(input: unknown): AnalyticsConfig {
  const raw = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const out: AnalyticsConfig = {};
  for (const provider of ANALYTICS_PROVIDERS) {
    const value = raw[provider.key];
    if (typeof value !== "string") continue;
    const verdict = validateId(provider.key, value);
    if (verdict.ok && verdict.value) out[provider.key] = verdict.value;
  }
  return out;
}

export function parseAnalytics(json: string | null | undefined): AnalyticsConfig {
  if (!json) return {};
  try {
    return validateAnalytics(JSON.parse(json));
  } catch {
    return {};
  }
}

/**
 * Build the scripts a page should carry.
 *
 * Returned as data — `{src}` for an external script, `{inline}` for a snippet
 * we composed — so the renderer decides how to emit them and no string here is
 * ever HTML. The ids are re-tested against their pattern one last time inside
 * this function: it is the last line before a value becomes a URL, and the cost
 * of checking twice is a regex.
 */
export interface AnalyticsScript {
  provider: string;
  src?: string;
  inline?: string;
}

export function analyticsScripts(config: AnalyticsConfig): AnalyticsScript[] {
  const out: AnalyticsScript[] = [];

  const pass = (key: string): string | null => {
    const provider = byKey.get(key);
    const value = config[key];
    if (!provider || !value || !provider.pattern.test(value)) return null;
    return value;
  };

  const ga4 = pass("ga4");
  if (ga4) {
    out.push({ provider: "ga4", src: `https://www.googletagmanager.com/gtag/js?id=${ga4}` });
    out.push({
      provider: "ga4",
      inline:
        `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}` +
        `gtag('js',new Date());gtag('config','${ga4}');`,
    });
  }

  const gtm = pass("gtm");
  if (gtm) {
    out.push({
      provider: "gtm",
      inline:
        `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});` +
        `var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';` +
        `j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);` +
        `})(window,document,'script','dataLayer','${gtm}');`,
    });
  }

  const pixel = pass("metaPixel");
  if (pixel) {
    out.push({
      provider: "metaPixel",
      inline:
        `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?` +
        `n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;` +
        `n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;` +
        `t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}` +
        `(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');` +
        `fbq('init','${pixel}');fbq('track','PageView');`,
    });
  }

  const plausible = pass("plausible");
  if (plausible) {
    out.push({
      provider: "plausible",
      src: `https://plausible.io/js/script.js`,
      inline: undefined,
    });
    // Plausible's snippet carries the domain as an attribute rather than in the
    // URL; the renderer reads it from the config for that one script.
  }

  return out;
}

/**
 * The sentence the privacy policy needs.
 *
 * A club's trackers are the club's, set by the club, under the club's own
 * legal obligations — and a visitor is entitled to know that before they are
 * counted. Exported so the policy page and the club's own page footer can say
 * the same thing.
 */
export function disclosureFor(config: AnalyticsConfig): string | null {
  const names = ANALYTICS_PROVIDERS.filter((p) => config[p.key]).map((p) => p.name);
  if (names.length === 0) return null;
  const list =
    names.length === 1
      ? names[0]!
      : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]!}`;
  return `This club uses ${list} to measure visits to this site. Those are the club's own accounts, set up by the club, and the data goes to them.`;
}
