/**
 * csv.test.ts
 *
 * Import is where a club decides whether to switch. Every case here is
 * something a real ClubRunner or DACdb export does, and every one of them has
 * cost somebody an afternoon somewhere.
 */
import { describe, it, expect } from "vitest";
import {
  parseCsv, parseCsvGrid, guessMapping, normalizeDate, normalizePhone,
  normalizeStage, normalizeMembershipType, splitName, FIELD_LABELS, REQUIRED_FIELDS,
} from "./csv";

describe("parsing", () => {
  it("reads a plain file", () => {
    const { headers, rows } = parseCsv("First Name,Last Name\nAda,Okonkwo\nBen,Lindqvist\n");
    expect(headers).toEqual(["First Name", "Last Name"]);
    expect(rows).toEqual([
      { "First Name": "Ada", "Last Name": "Okonkwo" },
      { "First Name": "Ben", "Last Name": "Lindqvist" },
    ]);
  });

  // Excel writes one of these by default and it makes the first column
  // unmappable in a way that is invisible on screen.
  it("strips a UTF-8 BOM so the first header still matches", () => {
    const { headers } = parseCsv("﻿First Name,Email\nAda,a@b.com\n");
    expect(headers[0]).toBe("First Name");
    expect(guessMapping(headers).firstName).toBe("First Name");
  });

  it("handles CRLF, LF and bare CR alike", () => {
    for (const [nl, label] of [["\r\n", "CRLF"], ["\n", "LF"], ["\r", "CR"]] as const) {
      const { rows } = parseCsv(`A,B${nl}1,2${nl}3,4${nl}`);
      expect(rows, label).toEqual([{ A: "1", B: "2" }, { A: "3", B: "4" }]);
    }
  });

  it("keeps commas inside quoted fields", () => {
    const { rows } = parseCsv('Name,Employer\nAda,"Foster, Kline & Co"\n');
    expect(rows[0]!.Employer).toBe("Foster, Kline & Co");
  });

  it("keeps newlines inside quoted fields", () => {
    const { rows } = parseCsv('Name,Notes\nAda,"Line one\nLine two"\n');
    expect(rows[0]!.Notes).toBe("Line one\nLine two");
    expect(rows).toHaveLength(1);
  });

  it("unescapes doubled quotes", () => {
    const { rows } = parseCsv('Name,Nickname\nRobert,"""Bob"""\n');
    expect(rows[0]!.Nickname).toBe('"Bob"');
  });

  it("ignores trailing and blank lines", () => {
    const { rows } = parseCsv("A,B\n1,2\n\n\n3,4\n\n");
    expect(rows).toHaveLength(2);
  });

  it("treats missing trailing cells as blank and says so", () => {
    const { rows, warnings } = parseCsv("A,B,C\n1,2\n");
    expect(rows[0]).toEqual({ A: "1", B: "2", C: "" });
    expect(warnings.join(" ")).toMatch(/fewer columns/i);
  });

  it("disambiguates duplicate headers instead of clobbering them", () => {
    const { headers, rows, warnings } = parseCsv("Email,Email\na@b.com,c@d.com\n");
    expect(headers).toEqual(["Email", "Email (2)"]);
    expect(rows[0]).toEqual({ Email: "a@b.com", "Email (2)": "c@d.com" });
    expect(warnings.join(" ")).toMatch(/more than one column/i);
  });

  it("trims surrounding whitespace", () => {
    const { rows } = parseCsv("First Name , Email \n  Ada  ,  a@b.com \n");
    expect(rows[0]).toEqual({ "First Name": "Ada", Email: "a@b.com" });
  });

  it("says plainly when a file is empty", () => {
    expect(parseCsv("").warnings.join(" ")).toMatch(/empty/i);
    expect(parseCsv("").rows).toEqual([]);
  });

  it("handles a file with headers but no data", () => {
    const { headers, rows } = parseCsv("First Name,Last Name\n");
    expect(headers).toHaveLength(2);
    expect(rows).toEqual([]);
  });

  it("does not lose the final row when the file has no trailing newline", () => {
    expect(parseCsv("A\n1\n2").rows).toHaveLength(2);
  });

  it("keeps an empty last field", () => {
    expect(parseCsvGrid("a,b,\n")[0]).toEqual(["a", "b", ""]);
  });
});

describe("column guessing", () => {
  it("maps a ClubRunner-shaped export", () => {
    const m = guessMapping([
      "First Name", "Last Name", "Preferred Name", "Email Address",
      "Cell Phone", "Company", "Classification", "Original Admission Date",
    ]);
    expect(m.firstName).toBe("First Name");
    expect(m.lastName).toBe("Last Name");
    expect(m.preferredName).toBe("Preferred Name");
    expect(m.email).toBe("Email Address");
    expect(m.phone).toBe("Cell Phone");
    expect(m.employer).toBe("Company");
    expect(m.classification).toBe("Classification");
    expect(m.joinedRotaryOn).toBe("Original Admission Date");
  });

  it("copes with snake_case, kebab-case and stray punctuation", () => {
    const m = guessMapping(["first_name", "last-name", "E-Mail", "Date Joined"]);
    expect(m.firstName).toBe("first_name");
    expect(m.lastName).toBe("last-name");
    expect(m.email).toBe("E-Mail");
    expect(m.joinedClubOn).toBe("Date Joined");
  });

  it("never binds one column to two fields", () => {
    const m = guessMapping(["Name", "Email", "Phone"]);
    const used = Object.values(m);
    expect(new Set(used).size).toBe(used.length);
  });

  it("prefers the exact match when a near-match is also present", () => {
    // Both look like an email column; "Email" is the one that should win.
    const m = guessMapping(["Email Address 2", "Email"]);
    expect(m.email).toBe("Email");
  });

  it("leaves unrecognised columns alone rather than guessing wildly", () => {
    const m = guessMapping(["Badge Colour", "Table Number"]);
    expect(Object.keys(m)).toHaveLength(0);
  });

  it("gives every mappable field a human label", () => {
    for (const [field, label] of Object.entries(FIELD_LABELS)) {
      expect(label, field).not.toMatch(/[_A-Z]{2}/);
      expect(label.length, field).toBeGreaterThan(2);
    }
  });

  it("asks for only the two fields it genuinely cannot do without", () => {
    expect(REQUIRED_FIELDS).toEqual(["firstName", "lastName"]);
  });
});

describe("dates", () => {
  it("reads ISO", () => {
    expect(normalizeDate("2019-04-08")).toBe("2019-04-08");
    expect(normalizeDate("2019-4-8")).toBe("2019-04-08");
  });

  it("reads US slash order", () => {
    expect(normalizeDate("4/8/2019")).toBe("2019-04-08");
    expect(normalizeDate("04-08-2019")).toBe("2019-04-08");
  });

  it("flips when the day makes the order unambiguous", () => {
    // 25 cannot be a month, so this is 25 April however it was written.
    expect(normalizeDate("25/4/2019")).toBe("2019-04-25");
  });

  it("reads two-digit years the way a roster means them", () => {
    // A Rotarian joining in '68 joined in 1968, not 2068.
    expect(normalizeDate("6/1/68")).toBe("1968-06-01");
    expect(normalizeDate("6/1/05")).toBe("2005-06-01");
  });

  it("returns null rather than a wrong date", () => {
    expect(normalizeDate("")).toBeNull();
    expect(normalizeDate("sometime in the nineties")).toBeNull();
    expect(normalizeDate("13/45/2019")).toBeNull();
  });
});

describe("phones", () => {
  it("strips formatting", () => {
    expect(normalizePhone("(218) 555-0134")).toBe("2185550134");
    expect(normalizePhone("+1 218 555 0134")).toBe("+12185550134");
  });

  it("rejects something too short to be a number", () => {
    expect(normalizePhone("ext 12")).toBeNull();
    expect(normalizePhone("")).toBeNull();
  });
});

describe("standing", () => {
  it("recognises the words clubs actually use", () => {
    expect(normalizeStage("Active")).toBe("active");
    expect(normalizeStage("Regular")).toBe("active");
    expect(normalizeStage("Leave of Absence")).toBe("leave_of_absence");
    expect(normalizeStage("Terminated")).toBe("resigned");
    expect(normalizeStage("Past Member")).toBe("alumni");
    expect(normalizeStage("Prospect")).toBe("candidate");
  });

  // Most departure words contain "member". Checking active first imports
  // everyone who ever left as a current member, which inflates the roster and
  // every number derived from it.
  it("reads a departure as a departure even though it says 'member'", () => {
    expect(normalizeStage("Past Member")).toBe("alumni");
    expect(normalizeStage("Former Member")).toBe("resigned");
    expect(normalizeStage("Previous Member")).toBe("alumni");
    expect(normalizeStage("Inactive Member")).toBe("resigned");
    expect(normalizeStage("Terminated Member")).toBe("resigned");
  });

  // An import that refuses somebody because their status column says
  // "Regular Member (Blue Badge)" is an import nobody finishes.
  it("assumes a member when the word is unfamiliar", () => {
    expect(normalizeStage("Blue Badge")).toBe("active");
    expect(normalizeStage("")).toBe("active");
  });

  it("reads membership type separately from standing", () => {
    expect(normalizeMembershipType("Honorary")).toBe("honorary");
    expect(normalizeMembershipType("Corporate Member")).toBe("corporate");
    expect(normalizeMembershipType("Regular")).toBe("active");
    // Honorary is a type, not a departure — it must stay an active standing.
    expect(normalizeStage("Honorary")).toBe("active");
  });
});

describe("splitting a single name column", () => {
  it("splits on the first space", () => {
    expect(splitName("Margaret Chen")).toEqual({ firstName: "Margaret", lastName: "Chen" });
  });

  it("keeps compound surnames whole", () => {
    expect(splitName("Ana Maria de Souza")).toEqual({
      firstName: "Ana",
      lastName: "Maria de Souza",
    });
  });

  it("handles the surname-first form exports love", () => {
    expect(splitName("Chen, Margaret")).toEqual({ firstName: "Margaret", lastName: "Chen" });
  });

  it("copes with one word or none", () => {
    expect(splitName("Prince")).toEqual({ firstName: "Prince", lastName: "" });
    expect(splitName("  ")).toEqual({ firstName: "", lastName: "" });
  });
});
