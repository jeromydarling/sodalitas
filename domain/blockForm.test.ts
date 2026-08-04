import { describe, it, expect } from "vitest";
import {
  blockFromForm,
  replaceBlock,
  addBlock,
  removeBlock,
  moveBlock,
  fieldName,
  itemFieldName,
  type FormLike,
} from "./blockForm";
import { validateBlocks, type Block } from "./blocks";

/** A stand-in for FormData, which is all blockFromForm needs. */
function form(entries: Record<string, string | string[]>): FormLike {
  const map = new Map<string, string[]>();
  for (const [k, v] of Object.entries(entries)) map.set(k, Array.isArray(v) ? v : [v]);
  return {
    get: (name) => map.get(name)?.[0] ?? null,
    getAll: (name) => map.get(name) ?? [],
  };
}

const page = (input: unknown[]): Block[] => validateBlocks(input).blocks;

describe("blockFromForm", () => {
  it("reads the fields the registry declares", () => {
    const result = blockFromForm("hero", "b1", form({
      [fieldName("heading")]: "Rotary Club of Lakeside",
      [fieldName("body")]: "We meet Tuesdays.",
      [fieldName("layout")]: "centred",
    }))!;
    expect(result).toMatchObject({
      id: "b1",
      type: "hero",
      heading: "Rotary Club of Lakeside",
      layout: "centred",
    });
  });

  it("ignores a field the block doesn't have, however it's spelled", () => {
    const result = blockFromForm("hero", "b1", form({
      [fieldName("heading")]: "Hello",
      "f.dangerouslySetInnerHTML": "<script>alert(1)</script>",
      dangerouslySetInnerHTML: "<script>alert(1)</script>",
      "f.__proto__": "polluted",
    }))!;
    // Only what the registry declares *and* the form actually carried.
    expect(Object.keys(result).sort()).toEqual(["heading", "id", "type"]);
  });

  it("refuses a block type that doesn't exist", () => {
    expect(blockFromForm("iframe", "b1", form({}))).toBeNull();
  });

  it("gathers list rows and drops the blank ones", () => {
    const result = blockFromForm("stats", "b1", form({
      [itemFieldName("items", 0, "value")]: "43",
      [itemFieldName("items", 0, "label")]: "members",
      [itemFieldName("items", 1, "value")]: "",
      [itemFieldName("items", 1, "label")]: "  ",
      [itemFieldName("items", 2, "value")]: "1948",
      [itemFieldName("items", 2, "label")]: "chartered",
    }))!;
    expect(result.items).toHaveLength(2);
    expect((result.items as Record<string, unknown>[])[1]!.value).toBe("1948");
  });

  it("reads an unticked checkbox as off, not as absent", () => {
    // The editor pairs each checkbox with a hidden "0". Without it, saving
    // would leave every boolean at its default and silently re-enable things
    // the club had turned off.
    const off = blockFromForm("meetings", "b1", form({
      [fieldName("showSpeaker")]: ["0"],
    }))!;
    expect(off.showSpeaker).toBe(false);

    const on = blockFromForm("meetings", "b1", form({
      [fieldName("showSpeaker")]: ["0", "on"],
    }))!;
    expect(on.showSpeaker).toBe(true);
  });

  it("leaves a field the form didn't carry alone, rather than blanking it", () => {
    const result = blockFromForm("hero", "b1", form({ [fieldName("heading")]: "Hello" }))!;
    expect("heading" in result).toBe(true);
    expect("eyebrow" in result).toBe(false);
  });
});

describe("editing a page", () => {
  const blocks = page([
    { type: "hero", id: "a", heading: "One" },
    { type: "richText", id: "b", heading: "Two" },
    { type: "cta", id: "c", heading: "Three" },
  ]);

  it("replaces one block and keeps its id", () => {
    const next = replaceBlock(blocks, "b", { type: "richText", heading: "Rewritten" });
    expect(next[1]!.id).toBe("b");
    expect(next[1]!.heading).toBe("Rewritten");
    expect(next).toHaveLength(3);
  });

  it("re-runs the page rules on every edit, not just the block's own", () => {
    // Turning the second section into a hero must be refused, because a page
    // has one. A per-block check could not see this.
    const next = replaceBlock(blocks, "b", { type: "hero", heading: "Second hero" });
    expect(next.filter((b) => b.type === "hero")).toHaveLength(1);
  });

  it("adds a block at the end, or wherever asked", () => {
    expect(addBlock(blocks, "faq").at(-1)!.type).toBe("faq");
    expect(addBlock(blocks, "faq", 1)[1]!.type).toBe("faq");
    expect(addBlock(blocks, "nonsense")).toHaveLength(3);
  });

  it("removes a block", () => {
    expect(removeBlock(blocks, "b").map((b) => b.id)).toEqual(["a", "c"]);
    expect(removeBlock(blocks, "nope")).toHaveLength(3);
  });

  it("moves a block one place and stops at the ends", () => {
    expect(moveBlock(blocks, "b", -1).map((b) => b.id)).toEqual(["b", "a", "c"]);
    expect(moveBlock(blocks, "b", 1).map((b) => b.id)).toEqual(["a", "c", "b"]);
    // Pressing up on the first section does nothing rather than wrapping the
    // hero to the bottom of the page.
    expect(moveBlock(blocks, "a", -1).map((b) => b.id)).toEqual(["a", "b", "c"]);
    expect(moveBlock(blocks, "c", 1).map((b) => b.id)).toEqual(["a", "b", "c"]);
    expect(moveBlock(blocks, "nope", 1)).toHaveLength(3);
  });
});
