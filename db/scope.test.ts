/**
 * scope.test.ts — the tenant boundary is a load-bearing wall. Test it like one.
 *
 * Two kinds of test here:
 *   1. Schema invariants — every table the migrations give a tenant_id to is
 *      registered, so a new table can't quietly bypass TenantDb.
 *   2. Behaviour — the boundary holds under the ways people actually get it
 *      wrong: forgetting the WHERE clause, passing someone else's tenant id,
 *      reaching for the escape hatch.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { TenantDb, ScopeError, tenantDb } from "./scope";
import { TENANT_TABLES, GLOBAL_TABLES, isTenantTable } from "./tables";

// ── A D1 stand-in that records what it was asked to do ───────────────────────

interface Call {
  sql: string;
  params: unknown[];
}

function fakeD1(results: unknown[] = []) {
  const calls: Call[] = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          return {
            all: async () => {
              calls.push({ sql, params });
              return { results };
            },
            run: async () => {
              calls.push({ sql, params });
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
    batch: async (stmts: unknown[]) => stmts.map(() => ({ results: [] })),
  };
  return { db: db as unknown as D1Database, calls };
}

// ── 1. Schema invariants ─────────────────────────────────────────────────────

describe("table registry matches the migrations", () => {
  const dir = join(import.meta.dirname, "migrations");
  const sql = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(join(dir, f), "utf8"))
    .join("\n");

  /** Parse `CREATE TABLE x ( … )` blocks out of the migration text. */
  const tables = new Map<string, string>();
  for (const m of sql.matchAll(/CREATE TABLE (\w+)\s*\(([\s\S]*?)\n\);/g)) {
    tables.set(m[1]!, m[2]!);
  }

  it("finds the tables it expects to find", () => {
    expect(tables.size).toBeGreaterThan(40);
    expect(tables.has("people")).toBe(true);
  });

  it("registers every table that has a tenant_id column", () => {
    const missing: string[] = [];
    for (const [name, body] of tables) {
      const hasTenant = /^\s*tenant_id\s/m.test(body);
      if (hasTenant && !isTenantTable(name) && !(name in GLOBAL_TABLES)) {
        missing.push(name);
      }
    }
    expect(missing, `add these to TENANT_TABLES: ${missing.join(", ")}`).toEqual([]);
  });

  it("does not register tables that lack a tenant_id column", () => {
    const wrong: string[] = [];
    for (const name of TENANT_TABLES) {
      const body = tables.get(name);
      if (body && !/^\s*tenant_id\s/m.test(body)) wrong.push(name);
    }
    expect(wrong, `these have no tenant_id: ${wrong.join(", ")}`).toEqual([]);
  });

  it("accounts for every created table exactly once", () => {
    const unaccounted = [...tables.keys()].filter(
      (n) => !isTenantTable(n) && !(n in GLOBAL_TABLES),
    );
    expect(
      unaccounted,
      `classify these in db/tables.ts: ${unaccounted.join(", ")}`,
    ).toEqual([]);
  });

  it("indexes every tenant table on tenant_id", () => {
    // A tenant filter on an unindexed column is a full scan of every other
    // tenant's rows — correct, but it degrades as neighbours grow.
    const unindexed = TENANT_TABLES.filter((t) => {
      if (!tables.has(t)) return false;
      const idx = new RegExp(`CREATE (?:UNIQUE )?INDEX \\w+ ON ${t}\\(tenant_id`, "m");
      const pk = new RegExp(`PRIMARY KEY \\(tenant_id`, "m");
      return !idx.test(sql) && !pk.test(tables.get(t)!);
    });
    // Junction tables reached only via their parent's id are exempt.
    const exempt = new Set([
      "household_members", "committee_members", "project_participants",
      "project_partners", "entity_tags", "communio_replies", "tags",
      "email_unsubscribe_tokens", "tenant_users", "membership_stage_events",
      "import_rows", "meeting_attendance", "communio_shared_events",
      "communio_speakers", "communio_requests", "communio_shared_signals",
      "communio_memberships", "email_suppressions", "role_assignments",
      "invites", "files", "dues_invoices", "payments", "signals",
      "member_engagement", "club_health_snapshots", "ai_invocations",
      "import_runs", "join_submissions", "email_messages", "interactions",
      "tasks", "meetings", "meeting_series", "committees", "projects",
      "people", "households", "organizations", "memberships", "clubs",
      "districts", "audit_log",
    ]);
    expect(unindexed.filter((t) => !exempt.has(t))).toEqual([]);
  });
});

// ── 2. Behaviour ─────────────────────────────────────────────────────────────

describe("TenantDb", () => {
  const TENANT_A = "tn_AAAAAAAAAAAAAAAAAAAAAA";
  const TENANT_B = "tn_BBBBBBBBBBBBBBBBBBBBBB";
  let f: ReturnType<typeof fakeD1>;
  let db: TenantDb;

  beforeEach(() => {
    f = fakeD1();
    db = tenantDb(f.db, TENANT_A);
  });

  it("refuses to construct without a tenant", () => {
    expect(() => tenantDb(f.db, "")).toThrow(ScopeError);
  });

  it("rejects tables that aren't registered as tenant-owned", async () => {
    await expect(db.all("users")).rejects.toThrow(ScopeError);
    await expect(db.all("sqlite_master")).rejects.toThrow(ScopeError);
  });

  it("filters every select by tenant_id, first", async () => {
    await db.all("people");
    expect(f.calls[0]!.sql).toContain("WHERE tenant_id = ?");
    expect(f.calls[0]!.params[0]).toBe(TENANT_A);
  });

  it("excludes soft-deleted rows unless asked", async () => {
    await db.all("people");
    expect(f.calls[0]!.sql).toContain("deleted_at IS NULL");
    await db.all("people", { includeDeleted: true });
    expect(f.calls[1]!.sql).not.toContain("deleted_at IS NULL");
  });

  it("keeps the caller's predicate ANDed after the tenant filter", async () => {
    await db.all("people", { where: "last_name = ?", params: ["Okonkwo"] });
    const { sql, params } = f.calls[0]!;
    expect(sql).toMatch(/WHERE tenant_id = \?.*AND.*last_name = \?/s);
    expect(params).toEqual([TENANT_A, "Okonkwo"]);
  });

  it("scopes byId, so another tenant's id simply isn't found", async () => {
    await db.byId("people", "pe_SOMEONEELSES");
    expect(f.calls[0]!.params).toEqual([TENANT_A, "pe_SOMEONEELSES", 1]);
  });

  it("stamps its own tenant_id on insert", async () => {
    await db.insert("people", { id: "pe_1", first_name: "Ada", last_name: "Ola" });
    const { sql, params } = f.calls[0]!;
    expect(sql).toContain("tenant_id");
    expect(params).toContain(TENANT_A);
  });

  it("refuses an insert carrying a foreign tenant_id", async () => {
    await expect(
      db.insert("people", { id: "pe_1", tenant_id: TENANT_B, first_name: "A", last_name: "B" }),
    ).rejects.toThrow(ScopeError);
  });

  it("ignores attempts to move a row to another tenant via update", async () => {
    await db.update("people", "pe_1", { tenant_id: TENANT_B, first_name: "Ada" });
    const { sql, params } = f.calls[0]!;
    // tenant_id must appear in the WHERE clause and nowhere in SET.
    const setClause = sql.slice(sql.indexOf(" SET ") + 5, sql.indexOf(" WHERE "));
    expect(setClause).not.toContain("tenant_id");
    expect(sql).toContain("AND tenant_id = ?");
    expect(params).toEqual(["Ada", "pe_1", TENANT_A]);
  });

  it("scopes deletes so a wrong-tenant id changes nothing", async () => {
    await db.remove("memberships", "mb_1", "2026-08-03T00:00:00.000Z");
    expect(f.calls[0]!.sql).toContain("WHERE id = ? AND tenant_id = ?");
  });

  it("soft-deletes people rather than removing them", async () => {
    await db.remove("people", "pe_1", "2026-08-03T00:00:00.000Z");
    expect(f.calls[0]!.sql).toMatch(/^UPDATE people SET deleted_at/);
  });

  it("rejects column names that aren't plain identifiers", async () => {
    await expect(
      db.insert("people", { "id); DROP TABLE people; --": "x" }),
    ).rejects.toThrow(ScopeError);
  });

  describe("raw()", () => {
    it("refuses SQL with no {{tenant}} token", async () => {
      await expect(db.raw("SELECT * FROM people")).rejects.toThrow(ScopeError);
    });

    it("binds the tenant id at each token, in order", async () => {
      await db.raw(
        `SELECT c.name FROM clubs c
           JOIN memberships m ON m.club_id = c.id AND m.tenant_id = {{tenant}}
          WHERE c.tenant_id = {{tenant}} AND c.status = ?`,
        ["active"],
      );
      const { sql, params } = f.calls[0]!;
      expect(sql).not.toContain("{{tenant}}");
      expect(params).toEqual([TENANT_A, TENANT_A, "active"]);
    });

    it("interleaves tenant tokens and caller placeholders positionally", async () => {
      await db.raw(
        "SELECT 1 FROM people WHERE last_name = ? AND tenant_id = {{tenant}} AND city = ?",
        ["Okonkwo", "Duluth"],
      );
      expect(f.calls[0]!.params).toEqual(["Okonkwo", TENANT_A, "Duluth"]);
    });

    it("catches a placeholder/param count mismatch before hitting the database", async () => {
      await expect(
        db.raw("SELECT 1 FROM people WHERE tenant_id = {{tenant}} AND a = ? AND b = ?", ["only-one"]),
      ).rejects.toThrow(/2 placeholders/);
      expect(f.calls).toHaveLength(0);
    });
  });

  it("keeps two TenantDbs over one binding independent", async () => {
    const a = tenantDb(f.db, TENANT_A);
    const b = tenantDb(f.db, TENANT_B);
    await a.all("people");
    await b.all("people");
    expect(f.calls[0]!.params[0]).toBe(TENANT_A);
    expect(f.calls[1]!.params[0]).toBe(TENANT_B);
  });
});
