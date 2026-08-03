import { describe, it, expect } from "vitest";
import {
  encodeForm,
  parseSignatureHeader,
  verifyWebhook,
  signPayload,
  SignatureError,
  paymentsConfigured,
  connectConfigured,
  webhooksConfigured,
  connectAuthorizeUrl,
  StripeNotConfigured,
  SIGNATURE_TOLERANCE_SEC,
} from "./stripe";

const SECRET = "whsec_test_do_not_use_anywhere";

describe("encodeForm", () => {
  it("encodes flat values", () => {
    expect(encodeForm({ mode: "payment", amount: 500 })).toEqual([
      "mode=payment",
      "amount=500",
    ]);
  });

  it("encodes nested objects in bracket form", () => {
    expect(encodeForm({ metadata: { invoice_id: "iv_1" } })).toEqual([
      "metadata%5Binvoice_id%5D=iv_1",
    ]);
  });

  it("encodes arrays of objects with indices", () => {
    const out = encodeForm({ line_items: [{ quantity: 1, price_data: { currency: "usd" } }] });
    expect(out).toContain("line_items%5B0%5D%5Bquantity%5D=1");
    expect(out).toContain("line_items%5B0%5D%5Bprice_data%5D%5Bcurrency%5D=usd");
  });

  it("encodes arrays of scalars", () => {
    expect(encodeForm({ expand: ["a", "b"] })).toEqual([
      "expand%5B0%5D=a",
      "expand%5B1%5D=b",
    ]);
  });

  it("drops undefined and null rather than sending them as strings", () => {
    // Sending "undefined" as metadata is the sort of thing that survives to
    // production and confuses somebody a year later.
    expect(encodeForm({ a: undefined, b: null, c: 1 })).toEqual(["c=1"]);
  });

  it("sends booleans the way Stripe expects", () => {
    expect(encodeForm({ enabled: true, off: false })).toEqual(["enabled=true", "off=false"]);
  });

  it("escapes values that would otherwise break the body", () => {
    expect(encodeForm({ name: "Dues & fees" })).toEqual(["name=Dues%20%26%20fees"]);
  });

  it("keeps zero, which is falsy but meaningful", () => {
    expect(encodeForm({ amount: 0 })).toEqual(["amount=0"]);
  });
});

describe("parseSignatureHeader", () => {
  it("pulls out the timestamp and signature", () => {
    const p = parseSignatureHeader("t=1710000000,v1=abcdef");
    expect(p.timestamp).toBe(1710000000);
    expect(p.signatures).toEqual(["abcdef"]);
  });

  it("collects several v1 values, as sent during a secret rotation", () => {
    const p = parseSignatureHeader("t=1,v1=aaa,v1=bbb,v0=ignored");
    expect(p.signatures).toEqual(["aaa", "bbb"]);
  });

  it("survives junk", () => {
    const p = parseSignatureHeader("nonsense");
    expect(p.timestamp).toBe(0);
    expect(p.signatures).toEqual([]);
  });
});

describe("verifyWebhook", () => {
  const body = JSON.stringify({ id: "evt_1", type: "checkout.session.completed", data: {} });
  const now = 1_710_000_000;

  it("accepts a correctly signed payload", async () => {
    const header = await signPayload(body, SECRET, now);
    const event = await verifyWebhook(body, header, SECRET, now);
    expect(event.id).toBe("evt_1");
    expect(event.type).toBe("checkout.session.completed");
  });

  it("rejects a payload whose body was altered by one character", async () => {
    const header = await signPayload(body, SECRET, now);
    const tampered = body.replace("evt_1", "evt_2");
    await expect(verifyWebhook(tampered, header, SECRET, now)).rejects.toThrow(SignatureError);
  });

  it("rejects the wrong secret", async () => {
    const header = await signPayload(body, SECRET, now);
    await expect(verifyWebhook(body, header, "whsec_other", now)).rejects.toThrow(SignatureError);
  });

  it("rejects a replay from outside the tolerance window", async () => {
    const header = await signPayload(body, SECRET, now);
    const muchLater = now + SIGNATURE_TOLERANCE_SEC + 1;
    await expect(verifyWebhook(body, header, SECRET, muchLater)).rejects.toThrow(
      /tolerance/i,
    );
  });

  it("accepts one right at the edge of the window", async () => {
    const header = await signPayload(body, SECRET, now);
    const atEdge = now + SIGNATURE_TOLERANCE_SEC;
    await expect(verifyWebhook(body, header, SECRET, atEdge)).resolves.toBeTruthy();
  });

  it("rejects a timestamp from the future beyond tolerance", async () => {
    const header = await signPayload(body, SECRET, now + 10_000);
    await expect(verifyWebhook(body, header, SECRET, now)).rejects.toThrow(/tolerance/i);
  });

  it("accepts when one of several signatures matches", async () => {
    const good = await signPayload(body, SECRET, now);
    const sig = good.split("v1=")[1]!;
    const header = `t=${now},v1=${"0".repeat(64)},v1=${sig}`;
    await expect(verifyWebhook(body, header, SECRET, now)).resolves.toBeTruthy();
  });

  it("refuses when no secret is configured", async () => {
    // Fails closed. An unverified webhook endpoint is one where anyone can
    // mark a club's invoices paid.
    await expect(verifyWebhook(body, "t=1,v1=x", undefined, now)).rejects.toThrow(
      /no webhook secret/i,
    );
  });

  it("refuses a missing header", async () => {
    await expect(verifyWebhook(body, null, SECRET, now)).rejects.toThrow(SignatureError);
  });

  it("refuses a malformed header", async () => {
    await expect(verifyWebhook(body, "garbage", SECRET, now)).rejects.toThrow(/malformed/i);
  });

  it("refuses a signed body that isn't a Stripe event", async () => {
    const notAnEvent = JSON.stringify({ hello: "world" });
    const header = await signPayload(notAnEvent, SECRET, now);
    await expect(verifyWebhook(notAnEvent, header, SECRET, now)).rejects.toThrow(
      /not a stripe event/i,
    );
  });

  it("refuses a signed body that isn't JSON at all", async () => {
    const header = await signPayload("not json", SECRET, now);
    await expect(verifyWebhook("not json", header, SECRET, now)).rejects.toThrow(/not JSON/i);
  });

  it("verifies against the exact bytes, not a re-serialised object", async () => {
    // Whitespace is part of the signed payload. This is the mistake that
    // makes an otherwise-correct integration fail every single delivery.
    const spaced = JSON.stringify({ id: "evt_1", type: "x", data: {} }, null, 2);
    const header = await signPayload(spaced, SECRET, now);
    await expect(verifyWebhook(spaced, header, SECRET, now)).resolves.toBeTruthy();
    const compact = JSON.stringify(JSON.parse(spaced));
    await expect(verifyWebhook(compact, header, SECRET, now)).rejects.toThrow(SignatureError);
  });
});

describe("configuration flags", () => {
  const base = { APP_URL: "https://example.test" };

  it("reports each capability independently", () => {
    expect(paymentsConfigured(base)).toBe(false);
    expect(paymentsConfigured({ ...base, STRIPE_SECRET_KEY: "sk_test" })).toBe(true);

    // Connect needs both: a key to call the API and a client id to send the
    // treasurer to. Having only one is a half-configured deployment, and
    // reporting it as ready would produce a broken button.
    expect(connectConfigured({ ...base, STRIPE_SECRET_KEY: "sk_test" })).toBe(false);
    expect(connectConfigured({ ...base, STRIPE_CONNECT_CLIENT_ID: "ca_1" })).toBe(false);
    expect(
      connectConfigured({ ...base, STRIPE_SECRET_KEY: "sk_test", STRIPE_CONNECT_CLIENT_ID: "ca_1" }),
    ).toBe(true);

    expect(webhooksConfigured(base)).toBe(false);
    expect(webhooksConfigured({ ...base, STRIPE_WEBHOOK_SECRET: "whsec" })).toBe(true);
  });
});

describe("connectAuthorizeUrl", () => {
  const env = {
    APP_URL: "https://sodalitas.example",
    STRIPE_SECRET_KEY: "sk_test",
    STRIPE_CONNECT_CLIENT_ID: "ca_123",
  };

  it("builds an authorize URL with our return address", () => {
    const url = new URL(connectAuthorizeUrl(env, "state-token"));
    expect(url.origin + url.pathname).toBe("https://connect.stripe.com/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("ca_123");
    expect(url.searchParams.get("state")).toBe("state-token");
    expect(url.searchParams.get("scope")).toBe("read_write");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://sodalitas.example/api/stripe/connect/return",
    );
  });

  it("prefills what we already know", () => {
    const url = new URL(
      connectAuthorizeUrl(env, "s", { email: "treasurer@club.test", clubName: "Rotary Club of X" }),
    );
    expect(url.searchParams.get("stripe_user[email]")).toBe("treasurer@club.test");
    expect(url.searchParams.get("stripe_user[business_name]")).toBe("Rotary Club of X");
  });

  it("refuses when Connect isn't configured", () => {
    expect(() => connectAuthorizeUrl({ APP_URL: "https://x" }, "s")).toThrow(StripeNotConfigured);
  });
});
