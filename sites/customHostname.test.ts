import { describe, it, expect, vi, afterEach } from "vitest";
import {
  configured,
  cnameTarget,
  createCustomHostname,
  getCustomHostname,
  deleteCustomHostname,
  recheckCustomHostname,
  statusExplanation,
  type HostnameEnv,
} from "./customHostname";

const LIVE: HostnameEnv = {
  CF_API_TOKEN: "token",
  CF_ZONE_ID: "zone",
  APP_URL: "https://sodalitas.jer-f84.workers.dev",
};
const DARK: HostnameEnv = { APP_URL: "https://sodalitas.jer-f84.workers.dev" };

function stubFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  });
  return calls;
}

const cfHostname = (over: Record<string, unknown> = {}) => ({
  success: true,
  result: {
    id: "ch_1",
    hostname: "www.example.org",
    status: "pending",
    verification_errors: ["custom hostname does not CNAME to this zone."],
    ownership_verification: { name: "_cf-custom-hostname.www.example.org", value: "abc-123" },
    ssl: { status: "pending_validation", validation_records: [] },
    ...over,
  },
});

afterEach(() => vi.unstubAllGlobals());

describe("configuration", () => {
  it("needs both a token and a zone", () => {
    expect(configured(LIVE)).toBe(true);
    expect(configured(DARK)).toBe(false);
    expect(configured({ ...DARK, CF_API_TOKEN: "t" })).toBe(false);
  });

  it("falls back to the app's own hostname for the CNAME target", () => {
    expect(cnameTarget(DARK)).toBe("sodalitas.jer-f84.workers.dev");
    expect(cnameTarget({ ...DARK, SITE_CNAME_TARGET: "sites.sodalitas.app" })).toBe(
      "sites.sodalitas.app",
    );
    expect(cnameTarget({ APP_URL: "not a url" })).toBe("sodalitas.app");
  });
});

describe("running dark", () => {
  it("never calls out, and says something a club can live with", async () => {
    const calls = stubFetch(200, cfHostname());
    const result = await createCustomHostname(DARK, "www.example.org");
    expect(calls).toHaveLength(0);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.dark).toBe(true);
      expect(result.message).toContain("saved");
    }
  });

  it("treats deleting as done, so removing a domain still works", async () => {
    const calls = stubFetch(200, { success: true });
    expect(await deleteCustomHostname(DARK, "ch_1")).toEqual({ ok: true });
    expect(calls).toHaveLength(0);
  });
});

describe("createCustomHostname", () => {
  it("asks for a DV certificate over HTTP validation by default", async () => {
    const calls = stubFetch(200, cfHostname());
    await createCustomHostname(LIVE, "www.example.org");

    expect(calls[0]!.url).toBe("https://api.cloudflare.com/client/v4/zones/zone/custom_hostnames");
    expect(calls[0]!.init.method).toBe("POST");
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body.hostname).toBe("www.example.org");
    expect(body.ssl.method).toBe("http");
    expect(body.ssl.type).toBe("dv");
    expect(body.ssl.settings.min_tls_version).toBe("1.2");
  });

  it("carries the token as a bearer, never in the URL", async () => {
    const calls = stubFetch(200, cfHostname());
    await createCustomHostname(LIVE, "www.example.org");
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer token");
    expect(calls[0]!.url).not.toContain("token");
  });

  it("normalises the pending answer into something a screen can render", async () => {
    stubFetch(200, cfHostname());
    const result = await createCustomHostname(LIVE, "www.example.org");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.record).toMatchObject({
      cfId: "ch_1",
      hostname: "www.example.org",
      status: "pending",
      cfStatus: "pending",
      sslStatus: "pending_validation",
      ownership: { name: "_cf-custom-hostname.www.example.org", value: "abc-123" },
      dcv: null,
    });
    expect(result.record.errors[0]).toContain("CNAME");
  });

  it("only calls it active when both the hostname and the certificate are", async () => {
    stubFetch(200, cfHostname({ status: "active", ssl: { status: "active" } }));
    const live = await createCustomHostname(LIVE, "www.example.org");
    expect(live.ok && live.record.status).toBe("active");

    stubFetch(200, cfHostname({ status: "active", ssl: { status: "pending_validation" } }));
    const half = await createCustomHostname(LIVE, "www.example.org");
    expect(half.ok && half.record.status).toBe("pending");
  });

  it("reports a blocked hostname as an error, not as pending forever", async () => {
    stubFetch(200, cfHostname({ status: "blocked" }));
    const result = await createCustomHostname(LIVE, "www.example.org");
    expect(result.ok && result.record.status).toBe("error");
  });

  it("surfaces the DCV record on the TXT path", async () => {
    stubFetch(
      200,
      cfHostname({
        ssl: {
          status: "pending_validation",
          validation_records: [{ txt_name: "_acme-challenge.www.example.org", txt_value: "xyz" }],
        },
      }),
    );
    const result = await createCustomHostname(LIVE, "www.example.org", "txt");
    expect(result.ok && result.record.dcv).toEqual({
      name: "_acme-challenge.www.example.org",
      value: "xyz",
    });
  });

  it("translates the one error a club will actually hit", async () => {
    stubFetch(400, {
      success: false,
      errors: [{ code: 1406, message: "workers.api.error.duplicate_custom_hostname_found" }],
    });
    const result = await createCustomHostname(LIVE, "www.example.org");
    expect(result.ok).toBe(false);
    if (!result.ok && !result.dark) {
      expect(result.message).toContain("already registered");
      expect(result.retryable).toBe(false);
    }
  });

  it("passes an untranslated error through verbatim", async () => {
    stubFetch(400, { success: false, errors: [{ code: 9999, message: "CAA record forbids issuance" }] });
    const result = await createCustomHostname(LIVE, "www.example.org");
    expect(result.ok).toBe(false);
    if (!result.ok && !result.dark) expect(result.message).toBe("CAA record forbids issuance");
  });

  it("marks a 5xx retryable and a 4xx not", async () => {
    stubFetch(503, { success: false, errors: [{ message: "upstream" }] });
    const down = await createCustomHostname(LIVE, "www.example.org");
    expect(!down.ok && !down.dark && down.retryable).toBe(true);

    stubFetch(400, { success: false, errors: [{ message: "bad hostname" }] });
    const bad = await createCustomHostname(LIVE, "www.example.org");
    expect(!bad.ok && !bad.dark && bad.retryable).toBe(false);
  });

  it("survives a network failure without throwing", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("connect ETIMEDOUT");
    });
    const result = await createCustomHostname(LIVE, "www.example.org");
    expect(result.ok).toBe(false);
    if (!result.ok && !result.dark) {
      expect(result.retryable).toBe(true);
      expect(result.message).toContain("ETIMEDOUT");
    }
  });

  it("survives a response that isn't JSON", async () => {
    vi.stubGlobal("fetch", async () => new Response("<html>502</html>", { status: 502 }));
    const result = await createCustomHostname(LIVE, "www.example.org");
    expect(result.ok).toBe(false);
    if (!result.ok && !result.dark) expect(result.retryable).toBe(true);
  });
});

describe("the other three calls", () => {
  it("reads one back", async () => {
    const calls = stubFetch(200, cfHostname());
    await getCustomHostname(LIVE, "ch_1");
    expect(calls[0]!.url).toContain("/custom_hostnames/ch_1");
    expect(calls[0]!.init.method).toBeUndefined();
  });

  it("deletes, and treats an already-gone hostname as success", async () => {
    stubFetch(404, { success: false, errors: [{ message: "Not Found" }] });
    expect(await deleteCustomHostname(LIVE, "ch_1")).toEqual({ ok: true });

    stubFetch(403, { success: false, errors: [{ message: "Forbidden" }] });
    expect((await deleteCustomHostname(LIVE, "ch_1")).ok).toBe(false);
  });

  it("re-checks by PATCHing the same values", async () => {
    const calls = stubFetch(200, cfHostname());
    await recheckCustomHostname(LIVE, "ch_1");
    expect(calls[0]!.init.method).toBe("PATCH");
    expect(JSON.parse(String(calls[0]!.init.body)).ssl).toEqual({ method: "http", type: "dv" });
  });

  it("escapes the id rather than pasting it into a path", async () => {
    const calls = stubFetch(200, cfHostname());
    await getCustomHostname(LIVE, "../../zones/other");
    expect(calls[0]!.url).not.toContain("../..");
  });
});

describe("statusExplanation", () => {
  it("distinguishes waiting for the club from waiting for the internet", () => {
    const waitingOnDns = statusExplanation({
      status: "pending",
      cfStatus: "pending",
      sslStatus: "pending_validation",
    });
    const waitingOnCert = statusExplanation({
      status: "pending",
      cfStatus: "active",
      sslStatus: "pending_validation",
    });
    expect(waitingOnDns).toContain("registrar");
    expect(waitingOnCert).toContain("certificate");
    expect(waitingOnDns).not.toBe(waitingOnCert);
  });

  it("names the usual culprit when it has failed", () => {
    expect(statusExplanation({ status: "error", cfStatus: "blocked", sslStatus: "" })).toContain("CAA");
  });
});
