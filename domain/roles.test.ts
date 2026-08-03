/**
 * roles.test.ts — authority resolution.
 *
 * The cases that matter are the ones Rotary actually produces: an Assistant
 * Governor who may read a club but not run it, a committee chair whose authority
 * stops at their own committee, and last year's president in July.
 */
import { describe, it, expect } from "vitest";
import {
  ROLES,
  CAPABILITIES,
  resolveAuthority,
  can,
  require as requireCap,
  Forbidden,
  rolesForScope,
  type Assignment,
} from "./roles";

const TODAY = "2026-08-03";
const CLUB_A = "cl_AAAAAAAAAAAAAAAAAAAAAA";
const CLUB_B = "cl_BBBBBBBBBBBBBBBBBBBBBB";
const DISTRICT = "di_DDDDDDDDDDDDDDDDDDDDDD";

function assign(over: Partial<Assignment> & Pick<Assignment, "role_key" | "scope_type">): Assignment {
  return { scope_id: null, extra_caps: "", starts_on: null, ends_on: null, ...over };
}

describe("role definitions", () => {
  it("only grants capabilities that exist", () => {
    const known = new Set<string>(CAPABILITIES);
    for (const role of Object.values(ROLES)) {
      for (const c of role.caps) {
        expect(known.has(c), `${role.key} grants unknown capability ${c}`).toBe(true);
      }
    }
  });

  it("keys match their record key, so lookups can't drift", () => {
    for (const [key, role] of Object.entries(ROLES)) expect(role.key).toBe(key);
  });

  it("gives every title a human label and a plain-language blurb", () => {
    for (const role of Object.values(ROLES)) {
      expect(role.label.length).toBeGreaterThan(2);
      expect(role.blurb.length).toBeGreaterThan(10);
      // Titles are what Rotarians see. No snake_case leaking into the UI.
      expect(role.label).not.toMatch(/_/);
    }
  });

  it("offers club titles for the club scope", () => {
    const keys = rolesForScope("club").map((r) => r.key);
    expect(keys).toContain("club_president");
    expect(keys).toContain("club_treasurer");
    expect(keys).not.toContain("district_governor");
  });

  it("marks annually-turning-over offices so we can prompt for an end date", () => {
    expect(ROLES.club_president!.annual).toBe(true);
    expect(ROLES.district_governor!.annual).toBe(true);
    expect(ROLES.member!.annual).toBeUndefined();
  });
});

describe("club authority", () => {
  const auth = resolveAuthority(
    [assign({ role_key: "club_president", scope_type: "club", scope_id: CLUB_A })],
    TODAY,
  );

  it("grants full authority over the president's own club", () => {
    expect(can(auth, "people.write", CLUB_A)).toBe(true);
    expect(can(auth, "membership.approve", CLUB_A)).toBe(true);
    expect(can(auth, "roles.assign", CLUB_A)).toBe(true);
  });

  it("grants nothing over a sibling club", () => {
    expect(can(auth, "people.read", CLUB_B)).toBe(false);
    expect(can(auth, "people.write", CLUB_B)).toBe(false);
  });

  it("does not give a club president district powers", () => {
    expect(can(auth, "district.write", CLUB_A)).toBe(false);
    expect(can(auth, "district.read", CLUB_A)).toBe(false);
  });

  it("reports the title for display", () => {
    expect(auth.titles[0]!.label).toBe("Club President");
  });
});

describe("treasurer", () => {
  const auth = resolveAuthority(
    [assign({ role_key: "club_treasurer", scope_type: "club", scope_id: CLUB_A })],
    TODAY,
  );

  it("can handle money", () => {
    expect(can(auth, "dues.write", CLUB_A)).toBe(true);
    expect(can(auth, "payments.settings", CLUB_A)).toBe(true);
  });

  it("cannot terminate a membership or reassign roles", () => {
    expect(can(auth, "membership.terminate", CLUB_A)).toBe(false);
    expect(can(auth, "roles.assign", CLUB_A)).toBe(false);
  });
});

describe("assistant governor", () => {
  const auth = resolveAuthority(
    [assign({ role_key: "assistant_governor", scope_type: "district", scope_id: DISTRICT })],
    TODAY,
  );

  it("reads into every club in the district", () => {
    expect(can(auth, "people.read", CLUB_A)).toBe(true);
    expect(can(auth, "people.read", CLUB_B)).toBe(true);
    expect(can(auth, "district.club_read", CLUB_A)).toBe(true);
  });

  it("can leave a task but cannot run the club", () => {
    expect(can(auth, "tasks.write", CLUB_A)).toBe(true);
    expect(can(auth, "people.write", CLUB_A)).toBe(false);
    expect(can(auth, "membership.terminate", CLUB_A)).toBe(false);
    expect(can(auth, "roles.assign", CLUB_A)).toBe(false);
  });

  it("is not a governor", () => {
    expect(can(auth, "district.write", CLUB_A)).toBe(false);
  });
});

describe("district governor", () => {
  const auth = resolveAuthority(
    [assign({ role_key: "district_governor", scope_type: "district", scope_id: DISTRICT })],
    TODAY,
  );

  it("cascades authority to every club", () => {
    expect(can(auth, "people.write", CLUB_A)).toBe(true);
    expect(can(auth, "people.write", CLUB_B)).toBe(true);
    expect(can(auth, "district.write", null)).toBe(true);
  });
});

describe("committee chair", () => {
  const auth = resolveAuthority(
    [assign({ role_key: "committee_chair", scope_type: "committee", scope_id: "cm_1" })],
    TODAY,
  );

  it("holds only the scoped *_own capabilities", () => {
    expect(can(auth, "committees.write_own", CLUB_A)).toBe(true);
    expect(can(auth, "projects.write_own", CLUB_A)).toBe(true);
  });

  it("cannot edit committees it does not chair", () => {
    expect(can(auth, "committees.write", CLUB_A)).toBe(false);
    expect(can(auth, "projects.write", CLUB_A)).toBe(false);
  });
});

describe("time-bounded assignments", () => {
  it("ignores an office whose term has ended — last July's president is done", () => {
    const auth = resolveAuthority(
      [assign({
        role_key: "club_president",
        scope_type: "club",
        scope_id: CLUB_A,
        starts_on: "2025-07-01",
        ends_on: "2026-06-30",
      })],
      TODAY, // 2026-08-03, five weeks after handover
    );
    expect(can(auth, "people.write", CLUB_A)).toBe(false);
    expect(auth.titles).toHaveLength(0);
  });

  it("ignores an office that has not started — the incoming president waits", () => {
    const auth = resolveAuthority(
      [assign({
        role_key: "club_president",
        scope_type: "club",
        scope_id: CLUB_A,
        starts_on: "2026-09-01",
      })],
      TODAY,
    );
    expect(can(auth, "people.write", CLUB_A)).toBe(false);
  });

  it("honours an open-ended assignment", () => {
    const auth = resolveAuthority(
      [assign({ role_key: "club_admin", scope_type: "club", scope_id: CLUB_A, starts_on: "2020-01-01" })],
      TODAY,
    );
    expect(can(auth, "people.write", CLUB_A)).toBe(true);
  });

  it("includes the boundary days themselves", () => {
    const a = assign({
      role_key: "club_president", scope_type: "club", scope_id: CLUB_A,
      starts_on: TODAY, ends_on: TODAY,
    });
    expect(can(resolveAuthority([a], TODAY), "people.write", CLUB_A)).toBe(true);
  });
});

describe("extra capabilities", () => {
  it("grants an à-la-carte capability without inventing a title", () => {
    const auth = resolveAuthority(
      [assign({
        role_key: "member",
        scope_type: "club",
        scope_id: CLUB_A,
        extra_caps: "email.send, email.templates",
      })],
      TODAY,
    );
    expect(can(auth, "email.send", CLUB_A)).toBe(true);
    expect(can(auth, "email.templates", CLUB_A)).toBe(true);
    expect(can(auth, "email.send_all", CLUB_A)).toBe(false);
  });

  it("silently ignores capabilities that don't exist", () => {
    const auth = resolveAuthority(
      [assign({ role_key: "member", scope_type: "club", scope_id: CLUB_A, extra_caps: "billing.everything,  " })],
      TODAY,
    );
    expect(auth.anyCaps.has("billing.manage")).toBe(false);
  });
});

describe("stacked assignments", () => {
  it("unions authority across several offices", () => {
    const auth = resolveAuthority(
      [
        assign({ role_key: "club_treasurer", scope_type: "club", scope_id: CLUB_A }),
        assign({ role_key: "membership_chair", scope_type: "club", scope_id: CLUB_B }),
      ],
      TODAY,
    );
    expect(can(auth, "dues.write", CLUB_A)).toBe(true);
    expect(can(auth, "dues.write", CLUB_B)).toBe(false);
    expect(can(auth, "membership.approve", CLUB_B)).toBe(true);
    expect(auth.readableClubs).toEqual(new Set([CLUB_A, CLUB_B]));
  });

  it("grants nothing for an unrecognised role key", () => {
    const auth = resolveAuthority(
      [assign({ role_key: "supreme_chancellor", scope_type: "club", scope_id: CLUB_A })],
      TODAY,
    );
    expect(auth.anyCaps.size).toBe(0);
    expect(auth.titles).toHaveLength(0);
  });

  it("gives an empty authority no powers at all", () => {
    const auth = resolveAuthority([], TODAY);
    for (const c of CAPABILITIES) expect(can(auth, c, CLUB_A)).toBe(false);
  });
});

describe("require()", () => {
  const auth = resolveAuthority(
    [assign({ role_key: "member", scope_type: "club", scope_id: CLUB_A })],
    TODAY,
  );

  it("passes silently when the capability is held", () => {
    expect(() => requireCap(auth, "people.read", CLUB_A)).not.toThrow();
  });

  it("throws Forbidden naming the capability and club", () => {
    try {
      requireCap(auth, "people.write", CLUB_A);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(Forbidden);
      expect((e as Forbidden).cap).toBe("people.write");
      expect((e as Forbidden).clubId).toBe(CLUB_A);
    }
  });
});
