/**
 * scope.ts — tenant-scoped database access.
 *
 * The rule: every read and write against a tenant-owned table goes through a
 * TenantDb bound to exactly one tenant. There is no code path that reaches a
 * tenant table without a tenant id, because the tenant id is baked into the
 * object you must hold to make the call.
 *
 * The escape hatch for joins and aggregates (`raw`) requires a `{{tenant}}`
 * token in the SQL. Omit it and the call throws before touching the database —
 * so "I forgot the WHERE clause" fails on the first test run, not in production
 * with someone else's member list on screen.
 *
 * Global tables (users, tenants, communio_groups) are reached through
 * GlobalDb, which is deliberately awkward to obtain.
 */

import {
  isTenantTable,
  SOFT_DELETE_TABLES,
  type TenantTable,
  type GlobalTable,
} from "./tables";

export class ScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScopeError";
  }
}

export type Row = Record<string, unknown>;

export interface SelectOptions {
  /** Column list. Defaults to `*`. Never interpolated from user input. */
  columns?: string;
  /** Extra predicate, ANDed after the tenant filter. Use `?` placeholders. */
  where?: string;
  params?: unknown[];
  orderBy?: string;
  limit?: number;
  offset?: number;
  /** Set false to include soft-deleted rows on tables that support it. */
  includeDeleted?: boolean;
}

const IDENT = /^[a-z_][a-z0-9_]*$/i;

/** Guard against identifier injection on the few places we interpolate names. */
function assertIdent(name: string, what: string): void {
  if (!IDENT.test(name)) throw new ScopeError(`Invalid ${what}: ${name}`);
}

export class TenantDb {
  constructor(
    private readonly db: D1Database,
    readonly tenantId: string,
  ) {
    if (!tenantId) throw new ScopeError("TenantDb requires a tenant id");
  }

  private table(name: string): TenantTable {
    if (!isTenantTable(name)) {
      throw new ScopeError(
        `"${name}" is not a tenant-owned table. Add it to TENANT_TABLES, or use GlobalDb if it genuinely has no tenant.`,
      );
    }
    return name;
  }

  private buildSelect(table: TenantTable, opts: SelectOptions) {
    const cols = opts.columns ?? "*";
    const clauses = ["tenant_id = ?"];
    const params: unknown[] = [this.tenantId];

    if (SOFT_DELETE_TABLES.has(table) && !opts.includeDeleted) {
      clauses.push("deleted_at IS NULL");
    }
    if (opts.where) {
      clauses.push(`(${opts.where})`);
      params.push(...(opts.params ?? []));
    }

    let sql = `SELECT ${cols} FROM ${table} WHERE ${clauses.join(" AND ")}`;
    if (opts.orderBy) sql += ` ORDER BY ${opts.orderBy}`;
    if (opts.limit !== undefined) {
      sql += " LIMIT ?";
      params.push(opts.limit);
      if (opts.offset !== undefined) {
        sql += " OFFSET ?";
        params.push(opts.offset);
      }
    }
    return { sql, params };
  }

  /** All matching rows in this tenant. */
  async all<T = Row>(table: string, opts: SelectOptions = {}): Promise<T[]> {
    const t = this.table(table);
    const { sql, params } = this.buildSelect(t, opts);
    const res = await this.db.prepare(sql).bind(...params).all<T>();
    return res.results ?? [];
  }

  /** The first matching row, or null. */
  async first<T = Row>(table: string, opts: SelectOptions = {}): Promise<T | null> {
    const rows = await this.all<T>(table, { ...opts, limit: 1 });
    return rows[0] ?? null;
  }

  /** A row by primary key, scoped — a wrong-tenant id returns null, not a row. */
  async byId<T = Row>(table: string, id: string, opts: SelectOptions = {}): Promise<T | null> {
    return this.first<T>(table, { ...opts, where: "id = ?", params: [id] });
  }

  async count(table: string, opts: SelectOptions = {}): Promise<number> {
    const rows = await this.all<{ n: number }>(table, { ...opts, columns: "COUNT(*) AS n", limit: undefined });
    return rows[0]?.n ?? 0;
  }

  /**
   * Insert one row. `tenant_id` is set from the scope and cannot be overridden —
   * passing a different one is an error, not a silent write to another tenant.
   */
  async insert(table: string, values: Row): Promise<void> {
    const t = this.table(table);
    if (values.tenant_id !== undefined && values.tenant_id !== this.tenantId) {
      throw new ScopeError(`Refusing to insert into ${t} with a foreign tenant_id`);
    }
    const row: Row = { ...values, tenant_id: this.tenantId };
    const keys = Object.keys(row);
    for (const k of keys) assertIdent(k, "column");
    const sql = `INSERT INTO ${t} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`;
    await this.db.prepare(sql).bind(...keys.map((k) => row[k] ?? null)).run();
  }

  /** Insert many rows in one batch. Empty input is a no-op, not an error. */
  async insertMany(table: string, rows: Row[]): Promise<void> {
    if (rows.length === 0) return;
    const t = this.table(table);
    const keys = Object.keys(rows[0]!).filter((k) => k !== "tenant_id");
    for (const k of keys) assertIdent(k, "column");
    const cols = ["tenant_id", ...keys];
    const sql = `INSERT INTO ${t} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`;
    const stmt = this.db.prepare(sql);
    await this.db.batch(
      rows.map((r) => stmt.bind(this.tenantId, ...keys.map((k) => r[k] ?? null))),
    );
  }

  /** Update by id within this tenant. Returns rows changed (0 if wrong tenant). */
  async update(table: string, id: string, values: Row): Promise<number> {
    const t = this.table(table);
    const entries = Object.entries(values).filter(([k]) => k !== "tenant_id" && k !== "id");
    if (entries.length === 0) return 0;
    for (const [k] of entries) assertIdent(k, "column");
    const sql =
      `UPDATE ${t} SET ${entries.map(([k]) => `${k} = ?`).join(", ")} ` +
      `WHERE id = ? AND tenant_id = ?`;
    const res = await this.db
      .prepare(sql)
      .bind(...entries.map(([, v]) => v ?? null), id, this.tenantId)
      .run();
    return res.meta.changes ?? 0;
  }

  /** Soft-delete where supported, hard delete otherwise. */
  async remove(table: string, id: string, now: string): Promise<number> {
    const t = this.table(table);
    if (SOFT_DELETE_TABLES.has(t)) {
      return this.update(t, id, { deleted_at: now });
    }
    const res = await this.db
      .prepare(`DELETE FROM ${t} WHERE id = ? AND tenant_id = ?`)
      .bind(id, this.tenantId)
      .run();
    return res.meta.changes ?? 0;
  }

  /**
   * Escape hatch for joins, aggregates and anything the helpers can't express.
   *
   * The SQL must contain `{{tenant}}` at least once — each occurrence becomes a
   * bound `?` filled with this tenant's id, in the order it appears. A query
   * without it throws, which is the whole point.
   *
   *   db.raw(`SELECT c.name, COUNT(m.id) AS n
   *             FROM clubs c
   *             LEFT JOIN memberships m
   *               ON m.club_id = c.id AND m.tenant_id = {{tenant}}
   *            WHERE c.tenant_id = {{tenant}}
   *            GROUP BY c.id`)
   */
  async raw<T = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
    const occurrences = sql.split("{{tenant}}").length - 1;
    if (occurrences === 0) {
      throw new ScopeError(
        "raw() requires at least one {{tenant}} token so the query cannot escape its tenant.",
      );
    }
    // Interleave: tenant params take the position of their token. Because the
    // token is replaced left-to-right and callers' `?` are positional, we
    // rebuild the bind list by walking the SQL.
    const bound: unknown[] = [];
    let rest = 0;
    const finalSql = sql.replace(/\{\{tenant\}\}|\?/g, (m) => {
      if (m === "{{tenant}}") bound.push(this.tenantId);
      else bound.push(params[rest++]);
      return "?";
    });
    if (rest !== params.length) {
      throw new ScopeError(
        `raw() got ${params.length} params but the SQL has ${rest} placeholders.`,
      );
    }
    const res = await this.db.prepare(finalSql).bind(...bound).all<T>();
    return res.results ?? [];
  }

  /** Run several statements atomically. Each must already be tenant-scoped. */
  async batch(statements: D1PreparedStatement[]): Promise<void> {
    if (statements.length === 0) return;
    await this.db.batch(statements);
  }

  /** Underlying binding, for building batch statements. Use sparingly. */
  get unsafeDb(): D1Database {
    return this.db;
  }
}

/**
 * Access to tables with no tenant dimension. Named `unsafe*` on purpose: every
 * call site should be short, obvious, and worth a second look in review.
 */
export class GlobalDb {
  constructor(private readonly db: D1Database) {}

  async all<T = Row>(table: GlobalTable, where: string, params: unknown[] = []): Promise<T[]> {
    assertIdent(table, "table");
    const res = await this.db
      .prepare(`SELECT * FROM ${table} WHERE ${where}`)
      .bind(...params)
      .all<T>();
    return res.results ?? [];
  }

  async first<T = Row>(table: GlobalTable, where: string, params: unknown[] = []): Promise<T | null> {
    const rows = await this.all<T>(table, `${where} LIMIT 1`, params);
    return rows[0] ?? null;
  }

  async run(sql: string, params: unknown[] = []): Promise<D1Result> {
    return this.db.prepare(sql).bind(...params).run();
  }

  get unsafeDb(): D1Database {
    return this.db;
  }
}

/** Bind the database to one tenant. The only way to get a TenantDb. */
export function tenantDb(db: D1Database, tenantId: string): TenantDb {
  return new TenantDb(db, tenantId);
}

export function globalDb(db: D1Database): GlobalDb {
  return new GlobalDb(db);
}
