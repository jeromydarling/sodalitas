import { describe, it, expect } from "vitest";
import {
  ANALYTICS_PROVIDERS,
  validateId,
  validateAnalytics,
  parseAnalytics,
  analyticsScripts,
  disclosureFor,
} from "./analytics";

describe("the provider list", () => {
  it("tells a club where to find each id", () => {
    for (const provider of ANALYTICS_PROVIDERS) {
      expect(provider.where.length, provider.key).toBeGreaterThan(15);
      expect(provider.placeholder, provider.key).toBeTruthy();
    }
  });
});

describe("validateId", () => {
  it("accepts the real thing", () => {
    expect(validateId("ga4", "G-ABC1234567")).toEqual({ ok: true, value: "G-ABC1234567" });
    expect(validateId("gtm", "GTM-ABC1234")).toEqual({ ok: true, value: "GTM-ABC1234" });
    expect(validateId("metaPixel", "123456789012345")).toEqual({ ok: true, value: "123456789012345" });
    expect(validateId("plausible", "rotaryclubofsomewhere.org").ok).toBe(true);
  });

  it("forgives the way people paste", () => {
    expect(validateId("ga4", " g-abc1234567 ").value).toBe("G-ABC1234567");
    expect(validateId("plausible", "https://Rotary.ORG/").value).toBe("rotary.org");
    expect(validateId("metaPixel", "123 456 789 012 345").value).toBe("123456789012345");
  });

  it("treats empty as not set", () => {
    expect(validateId("ga4", "")).toEqual({ ok: true, value: "" });
    expect(validateId("ga4", "   ")).toEqual({ ok: true, value: "" });
  });

  it("refuses a snippet, which is the whole point of the field", () => {
    const snippet = `<script async src="https://www.googletagmanager.com/gtag/js?id=G-ABC1234567"></script>`;
    const verdict = validateId("ga4", snippet);
    expect(verdict.ok).toBe(false);
    expect(verdict.value).toBe("");
    expect(verdict.message).toContain("G-XXXXXXXXXX");
  });

  it("refuses an id with an injection riding on it", () => {
    expect(validateId("ga4", "G-ABC1234567');alert(1);//").ok).toBe(false);
    expect(validateId("plausible", "evil.example'></script><script>alert(1)</script>").ok).toBe(false);
    // Deliberately *not* salvaged by stripping the punctuation: a mangled id
    // that looks accepted would measure nothing, forever, silently.
    expect(validateId("metaPixel", "123456789012345';alert(1);'").ok).toBe(false);
  });

  it("refuses an unknown provider", () => {
    expect(validateId("hotjar", "12345").ok).toBe(false);
  });
});

describe("validateAnalytics", () => {
  it("keeps the good ones and silently drops the bad", () => {
    const config = validateAnalytics({
      ga4: "G-ABC1234567",
      gtm: "not-a-container",
      metaPixel: "",
      unknownProvider: "G-ABC1234567",
    });
    expect(config).toEqual({ ga4: "G-ABC1234567" });
  });

  it("re-checks on read, so a bad row can never become a script", () => {
    // The shape a future bug — or a hand-edited row — might leave behind.
    expect(parseAnalytics(`{"ga4":"'};alert(1);//"}`)).toEqual({});
    expect(parseAnalytics("garbage")).toEqual({});
    expect(parseAnalytics(null)).toEqual({});
  });
});

describe("analyticsScripts", () => {
  it("builds the vendor snippet from the id", () => {
    const scripts = analyticsScripts({ ga4: "G-ABC1234567" });
    expect(scripts.some((s) => s.src?.includes("G-ABC1234567"))).toBe(true);
    expect(scripts.some((s) => s.inline?.includes("gtag('config','G-ABC1234567')"))).toBe(true);
  });

  it("emits nothing for a config that failed validation", () => {
    // Bypassing validateAnalytics on purpose: this is the last line of defence.
    expect(analyticsScripts({ ga4: "'};alert(1);//" })).toEqual([]);
    expect(analyticsScripts({})).toEqual([]);
  });

  it("never puts a quote or a tag into a snippet", () => {
    const scripts = analyticsScripts({
      ga4: "G-ABC1234567",
      gtm: "GTM-ABC1234",
      metaPixel: "123456789012345",
    });
    for (const script of scripts) {
      if (script.inline) {
        expect(script.inline).not.toContain("</script");
        expect(script.inline).not.toContain("<!--");
      }
      if (script.src) expect(script.src.startsWith("https://")).toBe(true);
    }
  });
});

describe("disclosureFor", () => {
  it("says nothing when there is nothing to disclose", () => {
    expect(disclosureFor({})).toBeNull();
  });

  it("names the trackers and whose they are", () => {
    const text = disclosureFor({ ga4: "G-ABC1234567", metaPixel: "123456789012345" })!;
    expect(text).toContain("Google Analytics");
    expect(text).toContain("Meta Pixel");
    expect(text).toContain("the club's own accounts");
  });
});
