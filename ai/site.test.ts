import { describe, it, expect } from "vitest";
import {
  factsBlock,
  blockSchemaPrompt,
  pagePrompt,
  brandPrompt,
  polishPrompt,
  extractJson,
  scrubInvented,
  allowedFigures,
  type ClubFacts,
} from "./site";
import { BLOCK_TYPES, validateBlocks } from "@domain/blocks";

const FACTS: ClubFacts = {
  name: "Rotary Club of Lakeside",
  city: "Lakeside",
  stateCode: "MN",
  charterYear: "1948",
  meets: "Thursdays at 12:00",
  location: "The Granary, 14 Mill Street",
  projects: [
    { name: "Backpack Buddies", area: "Basic education and literacy", summary: "Weekend food for 60 children." },
    { name: "Riverbank clean-up", area: "Environment", summary: null },
  ],
  figures: [{ label: "members", value: "43" }],
  notes: "We're a lunch club. Nobody wears a tie.",
};

describe("factsBlock", () => {
  it("passes the club's own record and nothing else", () => {
    const text = factsBlock(FACTS);
    expect(text).toContain("Rotary Club of Lakeside");
    expect(text).toContain("1948");
    expect(text).toContain("Backpack Buddies");
    expect(text).toContain("43 — members");
  });

  it("says so explicitly when there is nothing to say", () => {
    const bare = factsBlock({ ...FACTS, projects: [], figures: [] });
    expect(bare).toContain("Do not describe any specific project");
    expect(bare).toContain("Every number must be written as [ ]");
  });
});

describe("blockSchemaPrompt", () => {
  it("describes every block in the registry, so a new one needs no prompt edit", () => {
    const schema = blockSchemaPrompt();
    for (const type of BLOCK_TYPES) expect(schema, type).toContain(`"${type}"`);
  });

  it("warns the model off writing content into a live block", () => {
    const schema = blockSchemaPrompt();
    const meetings = schema.split("\n- ").find((s) => s.startsWith('"meetings"'))!;
    expect(meetings).toContain("FILLS ITSELF IN");
  });

  it("tells the model it cannot choose photographs", () => {
    expect(blockSchemaPrompt()).toContain("you cannot choose photographs");
  });
});

describe("the prompts", () => {
  it("puts the never-invent rule first, and repeats it for numbers", () => {
    const { system } = pagePrompt({
      facts: FACTS,
      brief: "Our main page",
      pageTitle: "Home",
      existingSlugs: ["", "visit"],
    });
    expect(system).toContain("NEVER INVENT A FACT");
    expect(system).toContain("Numbers are the dangerous case");
    expect(system.indexOf("NEVER INVENT A FACT")).toBeLessThan(system.indexOf("Write plainly"));
  });

  it("only offers links to pages that exist", () => {
    const { system } = pagePrompt({
      facts: FACTS,
      brief: "",
      pageTitle: "Home",
      existingSlugs: ["", "visit"],
    });
    expect(system).toContain('"/visit"');
    expect(system).not.toContain('"/donate"');
  });

  it("confines the brand prompt to the Rotary palette", () => {
    const { system } = brandPrompt({ facts: FACTS, brief: "something friendlier" });
    expect(system).toContain("#17458f");
    expect(system).toContain("Do not invent a hex code");
  });

  it("tells the polisher not to add anything", () => {
    const { system } = polishPrompt({ text: "Some words.", intent: "shorter", facts: FACTS });
    expect(system).toContain("Do not add facts");
    expect(system).toContain("Do not make it longer");
  });

  it("never puts a member's name in a prompt, because it has no field for one", () => {
    const user = pagePrompt({ facts: FACTS, brief: "", pageTitle: "Home", existingSlugs: [""] }).user;
    // The ClubFacts shape is the whole allowance. If somebody adds a roster
    // field to it, this test won't catch it — but the type will make them
    // choose to, which is the point.
    expect(user).not.toContain("@");
  });
});

describe("extractJson", () => {
  it("reads plain JSON", () => {
    expect(extractJson('[{"type":"hero"}]')).toEqual([{ type: "hero" }]);
  });

  it("reads a markdown fence, because models use one anyway", () => {
    expect(extractJson('```json\n[{"type":"hero"}]\n```')).toEqual([{ type: "hero" }]);
    expect(extractJson('```\n{"brandHex":"#17458f"}\n```')).toEqual({ brandHex: "#17458f" });
  });

  it("digs the array out of a preamble", () => {
    expect(extractJson('Here is your page:\n[{"type":"hero"}]\nHope that helps!')).toEqual([
      { type: "hero" },
    ]);
  });

  it("returns null rather than throwing on nonsense", () => {
    expect(extractJson("I'd be happy to help with that!")).toBeNull();
    expect(extractJson("")).toBeNull();
    expect(extractJson("[{unclosed")).toBeNull();
  });
});

describe("scrubInvented", () => {
  const allowed = allowedFigures(FACTS);

  it("keeps a figure the club actually gave us", () => {
    expect(scrubInvented("We have 43 members.", allowed).text).toBe("We have 43 members.");
    expect(scrubInvented("Chartered in 1948.", allowed).text).toBe("Chartered in 1948.");
    expect(scrubInvented("Food for 60 children.", allowed).text).toBe("Food for 60 children.");
  });

  it("blanks a figure it made up, and says which", () => {
    const result = scrubInvented("Over 3,000 volunteer hours last year.", allowed);
    expect(result.text).toBe("Over [ ] volunteer hours last year.");
    expect(result.removed).toEqual(["3,000"]);
  });

  it("leaves a plausible year alone", () => {
    // A date in a sentence an officer will read anyway. Blanking every
    // four-digit number turns "the 1985 project" into gibberish.
    expect(scrubInvented("Running since 1985.", allowed).text).toBe("Running since 1985.");
    expect(scrubInvented("In 2024 we rebuilt the shelter.", allowed).text).toContain("2024");
  });

  it("catches the specific lie this exists to stop", () => {
    const result = scrubInvented(
      "For over 75 years, our 210 members have given 12,000 hours to Lakeside.",
      allowed,
    );
    expect(result.text).not.toContain("210");
    expect(result.text).not.toContain("12,000");
    expect(result.removed).toHaveLength(3);
  });

  it("finds figures in every string field of a proposal", () => {
    // The end-to-end shape: a model's answer, validated, then scrubbed.
    const { blocks } = validateBlocks([
      {
        type: "stats",
        heading: "Our impact",
        items: [
          { value: "43", label: "members" },
          { value: "9,400", label: "volunteer hours" },
        ],
      },
    ]);
    const items = blocks[0]!.items as { value: string; label: string }[];
    expect(scrubInvented(items[0]!.value, allowed).text).toBe("43");
    expect(scrubInvented(items[1]!.value, allowed).text).toBe("[ ]");
  });
});

describe("allowedFigures", () => {
  it("gathers numbers from everything the club told us", () => {
    const allowed = allowedFigures(FACTS);
    expect(allowed.has("43")).toBe(true);
    expect(allowed.has("1948")).toBe(true);
    expect(allowed.has("60")).toBe(true);
    expect(allowed.has("14")).toBe(true); // the street number
    expect(allowed.has("999")).toBe(false);
  });

  it("stores a thousands-separated figure both ways", () => {
    const allowed = allowedFigures({
      ...FACTS,
      figures: [{ label: "raised", value: "$41,200" }],
    });
    expect(allowed.has("41,200")).toBe(true);
    expect(allowed.has("41200")).toBe(true);
  });
});
