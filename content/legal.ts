/**
 * legal.ts — privacy, terms, and how AI is used.
 *
 * Written to be read, which is unusual enough for legal pages to be worth
 * saying. A club secretary is a volunteer who has been asked by their board
 * whether this is safe to put member data into, and they will not get an answer
 * from four thousand words of definitions.
 *
 * These describe how the software actually behaves. Where a claim here and the
 * code disagree, the code is the bug — several of these statements are enforced
 * by tests, and the ones that aren't are the ones to be most careful about.
 *
 * Not a substitute for a lawyer's review before taking real money from real
 * clubs. Reviewed: not yet.
 */

export interface LegalSection {
  heading: string;
  paragraphs: string[];
  list?: string[];
}

export interface LegalDoc {
  slug: string;
  title: string;
  summary: string;
  updated: string;
  sections: LegalSection[];
}

export const LEGAL: LegalDoc[] = [
  {
    slug: "privacy",
    title: "Privacy",
    summary:
      "What a club's data is used for, who can see it, and how to get it back or delete it.",
    updated: "2026-08-04",
    sections: [
      {
        heading: "Whose data this is",
        paragraphs: [
          "A club's records belong to the club. We hold them so the software can do its job, and for no other purpose. We do not sell them, we do not rent them, and we do not use one club's data to advertise to another.",
          "We do not train AI models on your members. Where AI is used at all it is a single request that drafts text a person then edits — nothing is retained for training by us, and the provider is instructed accordingly. There is a separate page on exactly how AI is used.",
        ],
      },
      {
        heading: "Who can see a club's roster",
        paragraphs: [
          "This is the question boards actually ask, so it gets a direct answer.",
        ],
        list: [
          "Members of that club, according to the office they hold. A member sees the directory; a membership chair sees the pipeline; a treasurer sees dues.",
          "A district governor sees club-level rollups — health scores, membership counts and trends — not individual member records.",
          "An assistant governor sees detail only for the clubs they are assigned to.",
          "Nobody at another club, ever. Cross-club sharing strips names, addresses, phone numbers and amounts before anything leaves, buckets dates to the week, and refuses to share at all into a group too small to be anonymous.",
          "Us, only when a club asks for help with a specific problem, and access is logged.",
        ],
      },
      {
        heading: "What the public page shows",
        paragraphs: [
          "A club's public page shows meetings, public service projects, the officers who hold a listed office, and a join form. It never shows the roster, member contact details, attendance, dues or notes. That is a property of the code, not a setting somebody might get wrong.",
        ],
      },
      {
        heading: "What we collect beyond what you enter",
        paragraphs: [
          "Very little, and deliberately.",
        ],
        list: [
          "Sign-in sessions, so you stay logged in. Deleted when they expire.",
          "IP addresses for rate limiting and security, stored as a salted hash rather than the address itself.",
          "Records of email we sent on the club's behalf, so a member's history is complete.",
          "Aggregate error and performance data. No club data, no member data.",
          "No third-party analytics. No advertising trackers. No cookies beyond the one that signs you in.",
        ],
      },
      {
        heading: "Getting it out, and getting it deleted",
        paragraphs: [
          "You can export your club's data as CSV at any time, from inside the product, without asking us. The export excludes password and token material — that is not yours to hold either.",
          "Deleting a club deletes its records. Ask and we will confirm when it is done. Backups age out on their own schedule and are not searched to reconstruct a deleted club.",
        ],
      },
      {
        heading: "Where it is stored",
        paragraphs: [
          "On Cloudflare's network. Data is stored in Cloudflare D1, R2 and KV, and processed in Cloudflare Workers. Payments go through Stripe, on the club's own connected account — card numbers never reach us and never touch our systems.",
        ],
      },
      {
        heading: "Asking us about any of this",
        paragraphs: [
          "Use the contact form. A person reads it. If you need something in a particular form for your board, say so and we'll write it.",
        ],
      },
    ],
  },

  {
    slug: "terms",
    title: "Terms",
    summary: "What we undertake to do, what we ask of you, and how either side stops.",
    updated: "2026-08-04",
    sections: [
      {
        heading: "The short version",
        paragraphs: [
          "You pay a subscription; we run the software and look after your club's data. You can leave whenever you like and take your data with you. We can stop serving a club that uses this to harm people, and that is essentially the only reason we would.",
          "Everything below is the longer form of those four sentences.",
        ],
      },
      {
        heading: "What we undertake",
        paragraphs: [],
        list: [
          "To keep the service running, and to tell you plainly when it isn't.",
          "To keep your club's data private, as described on the privacy page.",
          "To let you export everything, at any time, without asking us first.",
          "To give notice before changing a price for an existing club, and never to raise one mid-term.",
          "Not to sell your data, and not to train models on your members.",
        ],
      },
      {
        heading: "What we ask",
        paragraphs: [],
        list: [
          "That you have the right to hold the member data you enter, and that members know their club keeps records — which under Rotary practice they generally do.",
          "That the club's email is used for the club's own purposes, and not to send bulk mail to people who never gave the club their address.",
          "That you don't attempt to reach another club's data, or to work around the boundaries described on the privacy page.",
          "That accounts belong to people. Officers change every July; share the club, not a login.",
        ],
      },
      {
        heading: "Payment",
        paragraphs: [
          "Subscriptions are billed monthly or annually in advance. Annual billing is charged for ten months rather than twelve.",
          "Money your club collects is a separate matter entirely: it goes through the club's own Stripe account, straight to the club's bank, and we never hold it. We take no percentage of dues or donations.",
          "Paid event tickets are the single exception, and we would rather state it here than have you discover it. A platform fee of 1% of the ticket price, capped at $1.50 per order, is taken as a Stripe application fee at the moment of payment. Free tickets carry no fee at all. The amount is shown to the payer before they pay and recorded against every registration, so your treasurer can always reconcile it.",
          "Cancel whenever you like. The subscription runs to the end of the period already paid for, and we don't prorate a refund for the remainder unless something went wrong on our side — in which case ask, and we probably will.",
        ],
      },
      {
        heading: "Stopping",
        paragraphs: [
          "You can stop at any time, from inside the product, and export your data first. We are not going to make that difficult; a club that leaves easily is a club that might come back.",
          "We would only end a club's account for using this to harm people — harassment, or sending mail to people who never gave the club their address. We would tell you why, and you would still get your data.",
        ],
      },
      {
        heading: "The parts a lawyer would insist on",
        paragraphs: [
          "The software is provided as it is. We work to keep it running and correct, and we can't promise it will never be unavailable or never be wrong. Our liability is limited to what you have paid us in the previous twelve months.",
          "The retention scoring is a tool for deciding who to call. It is not a judgement about a person, and it should never be the sole basis for a decision about somebody's membership.",
          "We are not affiliated with, endorsed by, or sponsored by Rotary International. \"Rotary\", \"Rotaract\" and the Rotary emblem are their trademarks, not ours.",
        ],
      },
    ],
  },

  {
    slug: "ai-transparency",
    title: "How we use AI",
    summary:
      "Which parts use a model, which parts deliberately don't, and why the retention score is not one of them.",
    updated: "2026-08-04",
    sections: [
      {
        heading: "The score is not AI",
        paragraphs: [
          "This is the important one. Member engagement and club health are scored by a fixed set of rules over facts your club recorded — attendance and its trend, involvement, dues, days since anyone spoke to them. The weights are published in full on the retention page.",
          "The same facts always produce the same score. Every score shows its drivers. You can disagree with one, dismiss it, and the reason you gave is kept.",
          "This is a deliberate constraint rather than a limitation we haven't got round to lifting. A model that produced a number nobody could interrogate would be easier to build and worth much less: a club that can't argue with its software stops trusting it, then stops entering data, and then owns an expensive spreadsheet. An AI may explain a score. It never produces one.",
        ],
      },
      {
        heading: "What AI does do",
        paragraphs: [
          "One thing, in a few places: it drafts text that a person then edits and sends.",
        ],
        list: [
          "A follow-up note to a guest, from what the club recorded about their visit.",
          "A recap of a meeting, from the attendance and the speaker.",
          "A plain-language summary of why a signal was raised — explaining the rules' output, never replacing it.",
        ],
      },
      {
        heading: "What it never does",
        paragraphs: [],
        list: [
          "Score, rank or flag a member.",
          "Send anything. Every draft is edited and sent by a person.",
          "Decide anything about a membership, a payment or an access permission.",
          "Read a club's data unless that club triggered the request.",
        ],
      },
      {
        heading: "Where the data goes",
        paragraphs: [
          "When you use one of the drafting features, the relevant details are sent to Anthropic's API to generate that draft. Only what the draft needs — not the roster, not the club's history.",
          "Nothing is retained for training, by us or by the provider. Every invocation is recorded, so a club can see what was sent and when.",
          "If AI isn't configured for an installation, those buttons say so and everything else works exactly as it does otherwise. The product is fully usable with no AI at all, which is the test we hold it to.",
        ],
      },
      {
        heading: "Generated imagery",
        paragraphs: [
          "Photography on this marketing site may be machine-generated. It illustrates; it does not depict. No image here is a photograph of a real Rotary club, a real member, or a real event, and none of it should be read as one.",
        ],
      },
    ],
  },
];

export function legalBySlug(slug: string): LegalDoc | undefined {
  return LEGAL.find((d) => d.slug === slug);
}
