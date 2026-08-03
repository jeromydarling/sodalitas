/**
 * brand.ts — the name, the promise, and the voice.
 *
 * CROS's voice was warm and openly devotional: shepherds, companions, "something
 * beautiful is happening". That worked for the churches and faith-adjacent
 * nonprofits it was built for. Rotary is secular, practical, and slightly
 * allergic to being sold to — a room of business owners who have sat through a
 * great many presentations.
 *
 * So the voice keeps CROS's warmth and drops its vocabulary. Plain sentences.
 * Real numbers. Admit what we don't do. Never tell a club it is failing.
 */

export const brand = {
  name: "Sodalitas",
  /** Latin: a fellowship, a society, a company of friends. Rotary in one word. */
  meaning: "Latin for fellowship — a company of people who choose each other.",
  tagline: "Club software that helps you keep the members you have.",
  domain: "sodalitas.jer-f84.workers.dev",
  positioning:
    "Sodalitas is a club operating system for Rotary and Rotaract. It keeps the roster, runs the meetings, and tells you which members are drifting while there's still time to do something about it.",
} as const;

/**
 * The promise, in the order it matters.
 *
 * Retention comes first because it is the actual problem. North American
 * Rotary membership has fallen by roughly a third in two decades, and clubs
 * lose people quietly — not in a dispute, but by drifting off over a few
 * months that nobody noticed. Software that only records who is a member is
 * software that records the decline.
 */
export const PROMISES = [
  {
    key: "retention",
    title: "See someone drifting before they resign",
    body:
      "Members rarely quit. They miss a meeting, then a month, then someone finally notices in July. Sodalitas watches attendance, involvement and the last time anyone actually spoke to them — and tells one person one thing to do about it, this week.",
  },
  {
    key: "guests",
    title: "Stop losing the guests who already showed up",
    body:
      "A visitor who came once and never heard back is the cheapest member a club will ever fail to recruit. Every guest gets tracked from the first visit, and follow-up stops being whoever happened to remember.",
  },
  {
    key: "handover",
    title: "Survive the July handover",
    body:
      "Leadership turns over every year and the club's memory usually turns over with it. Here the history stays put: who was invited, who followed up, what was said, why someone left. The new board inherits a club, not a spreadsheet.",
  },
  {
    key: "one_place",
    title: "One tool instead of five",
    body:
      "Most clubs run their database in one place, email in another, dues in a third, and volunteer signups in a fourth. All four are here, and the savings usually cover the subscription.",
  },
  {
    key: "district",
    title: "Districts see clubs without taking them over",
    body:
      "A district governor sees which clubs need help and why. Assistant governors read their assigned clubs and leave a note. Neither can run a club that hasn't asked them to.",
  },
] as const;

/**
 * Voice rules, enforced by tests over the copy registry.
 *
 * Every one of these exists because it is a mistake this product could
 * plausibly make, not because it reads well in a style guide.
 */
export const VOICE = {
  /** Words that never appear in customer-facing copy. */
  banned: [
    // CROS's devotional register. Rotary is not a church.
    "shepherd", "companion", "ministry", "blessed", "sacred", "faithful",
    "beautiful", "journey", "flourish", "abide",
    // Manufactured urgency. A club that feels nagged stops opening the tab.
    "urgent", "immediately", "act now", "critical", "crisis", "don't miss",
    "hurry", "last chance", "limited time",
    // Blame. Nobody who volunteers for this deserves it from their software.
    "failing", "neglected", "you should have", "your fault",
    // Vendor mush.
    "synergy", "leverage", "best-in-class", "world-class", "revolutionary",
    "game-changing", "seamless", "robust", "cutting-edge", "unlock",
    "empower", "supercharge", "delight",
  ],
  /** Claims we will not make, however well they would convert. */
  forbiddenClaims: [
    "guaranteed", "guarantee", "risk-free", "never lose another member",
    "100%", "always works", "instantly",
  ],
} as const;

/**
 * The domain words, held steady everywhere.
 *
 * Rotary has its own vocabulary and gets it wrong at its peril: a "prospective
 * member" is not a "lead", and calling one a lead in front of a membership
 * chair tells them the software was built for someone else.
 */
export const LEXICON = {
  member: "member",
  prospect: "prospective member",
  guest: "guest",
  club: "club",
  district: "district",
  meeting: "meeting",
  project: "service project",
  committee: "committee",
  dues: "dues",
  attendance: "attendance",
  makeup: "makeup",
  classification: "classification",
  sponsor: "sponsor",
  /** Deliberately not "leads", "contacts", "records" or "users". */
  avoid: ["lead", "contact", "record", "user", "customer", "subscriber", "prospect"],
} as const;
