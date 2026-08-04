/**
 * blockForm.ts — moving a block between a browser form and the block registry.
 *
 * The editor is server-rendered HTML forms rather than a client-side page
 * builder. That is a deliberate trade: no drag-and-drop, one round trip per
 * edit, and in exchange it works with JavaScript off, it cannot lose a club
 * secretary's paragraph to an unsaved-state bug, and there is no second copy of
 * the block model living in the browser to drift out of step with this one.
 *
 * Field names are `f.<field>` for a scalar and `f.<field>.<index>.<sub>` for a
 * list item. Nothing here trusts them: the shape is read *from the registry*
 * and the form is consulted for values, never the other way round. A crafted
 * form with `f.dangerouslySetInnerHTML` submits a field this function never
 * looks for.
 */

import { BLOCKS, isBlockType, validateBlocks, type Block, type Fields } from "./blocks";

/** The subset of FormData this needs. Keeps the function testable with a Map. */
export interface FormLike {
  get(name: string): FormDataEntryValue | null;
  getAll(name: string): FormDataEntryValue[];
}

export const fieldName = (field: string) => `f.${field}`;
export const itemFieldName = (field: string, index: number, sub: string) =>
  `f.${field}.${index}.${sub}`;

/** How many rows of a list the editor renders. Blank ones are dropped on save. */
export const LIST_ROWS = 6;

function readScalar(form: FormLike, name: string): unknown {
  const raw = form.get(name);
  if (raw === null) return undefined;
  return typeof raw === "string" ? raw : undefined;
}

/**
 * Rebuild one block from a submitted form.
 *
 * Returns an unvalidated shape on purpose — the caller passes it through
 * `validateBlocks` along with the rest of the page, so there is exactly one
 * place where clamping and coercion happen and exactly one set of rules to
 * keep straight.
 */
export function blockFromForm(
  type: string,
  id: string,
  form: FormLike,
): Record<string, unknown> | null {
  if (!isBlockType(type)) return null;
  const fields = BLOCKS[type].fields as Fields;
  const out: Record<string, unknown> = { id, type };

  for (const [name, spec] of Object.entries(fields)) {
    if (spec.kind === "list") {
      const items: Record<string, unknown>[] = [];
      for (let i = 0; i < spec.max; i++) {
        const item: Record<string, unknown> = {};
        let any = false;
        for (const sub of Object.keys(spec.of)) {
          const value = readScalar(form, itemFieldName(name, i, sub));
          if (value !== undefined) item[sub] = value;
          if (typeof value === "string" && value.trim()) any = true;
        }
        // A row the club left blank is a row they didn't want, not an empty
        // card on their website.
        if (any) items.push(item);
      }
      out[name] = items;
      continue;
    }

    if (spec.kind === "bool") {
      // An unchecked box submits nothing at all. The editor pairs every
      // checkbox with a hidden "0" so absence means the field wasn't on the
      // form rather than "the club unticked it" — without that, saving the
      // meetings block would silently turn every option off.
      const values = form.getAll(fieldName(name));
      if (values.length === 0) continue;
      out[name] = values.some((v) => v === "on" || v === "true" || v === "1");
      continue;
    }

    const value = readScalar(form, fieldName(name));
    if (value !== undefined) out[name] = value;
  }

  return out;
}

/**
 * Apply one block's edit to a page.
 *
 * The whole page goes back through validation rather than just the edited
 * block, because `validateBlocks` also enforces page-level rules — one hero,
 * the section cap — that a single-block check cannot see.
 */
export function replaceBlock(blocks: Block[], id: string, next: Record<string, unknown>): Block[] {
  const updated = blocks.map((b) => (b.id === id ? { ...next, id } : b));
  return validateBlocks(updated).blocks;
}

export function addBlock(blocks: Block[], type: string, at?: number): Block[] {
  if (!isBlockType(type)) return blocks;
  const next = [...blocks];
  const fresh = { type };
  next.splice(at ?? next.length, 0, fresh as unknown as Block);
  return validateBlocks(next).blocks;
}

export function removeBlock(blocks: Block[], id: string): Block[] {
  return validateBlocks(blocks.filter((b) => b.id !== id)).blocks;
}

/**
 * Move a block one place.
 *
 * Clamped rather than wrapped: pressing "up" on the first section should do
 * nothing, not send the hero to the bottom of the page.
 */
export function moveBlock(blocks: Block[], id: string, direction: -1 | 1): Block[] {
  const index = blocks.findIndex((b) => b.id === id);
  if (index === -1) return blocks;
  const target = index + direction;
  if (target < 0 || target >= blocks.length) return blocks;
  const next = [...blocks];
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved!);
  return validateBlocks(next).blocks;
}
