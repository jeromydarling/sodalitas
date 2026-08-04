import { describe, expect, it } from "vitest";
import {
  audienceFor,
  canSee,
  constrainVisibility,
  documentKey,
  extensionOf,
  folderSlug,
  humanBytes,
  isAllowedType,
  MAX_DOCUMENT_BYTES,
  normaliseType,
  reachOf,
  rotaryYearsSince,
  safeFilename,
  type Visibility,
} from "./documents";

describe("visibility", () => {
  it("lets each audience read exactly what it should and nothing above it", () => {
    expect(reachOf("public")).toEqual(["public"]);
    expect(reachOf("member")).toEqual(["public", "members"]);
    expect(reachOf("board")).toEqual(["public", "members", "board"]);
  });

  it("never shows board documents to a member or the public", () => {
    expect(canSee("board", "member")).toBe(false);
    expect(canSee("board", "public")).toBe(false);
    expect(canSee("board", "board")).toBe(true);
  });

  it("never shows members' documents to the public", () => {
    expect(canSee("members", "public")).toBe(false);
    expect(canSee("members", "member")).toBe(true);
  });

  it("treats a signed-out visitor as the public, not as a probable member", () => {
    expect(audienceFor({ signedIn: false, boardAccess: false })).toBe("public");
    expect(audienceFor({ signedIn: true, boardAccess: false })).toBe("member");
    expect(audienceFor({ signedIn: true, boardAccess: true })).toBe("board");
  });

  it("gives board access to someone who holds it even if the session flag is missing", () => {
    // Capability is the authority; `signedIn` is a UI convenience. Holding the
    // capability without the flag must not lock a director out of the minutes.
    expect(audienceFor({ signedIn: false, boardAccess: true })).toBe("board");
  });
});

describe("constrainVisibility", () => {
  it("stops a board folder from holding a public document", () => {
    expect(constrainVisibility("public", "board")).toBe("board");
    expect(constrainVisibility("members", "board")).toBe("board");
  });

  it("lets a document be narrower than its folder", () => {
    expect(constrainVisibility("board", "public")).toBe("board");
    expect(constrainVisibility("members", "public")).toBe("members");
  });

  it("leaves a document alone when it has no folder", () => {
    expect(constrainVisibility("public", null)).toBe("public");
    expect(constrainVisibility("public", undefined)).toBe("public");
  });

  it("never widens, for any pairing", () => {
    const all: Visibility[] = ["public", "members", "board"];
    const rank = { public: 0, members: 1, board: 2 };
    for (const doc of all) {
      for (const folder of all) {
        const result = constrainVisibility(doc, folder);
        expect(rank[result]).toBeGreaterThanOrEqual(rank[doc]);
        expect(rank[result]).toBeGreaterThanOrEqual(rank[folder]);
      }
    }
  });
});

describe("upload rules", () => {
  it("accepts what a club actually uploads", () => {
    for (const type of [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "image/jpeg",
      "text/csv",
    ]) {
      expect(isAllowedType(type)).toBe(true);
    }
  });

  it("refuses anything a browser would execute in the club's own origin", () => {
    for (const type of [
      "text/html",
      "image/svg+xml",
      "application/javascript",
      "application/x-msdownload",
      "application/xhtml+xml",
    ]) {
      expect(isAllowedType(type)).toBe(false);
    }
  });

  it("ignores the charset a browser tacks on", () => {
    expect(normaliseType("TEXT/PLAIN; charset=UTF-8")).toBe("text/plain");
    expect(isAllowedType("application/pdf; charset=binary")).toBe(true);
  });

  it("caps uploads well below what would break a Worker", () => {
    expect(MAX_DOCUMENT_BYTES).toBeLessThanOrEqual(100 * 1024 * 1024);
    expect(MAX_DOCUMENT_BYTES).toBeGreaterThan(5 * 1024 * 1024);
  });
});

describe("safeFilename", () => {
  it("keeps an ordinary filename intact", () => {
    expect(safeFilename("Board minutes 2025-03.pdf")).toBe("Board minutes 2025-03.pdf");
  });

  it("takes only the last path segment", () => {
    expect(safeFilename("../../etc/passwd")).toBe("passwd");
    expect(safeFilename("C:\\Users\\jan\\bylaws.docx")).toBe("bylaws.docx");
  });

  it("removes characters that would break a Content-Disposition header", () => {
    const out = safeFilename('min"utes\r\n.pdf');
    expect(out).not.toContain('"');
    expect(out).not.toContain("\r");
    expect(out).not.toContain("\n");
  });

  it("never returns an empty string", () => {
    expect(safeFilename("")).toBe("document");
    expect(safeFilename("///")).toBe("document");
    expect(safeFilename('"""')).toBe("document");
  });

  it("bounds the length", () => {
    expect(safeFilename("a".repeat(500)).length).toBeLessThanOrEqual(120);
  });
});

describe("documentKey", () => {
  it("puts the tenant first so a listing cannot walk between clubs", () => {
    const key = documentKey("tn_a", "cl_b", "dc_c", "minutes.pdf");
    expect(key.startsWith("documents/tn_a/")).toBe(true);
    expect(key).toBe("documents/tn_a/cl_b/dc_c.pdf");
  });

  it("uses the id rather than the filename, so two 'minutes.pdf' never collide", () => {
    const a = documentKey("tn", "cl", "dc_1", "minutes.pdf");
    const b = documentKey("tn", "cl", "dc_2", "minutes.pdf");
    expect(a).not.toBe(b);
  });

  it("falls back to .bin rather than producing a keyless path", () => {
    expect(documentKey("tn", "cl", "dc", "noextension")).toBe("documents/tn/cl/dc.bin");
  });

  it("reads the extension case-insensitively", () => {
    expect(extensionOf("MINUTES.PDF")).toBe("pdf");
    expect(extensionOf("no-dot")).toBeNull();
  });
});

describe("folderSlug", () => {
  it("makes a URL-safe slug", () => {
    expect(folderSlug("Projects and Grants")).toBe("projects-and-grants");
    expect(folderSlug("Board — Minutes")).toBe("board-minutes");
  });

  it("strips accents rather than dropping the word", () => {
    expect(folderSlug("Réunions")).toBe("reunions");
  });

  it("never returns an empty slug", () => {
    expect(folderSlug("")).toBe("folder");
    expect(folderSlug("!!!")).toBe("folder");
  });

  it("never ends in a hyphen, even when truncation lands on one", () => {
    const long = `${"a".repeat(59)} tail`;
    const slug = folderSlug(long);
    expect(slug.endsWith("-")).toBe(false);
  });
});

describe("rotaryYearsSince", () => {
  it("counts backwards from today to the charter, newest first", () => {
    const years = rotaryYearsSince("2022-09-01", "2025-03-01");
    expect(years).toEqual(["2024-25", "2023-24", "2022-23"]);
  });

  it("puts July in the year that starts, not the one that ends", () => {
    expect(rotaryYearsSince("2025-07-01", "2025-07-01")).toEqual(["2025-26"]);
    expect(rotaryYearsSince("2025-06-30", "2025-06-30")).toEqual(["2024-25"]);
  });

  it("returns just the current year when the charter is in the future", () => {
    expect(rotaryYearsSince("2030-01-01", "2025-01-01")).toEqual(["2024-25"]);
  });
});

describe("humanBytes", () => {
  it("reads the way a secretary would say it", () => {
    expect(humanBytes(0)).toBe("0 KB");
    expect(humanBytes(900)).toBe("900 B");
    expect(humanBytes(2048)).toBe("2 KB");
    expect(humanBytes(1024 * 1024 * 3.5)).toBe("3.5 MB");
    expect(humanBytes(1024 * 1024 * 24)).toBe("24 MB");
  });
});
