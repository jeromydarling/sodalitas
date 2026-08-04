/**
 * demo-guard.test.ts — the rule that keeps an open demo from being an open relay.
 *
 * Anyone on the internet can sign in to the demo club. That makes every action
 * reaching outside it — inviting an officer by email, taking a card payment,
 * posting into Communio groups that real clubs read — something a stranger can
 * fire at will. These tests pin the guard's behaviour and, more usefully, the
 * shape of what it throws: a Response, not an Error, because a thrown Error in
 * a loader surfaces as a 500 and tells a curious visitor the product is broken.
 */
import { describe, it, expect } from "vitest";
import { requireNotDemo, canLeaveDemo, type RequestContext } from "./context";

const ctx = (isDemo: boolean) => ({ isDemo }) as RequestContext;

describe("requireNotDemo", () => {
  it("lets a real tenant through", () => {
    expect(() => requireNotDemo(ctx(false), "Inviting an officer")).not.toThrow();
  });

  it("stops the demo", () => {
    expect(() => requireNotDemo(ctx(true), "Inviting an officer")).toThrow();
  });

  it("throws a Response rather than an Error", async () => {
    // A bare Error in a loader becomes a 500 — "the product is broken" rather
    // than "that one thing is off in here".
    try {
      requireNotDemo(ctx(true), "Inviting an officer");
      expect.unreachable("should have thrown");
    } catch (thrown) {
      expect(thrown).toBeInstanceOf(Response);
      const res = thrown as Response;
      expect(res.status).toBe(403);
      const body = await res.text();
      // Names the action, so the message is specific rather than generic.
      expect(body).toContain("Inviting an officer");
      // And says what still works, because a dead end teaches somebody the
      // demo is broken rather than deliberately fenced.
      expect(body).toMatch(/resets overnight/i);
      expect(body).toMatch(/add members|record a meeting/i);
    }
  });

  it("names whichever action was passed", async () => {
    for (const action of ["Taking a card payment", "Posting to Communio"]) {
      try {
        requireNotDemo(ctx(true), action);
        expect.unreachable("should have thrown");
      } catch (thrown) {
        expect(await (thrown as Response).text()).toContain(action);
      }
    }
  });

  it("treats a missing flag as not-demo", () => {
    // Defensive rather than load-bearing: the flag is always set by build().
    // Erring open here is correct because the email layer fails closed — see
    // isDemoTenant in emails/send.ts, which refuses to send when it can't tell.
    expect(() => requireNotDemo({} as RequestContext, "Anything")).not.toThrow();
  });
});

describe("canLeaveDemo", () => {
  it("mirrors the guard, for hiding a control that would only fail", () => {
    expect(canLeaveDemo(ctx(false))).toBe(true);
    expect(canLeaveDemo(ctx(true))).toBe(false);
  });
});
