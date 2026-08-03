/**
 * csv.ts — parsing what clubs actually export.
 *
 * Written by hand rather than pulled in as a dependency, because the parsing
 * isn't the hard part — the hard part is everything a real ClubRunner or DACdb
 * export does that a textbook CSV doesn't:
 *
 *   * A UTF-8 BOM, which turns the first header into "﻿First Name" and
 *     silently breaks every column mapping.
 *   * Excel's habit of saving CRLF, or a Mac exporting bare CR.
 *   * Quoted fields containing commas, newlines and doubled quotes.
 *   * Trailing blank lines, and rows with fewer cells than headers.
 *   * Duplicate header names, which would otherwise clobber each other.
 *
 * Every one of those has cost somebody an afternoon. They are all handled here
 * and all pinned in tests.
 */

export interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
  /** Anything the club should know about, phrased for a human. */
  warnings: string[];
}

const BOM = "﻿";

/**
 * Split CSV text into a grid. Handles quoted fields, embedded newlines,
 * doubled quotes, and all three line-ending conventions.
 */
export function parseCsvGrid(text: string): string[][] {
  const src = text.startsWith(BOM) ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < src.length) {
    const ch = src[i]!;

    if (inQuotes) {
      if (ch === '"') {
        // A doubled quote inside a quoted field is a literal quote.
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ",") {
      endField();
      i++;
      continue;
    }
    if (ch === "\r") {
      // CRLF or a bare CR from an old Mac export — both end the row.
      endRow();
      i += src[i + 1] === "\n" ? 2 : 1;
      continue;
    }
    if (ch === "\n") {
      endRow();
      i++;
      continue;
    }

    field += ch;
    i++;
  }

  // Whatever is left is the last row, unless the file ended on a newline.
  if (field !== "" || row.length > 0) endRow();

  return rows;
}

/** Parse into header-keyed records. */
export function parseCsv(text: string): ParsedCsv {
  const warnings: string[] = [];
  const grid = parseCsvGrid(text).filter((r) => !(r.length === 1 && r[0]!.trim() === ""));

  if (grid.length === 0) return { headers: [], rows: [], warnings: ["That file looks empty."] };

  const rawHeaders = grid[0]!.map((h) => h.trim());
  const headers: string[] = [];
  const seen = new Map<string, number>();

  for (const h of rawHeaders) {
    const name = h || "column";
    const count = seen.get(name) ?? 0;
    seen.set(name, count + 1);
    // Two columns called "Email" would otherwise silently become one.
    headers.push(count === 0 ? name : `${name} (${count + 1})`);
  }

  const dupes = [...seen.entries()].filter(([, n]) => n > 1).map(([h]) => h);
  if (dupes.length > 0) {
    warnings.push(
      `Your file has more than one column called ${dupes.map((d) => `"${d}"`).join(", ")}. We've numbered them so you can pick the right one.`,
    );
  }

  const rows: Record<string, string>[] = [];
  let short = 0;

  for (let r = 1; r < grid.length; r++) {
    const cells = grid[r]!;
    // A row of nothing but empty cells is a spacer, not data.
    if (cells.every((c) => c.trim() === "")) continue;
    if (cells.length < headers.length) short++;

    const record: Record<string, string> = {};
    headers.forEach((h, c) => {
      record[h] = (cells[c] ?? "").trim();
    });
    rows.push(record);
  }

  if (short > 0) {
    warnings.push(
      `${short} row${short === 1 ? " has" : "s have"} fewer columns than the header. We've treated the missing ones as blank.`,
    );
  }

  return { headers, rows, warnings };
}

// ── Column guessing ───────────────────────────────────────────────────────────

/** The fields an import can fill. */
export type ImportField =
  | "firstName"
  | "lastName"
  | "preferredName"
  | "email"
  | "phone"
  | "employer"
  | "jobTitle"
  | "classification"
  | "birthday"
  | "joinedRotaryOn"
  | "joinedClubOn"
  | "city"
  | "stateCode"
  | "notes"
  | "membershipType"
  | "stage";

export const FIELD_LABELS: Record<ImportField, string> = {
  firstName: "First name",
  lastName: "Last name",
  preferredName: "Preferred name",
  email: "Email",
  phone: "Phone",
  employer: "Employer",
  jobTitle: "Job title",
  classification: "Classification",
  birthday: "Birthday",
  joinedRotaryOn: "Joined Rotary",
  joinedClubOn: "Joined this club",
  city: "City",
  stateCode: "State",
  notes: "Notes",
  membershipType: "Membership type",
  stage: "Standing",
};

export const REQUIRED_FIELDS: ImportField[] = ["firstName", "lastName"];

/**
 * Header names seen in the wild, lowercased and stripped of punctuation.
 *
 * Built from what ClubRunner and DACdb actually emit rather than from what a
 * tidy schema would call things. Getting the mapping right on the first try is
 * the difference between a five-minute migration and an afternoon of dropdowns.
 */
const ALIASES: Record<ImportField, string[]> = {
  firstName: ["first name", "firstname", "first", "given name", "givenname", "fname"],
  lastName: ["last name", "lastname", "last", "surname", "family name", "lname"],
  preferredName: ["preferred name", "nickname", "goes by", "known as", "preferred"],
  email: ["email", "email address", "e mail", "primary email", "member email", "emailaddress"],
  phone: ["phone", "phone number", "mobile", "cell", "cell phone", "telephone", "primary phone"],
  employer: ["employer", "company", "organization", "organisation", "business", "firm", "work"],
  jobTitle: ["job title", "title", "position", "role at work", "occupation"],
  classification: ["classification", "vocation", "rotary classification", "class"],
  birthday: ["birthday", "birth date", "birthdate", "dob", "date of birth"],
  joinedRotaryOn: ["joined rotary", "rotary join date", "original admission date", "member since", "rotary since"],
  joinedClubOn: ["joined club", "club join date", "admission date", "date joined", "join date", "joined"],
  city: ["city", "town", "home city"],
  stateCode: ["state", "province", "state province", "st"],
  notes: ["notes", "comments", "remarks", "note"],
  membershipType: ["membership type", "member type", "type", "category"],
  stage: ["status", "member status", "standing", "active"],
};

function normalizeHeader(h: string): string {
  return h
    .toLowerCase()
    .replace(/[_\-.]+/g, " ")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Guess which column feeds which field.
 *
 * Exact alias matches first across every field, then prefix matches — so a
 * file with both "Email" and "Email 2" binds "Email" rather than whichever
 * happened to be checked first.
 */
export function guessMapping(headers: string[]): Partial<Record<ImportField, string>> {
  const mapping: Partial<Record<ImportField, string>> = {};
  const taken = new Set<string>();
  const normalized = headers.map((h) => ({ raw: h, norm: normalizeHeader(h) }));

  for (const pass of ["exact", "prefix"] as const) {
    for (const [field, aliases] of Object.entries(ALIASES) as [ImportField, string[]][]) {
      if (mapping[field]) continue;
      const hit = normalized.find(
        (h) =>
          !taken.has(h.raw) &&
          (pass === "exact"
            ? aliases.includes(h.norm)
            : aliases.some((a) => h.norm.startsWith(a) || a.startsWith(h.norm))),
      );
      if (hit) {
        mapping[field] = hit.raw;
        taken.add(hit.raw);
      }
    }
  }

  return mapping;
}

// ── Value cleaning ────────────────────────────────────────────────────────────

/**
 * Normalise a date to YYYY-MM-DD, or null.
 *
 * Ambiguous D/M vs M/D is resolved as US order, because Rotary's North American
 * exports dominate and guessing the other way would silently shift half the
 * birthdays in a roster. Where the day is over 12 the order is unambiguous and
 * we use that instead.
 */
export function normalizeDate(value: string): string | null {
  const v = value.trim();
  if (!v) return null;

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(v);
  if (iso) return `${iso[1]}-${pad(iso[2]!)}-${pad(iso[3]!)}`;

  const slash = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/.exec(v);
  if (slash) {
    let [, a, b, y] = slash as unknown as [string, string, string, string];
    let year = Number(y);
    // Two-digit years: a Rotarian joining in '68 is 1968, not 2068.
    if (year < 100) year += year > 30 ? 1900 : 2000;
    let month = Number(a);
    let day = Number(b);
    if (month > 12 && day <= 12) [month, day] = [day, month];
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${year}-${pad(String(month))}-${pad(String(day))}`;
  }

  const parsed = Date.parse(v);
  if (!Number.isNaN(parsed)) return new Date(parsed).toISOString().slice(0, 10);
  return null;
}

function pad(n: string): string {
  return n.padStart(2, "0");
}

/** Strip formatting from a phone number, keeping any leading +. */
export function normalizePhone(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  const digits = v.replace(/[^\d+]/g, "");
  return digits.length >= 7 ? digits : null;
}

/**
 * Map a club's word for someone's standing onto a pipeline stage.
 *
 * Unrecognised values fall back to `active` rather than erroring: a roster
 * export is a list of the club's members, and refusing to import somebody
 * because their status column says "Regular" would be perverse.
 */
export function normalizeStage(value: string): string {
  const v = value.trim().toLowerCase();
  if (!v) return "active";

  // Departures are checked FIRST, because most of them contain the word
  // "member". "Past Member" and "Former Member" would otherwise match the
  // active pattern and quietly import people who left as current members —
  // inflating the roster, and with it every number derived from it.
  if (/(alumni|past|previous)/.test(v)) return "alumni";
  if (/(resign|terminat|former|inactive|dropped|deceased|removed)/.test(v)) return "resigned";
  if (/(leave|loa|sabbatical)/.test(v)) return "leave_of_absence";
  if (/(prospect|candidate|applicant|pending)/.test(v)) return "candidate";
  if (/(guest|visitor)/.test(v)) return "guest_attended";

  // Honorary is a membership *type*, not a departure — the person is still in
  // the club. Type is read separately by normalizeMembershipType.
  if (/(active|current|regular|member|honorar|yes|true|^1$)/.test(v)) return "active";

  return "active";
}

export function normalizeMembershipType(value: string): "active" | "honorary" | "corporate" | "satellite" {
  const v = value.trim().toLowerCase();
  if (/honorar/.test(v)) return "honorary";
  if (/corporat/.test(v)) return "corporate";
  if (/satellite/.test(v)) return "satellite";
  return "active";
}

/** Split "Margaret Chen" into parts when a file has only one name column. */
export function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0]!, lastName: "" };

  // "Chen, Margaret" — the comma form is common in exports sorted by surname.
  if (full.includes(",")) {
    const [last, first] = full.split(",", 2);
    return { firstName: (first ?? "").trim(), lastName: (last ?? "").trim() };
  }
  return { firstName: parts[0]!, lastName: parts.slice(1).join(" ") };
}
