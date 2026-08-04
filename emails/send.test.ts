/**
 * send.test.ts — transport selection and failure reporting.
 *
 * The parts worth testing here are the ones that decide whether a message goes
 * out at all, and the ones that decide what somebody reads when it didn't.
 * Everything else in this module is a fetch call.
 */
import { describe, it, expect } from "vitest";
import { mailProvider, describeSendError, textToHtml } from "./send";

const base = { DB: {} as D1Database, APP_URL: "https://x", MAIL_FROM: "a@b.c", MAIL_REPLY_TO: "a@b.c" };
const binding = { send: async () => ({ messageId: "m_1" }) };

describe("mailProvider", () => {
  it("prefers the Cloudflare binding, which needs no secret", () => {
    expect(mailProvider({ EMAIL: binding })).toBe("cloudflare");
  });

  it("still prefers the binding when a Resend key is also present", () => {
    // Both configured is a real state — a deployment that had Resend before
    // Email Service existed. The native transport wins rather than whichever
    // happens to be checked first.
    expect(mailProvider({ EMAIL: binding, RESEND_API_KEY: "re_1" })).toBe("cloudflare");
  });

  it("falls back to Resend when there is no binding", () => {
    // Email Sending needs the domain on Cloudflare DNS. Not every deployment
    // will be, so the escape hatch has to stay reachable.
    expect(mailProvider({ RESEND_API_KEY: "re_1" })).toBe("resend");
  });

  it("reports none when nothing is configured", () => {
    expect(mailProvider({})).toBe("none");
  });

  it("treats an empty key as absent rather than as a transport", () => {
    expect(mailProvider({ RESEND_API_KEY: "" })).toBe("none");
  });

  it("agrees with itself given the same environment", () => {
    // The health endpoint, the cron drain and the send path all call this. If
    // it were ever non-deterministic they would disagree about what is on.
    const env = { EMAIL: binding, RESEND_API_KEY: "re_1" };
    expect(mailProvider(env)).toBe(mailProvider(env));
  });
});

describe("describeSendError", () => {
  it("translates Cloudflare's codes into something actionable", () => {
    const err = Object.assign(new Error("nope"), { code: "E_SENDER_NOT_VERIFIED" });
    const out = describeSendError(err);
    expect(out).toContain("E_SENDER_NOT_VERIFIED");
    expect(out).toMatch(/onboard/i);
  });

  it("keeps the code alongside the explanation", () => {
    // The prose is for a human; the code is what matches Cloudflare's own
    // dashboard and docs. Dropping either one costs somebody time.
    for (const code of [
      "E_RATE_LIMIT_EXCEEDED",
      "E_DAILY_LIMIT_EXCEEDED",
      "E_RECIPIENT_SUPPRESSED",
      "E_RECIPIENT_NOT_ALLOWED",
      "E_CONTENT_TOO_LARGE",
    ]) {
      const out = describeSendError(Object.assign(new Error("x"), { code }));
      expect(out.startsWith(`${code}: `), code).toBe(true);
      expect(out.length, code).toBeGreaterThan(code.length + 20);
    }
  });

  it("passes through an unknown code without losing it", () => {
    const err = Object.assign(new Error("something new"), { code: "E_FUTURE_THING" });
    expect(describeSendError(err)).toBe("E_FUTURE_THING: something new");
  });

  it("handles a plain Error", () => {
    expect(describeSendError(new Error("Resend 401: bad key"))).toBe("Resend 401: bad key");
  });

  it("handles something that isn't an Error at all", () => {
    expect(describeSendError("just a string")).toBe("just a string");
    expect(describeSendError(null)).toBe("null");
  });

  it("never returns an empty string", () => {
    // Whatever this returns is the entire record of why a message never
    // arrived. Blank is the one unacceptable answer.
    for (const input of [new Error(""), null, undefined, {}, 0]) {
      expect(describeSendError(input).length).toBeGreaterThan(0);
    }
  });
});

describe("textToHtml", () => {
  it("escapes markup so a member's note can't inject any", () => {
    expect(textToHtml("<script>alert(1)</script>")).not.toContain("<script>");
  });

  it("links bare URLs", () => {
    expect(textToHtml("Pay here: https://example.test/x")).toContain(
      '<a href="https://example.test/x"',
    );
  });
});
