import { describe, it, expect } from "vitest";
import { normaliseHostname, validateHostname, dnsInstructions, RESERVED_SUFFIXES } from "./hostname";

describe("normaliseHostname", () => {
  it("takes whatever was in the address bar", () => {
    expect(normaliseHostname("https://www.Example.ORG/about?x=1")).toBe("www.example.org");
    expect(normaliseHostname("example.org.")).toBe("example.org");
    expect(normaliseHostname("  example.org  ")).toBe("example.org");
    expect(normaliseHostname("http://example.org")).toBe("example.org");
  });

  it("punycodes an international domain, because DNS wants that form", () => {
    expect(normaliseHostname("rotaryclubdemontréal.ca")).toBe("xn--rotaryclubdemontral-rzb.ca");
  });

  it("returns nothing for nothing", () => {
    expect(normaliseHostname("")).toBe("");
    expect(normaliseHostname("   ")).toBe("");
  });
});

describe("validateHostname", () => {
  it("accepts a domain a club would actually own", () => {
    const result = validateHostname("www.rotaryclubofsomewhere.org");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.hostname).toBe("www.rotaryclubofsomewhere.org");
      expect(result.isApex).toBe(false);
    }
  });

  it("knows an apex from a subdomain", () => {
    const apex = validateHostname("rotaryclubofsomewhere.org");
    expect(apex.ok && apex.isApex).toBe(true);
  });

  it("refuses an IP address", () => {
    expect(validateHostname("192.0.2.1").ok).toBe(false);
    expect(validateHostname("[2001:db8::1]").ok).toBe(false);
  });

  it("refuses a wildcard", () => {
    const result = validateHostname("*.example.org");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("wildcard");
  });

  it("refuses a bare name with no ending", () => {
    expect(validateHostname("rotaryclub").ok).toBe(false);
    expect(validateHostname("localhost").ok).toBe(false);
  });

  it("refuses our own domains, so nobody can shadow the app", () => {
    for (const host of ["app.sodalitas.app", "sodalitas.app", "anything.workers.dev"]) {
      const result = validateHostname(host);
      expect(result.ok, host).toBe(false);
      if (!result.ok) expect(result.reason).toContain("Sodalitas");
    }
  });

  it("refuses every reserved suffix", () => {
    for (const suffix of RESERVED_SUFFIXES) {
      expect(validateHostname(`club.${suffix}`).ok, suffix).toBe(false);
    }
  });

  it("refuses labels DNS would not accept", () => {
    expect(validateHostname("-bad.example.org").ok).toBe(false);
    expect(validateHostname("bad-.example.org").ok).toBe(false);
    expect(validateHostname(`${"a".repeat(64)}.example.org`).ok).toBe(false);
  });

  it("explains itself in a sentence a club officer can act on", () => {
    const result = validateHostname("rotaryclub");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason.length).toBeGreaterThan(30);
      expect(result.reason).toContain("rotaryclubofsomewhere.org");
    }
  });

  it("asks for something rather than erroring on an empty box", () => {
    const result = validateHostname("");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("Type");
  });
});

describe("dnsInstructions", () => {
  it("gives a CNAME for a subdomain", () => {
    const dns = dnsInstructions("www.example.org", "sites.sodalitas.app");
    expect(dns.type).toBe("CNAME");
    expect(dns.name).toBe("www");
    expect(dns.value).toBe("sites.sodalitas.app");
  });

  it("gives ALIAS for an apex, and names what registrars call it", () => {
    const dns = dnsInstructions("example.org", "sites.sodalitas.app");
    expect(dns.type).toBe("ALIAS");
    expect(dns.name).toBe("@");
    expect(dns.note).toContain("ANAME");
    expect(dns.note).toContain("www");
  });
});
