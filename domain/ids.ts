/**
 * ids.ts — prefixed random identifiers.
 *
 * One helper, one alphabet, one place. A prefixed id tells you what you're
 * holding when it turns up in a log line, a URL, or a support email — which is
 * the entire reason not to use bare UUIDs.
 */

export const ID_PREFIXES = {
  tenant: "tn",
  user: "us",
  session: "se",
  district: "di",
  club: "cl",
  person: "pe",
  household: "hh",
  householdMember: "hm",
  organization: "og",
  membership: "mb",
  stageEvent: "sv",
  role: "rl",
  meetingSeries: "ms",
  meeting: "mt",
  attendance: "at",
  committee: "cm",
  committeeMember: "cx",
  project: "pj",
  participant: "pp",
  projectPartner: "px",
  interaction: "in",
  task: "tk",
  invoice: "iv",
  payment: "pm",
  paymentSettings: "ps",
  checkout: "ck",
  tag: "tg",
  entityTag: "et",
  file: "fl",
  invite: "iw",
  audit: "au",
  healthSnapshot: "hs",
  engagement: "en",
  signal: "sg",
  group: "gr",
  groupMember: "gm",
  sharedSignal: "ss",
  sharedEvent: "sx",
  speaker: "sp",
  request: "rq",
  reply: "rp",
  govFlag: "gf",
  email: "em",
  suppression: "su",
  importRun: "ir",
  importRow: "iy",
  joinSubmission: "js",
  jobRun: "jr",
  aiInvocation: "ai",
  brandKit: "bk",
  site: "st",
  sitePage: "sq",
  siteVersion: "sr",
  siteMedia: "sm",
  siteDomain: "sd",
  event: "ev",
  ticketType: "tt",
  eventQuestion: "eq",
  registration: "rg",
  registrationItem: "ri",
  folder: "fd",
  document: "dc",
} as const;

export type IdKind = keyof typeof ID_PREFIXES;

// Crockford-ish base32: no I, L, O, U. Avoids both visual confusion when a
// human reads an id aloud and the one four-letter word you don't want
// appearing in a customer-facing identifier.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const RANDOM_LEN = 22; // ~110 bits

/** Generate a new prefixed id, e.g. `pe_7K2M9QX4TR8VBN3WHY5FGD`. */
export function newId(kind: IdKind): string {
  const bytes = new Uint8Array(RANDOM_LEN);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < RANDOM_LEN; i++) {
    // Modulo bias over a 32-char alphabet from a 256-value byte is exactly
    // zero, since 256 is a multiple of 32. No rejection sampling needed.
    out += ALPHABET[bytes[i]! % ALPHABET.length];
  }
  return `${ID_PREFIXES[kind]}_${out}`;
}

/** True when `id` is a well-formed id of the given kind. */
export function isId(id: unknown, kind: IdKind): id is string {
  if (typeof id !== "string") return false;
  const prefix = ID_PREFIXES[kind];
  if (!id.startsWith(`${prefix}_`)) return false;
  const body = id.slice(prefix.length + 1);
  if (body.length !== RANDOM_LEN) return false;
  for (const ch of body) if (!ALPHABET.includes(ch)) return false;
  return true;
}

/** True when `id` is a well-formed id of any known kind. */
export function isAnyId(id: unknown): id is string {
  if (typeof id !== "string") return false;
  const [prefix, body] = id.split("_");
  if (!prefix || !body) return false;
  const known = (Object.values(ID_PREFIXES) as string[]).includes(prefix);
  if (!known) return false;
  if (body.length !== RANDOM_LEN) return false;
  for (const ch of body) if (!ALPHABET.includes(ch)) return false;
  return true;
}

/** The id kind a value belongs to, or null. */
export function idKind(id: unknown): IdKind | null {
  if (typeof id !== "string") return null;
  const prefix = id.split("_")[0];
  if (!prefix) return null;
  for (const [kind, p] of Object.entries(ID_PREFIXES)) {
    if (p === prefix) return isId(id, kind as IdKind) ? (kind as IdKind) : null;
  }
  return null;
}
