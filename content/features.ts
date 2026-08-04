/**
 * features.ts — what the product does, as data.
 *
 * One registry drives the overview page, the detail pages, the footer, the
 * sitemap and llms.txt. A feature added here appears in all of them; a feature
 * described in six places drifts in five.
 *
 * The rule that keeps these honest: every entry carries a `limit` — the thing
 * this feature does not do. Not a disclaimer buried at the bottom, a field the
 * type system requires. A club that discovers a limit after paying tells other
 * clubs, and Rotary districts are small worlds.
 */

import type { IconName } from "~/brand";

export interface Feature {
  slug: string;
  /** Nav and card label. Two or three words. */
  name: string;
  /** The headline on the detail page. A sentence, not a noun phrase. */
  title: string;
  /** One sentence for cards, the sitemap and llms.txt. */
  summary: string;
  icon: IconName;
  /** Image slot key, if one exists for this feature. */
  media?: string;
  /** A miniature of the real screen, from app/screens.tsx. */
  screen?: "signals" | "roster" | "meeting" | "dues" | "health" | "committee";
  /** The case for it, two or three paragraphs. */
  body: string[];
  /** Concrete capabilities. Things, not adjectives. */
  does: string[];
  /** What it doesn't do. Required — see the note above. */
  limit: string;
}

export const FEATURES: Feature[] = [
  {
    slug: "retention",
    name: "Retention",
    title: "See someone drifting before they resign",
    summary:
      "Weekly, evidence-backed signals naming which members are pulling away and what one person should do about each.",
    icon: "Drift",
    screen: "signals",
    body: [
      "Members rarely quit a Rotary club. They miss a meeting for an ordinary reason, then miss another because the first made it easier, and by the time anyone notices it is July and the roster is one shorter. What ends the membership is not a decision — it is the absence of a phone call in week three.",
      "Sodalitas scores engagement from what your club already writes down: attendance and its trend, involvement in committees and projects, dues, and the last time a human actually spoke to them. Every week it produces a short list of specific people, each with the evidence behind it and one suggested next step.",
      "The scoring is deterministic. The same facts always produce the same score, every number shows its drivers, and you can disagree and dismiss one — which is recorded too, because a club that can't argue with its software stops trusting it.",
    ],
    does: [
      "A weekly list capped at seven names, so it stays a list somebody acts on",
      "Every signal carries its evidence: what was measured and what it scored",
      "New members get a 90-day grace period; honorary members and anyone on leave are never flagged",
      "Dismiss a signal with a reason, and the reason is kept",
    ],
    limit:
      "It reads what your club records. A club that doesn't take attendance will get thinner signals, and no software can infer a conversation nobody logged.",
  },
  {
    slug: "guests",
    name: "Guests & prospects",
    title: "Stop losing the visitors who already showed up",
    summary:
      "Every guest tracked from their first visit, so follow-up stops being whoever happened to remember.",
    icon: "Guest",
    screen: "roster",
    media: "guests-spot",
    body: [
      "A visitor who came once and never heard back is the cheapest member a club will ever fail to recruit. They were in the room. They liked it enough to come. And then nothing happened, because the person who meant to call them was not the person who took their details.",
      "Guests are recorded when they visit, matched to whoever brought them, and moved through the pipeline from visitor to prospective member to induction. Nobody has to remember whose turn it is, because the record says.",
    ],
    does: [
      "A public join form on your club page, with spam filtering that doesn't punish real people",
      "Guests linked to their sponsor from the first visit",
      "The pipeline from visitor through to induction, with the stage history kept",
      "Follow-up that survives the July handover, because it belongs to the club rather than to a person",
    ],
    limit:
      "It won't write the follow-up for you. Drafting help is there if you enable AI, but a person reads it and a person sends it.",
  },
  {
    slug: "meetings",
    name: "Meetings",
    title: "Attendance without the spreadsheet",
    summary:
      "Weekly meetings, speakers, attendance and makeups, recorded in a couple of minutes at the door.",
    icon: "Calendar",
    screen: "meeting",
    body: [
      "Attendance is the single most-collected and least-used piece of data in Rotary. It gets taken carefully, typed into a spreadsheet, and read once a year. Meanwhile the useful part — who is trending away from a room they used to be in every week — is invisible because nobody has the time to compute it.",
      "Recording a meeting takes a minute: mark who came, note the speaker, done. Everything downstream — the trend, the signals, the club health score — comes from that one act, which is why it has to be fast enough that a secretary actually does it every week.",
    ],
    does: [
      "Meetings, speakers and topics, with recurring series",
      "Attendance in one pass, including guests and makeups",
      "Programme history you can search when someone asks who spoke in March",
      "Feeds the engagement scoring automatically",
    ],
    limit:
      "There's no kiosk or badge-scanning mode yet. Attendance is taken by a person on a phone or a laptop.",
  },
  {
    slug: "committees",
    name: "Committees & projects",
    title: "The work, and who is actually doing it",
    summary:
      "Committees with real rosters and service projects with hours, funds and participants — including who is on nothing at all.",
    icon: "Committee",
    screen: "committee",
    media: "projects-spot",
    body: [
      "A member on a committee or a project has reasons to be there that survive a bad month. A member who only ever attends has one thread holding them, and it is thin. That makes committee membership one of the strongest retention signals a club has, and most clubs keep it in a document from two presidents ago.",
      "Committees have rosters, chairs and open seats. Projects record hours, funds raised and who took part. The most useful screen is the one showing who is on nothing — because that list is where next year's resignations are.",
    ],
    does: [
      "Committee rosters with chairs, terms and unfilled seats",
      "Service projects with volunteer hours, funds raised and participants",
      "Public project summaries for your club page",
      "Involvement feeds engagement scoring, so the quiet ones surface",
    ],
    limit:
      "Project management is deliberately shallow — no Gantt charts, no task dependencies. It records what happened, it doesn't run the project.",
  },
  {
    slug: "dues",
    name: "Dues",
    title: "Billing that doesn't chase people away",
    summary:
      "Bill the club in one go, take cards or cheques, and treat arrears as the symptom they usually are.",
    icon: "Dues",
    screen: "dues",
    body: [
      "Unpaid dues are usually a symptom rather than a cause. Somebody drifting away stops paying before they resign, which means the arrears report is often the last clear warning a club gets — and a club that responds by sending a third reminder has wasted it.",
      "Bill every current member for a period in one action, safe to run twice. Record cheques and cash by hand, or let members pay by card. Waiving is a first-class action rather than something a treasurer fakes by marking an invoice paid, so a club that quietly covers somebody's dues can record that honestly.",
    ],
    does: [
      "Bill a whole club for a period, skipping anyone already invoiced",
      "Cash, cheque and card, with card payments landing in the club's own Stripe account",
      "Waivers recorded as waivers, so nobody appears in arrears for a debt the club forgave",
      "Arrears surfaced as a prompt to call, not a prompt to invoice again",
    ],
    limit:
      "No general ledger or accounting export beyond CSV. It tracks what members owe the club, not the club's books.",
  },
  {
    slug: "handover",
    name: "July handover",
    title: "Survive the handover with the club's memory intact",
    summary:
      "Roles that expire on the date the term ends, and a history that stays with the club rather than the officer.",
    icon: "Handover",
    media: "handover-spot",
    body: [
      "Rotary leadership turns over every July, and the club's institutional memory usually turns over with it. The spreadsheet gets handed on. What doesn't is everything in the outgoing president's head — which member is going through a hard year, which business said to come back in spring, why that project stalled.",
      "Here the history stays put. Who was invited, who followed up, what was said, why someone left. Access is granted with an end date rather than removed later, because nobody has ever reliably remembered to remove it later — so last year's treasurer stops having the keys on 30 June without anyone doing anything.",
    ],
    does: [
      "Roles carry terms and expire on their own, defaulting to the end of the Rotary year",
      "Real Rotary titles — Club President, Membership Chair, Assistant Governor",
      "An append-only history of contact, notes and stage changes that belongs to the club",
      "The incoming board inherits the worry list, not just the roster",
    ],
    limit:
      "It can't hand over what was never written down. The first year is thinner than the second, and that is honest rather than fixable.",
  },
  {
    slug: "district",
    name: "Districts",
    title: "Districts see clubs without taking them over",
    summary:
      "Club-level rollups for a governor, detail for assistant governors on their own clubs, and no way to quietly run a club that didn't ask.",
    icon: "District",
    screen: "health",
    media: "district-spot",
    body: [
      "District software usually solves the district's problem and creates the club's. A governor gets a dashboard; a club gets the sense that head office is reading its mail. Both matter, and the second one is why clubs quietly stop entering data.",
      "A district governor sees which clubs need help and why, at the level of the club rather than the member. Assistant governors see detail for the clubs they're assigned to and can leave a note. Neither can browse the roster of a club that hasn't asked them to.",
    ],
    does: [
      "Club health across the district, with the drivers behind each score",
      "Assistant governors scoped to their assigned clubs only",
      "District-wide membership trend, without member-level browsing",
      "Everything a district reads is something the club can see it read",
    ],
    limit:
      "No Rotary International data synchronisation. District membership numbers are what your clubs record here, not what RI holds.",
  },
  {
    slug: "communio",
    name: "Communio",
    title: "Clubs learning from each other, without anyone's roster leaving",
    summary:
      "Share what's working across clubs — speakers, programme ideas, what moved attendance — with identifying detail stripped before it leaves.",
    icon: "Spark",
    body: [
      "The club two towns over solved the problem you have. Neither of you will ever find out, because there is no way for clubs to compare notes that doesn't involve someone's roster or a district meeting nobody has time for.",
      "Communio lets a club share a signal, a speaker or a question with clubs it has chosen to be in a group with. Everything is sanitised on the way out: names, addresses, phone numbers and amounts are removed or refused outright, timestamps are bucketed to the week, and nothing is shared at all in a group too small to be anonymous.",
    ],
    does: [
      "Share what worked, with names and figures stripped before it leaves the club",
      "A speaker list clubs actually contribute to, because contributing costs nothing",
      "Ask other clubs a question without exposing who is asking",
      "Refuses to share into a group too small to anonymise",
    ],
    limit:
      "It is deliberately not a social network. There are no profiles, no follower counts and no feed to scroll — a club posts rarely or never, and that's the intended usage.",
  },
  {
    slug: "import",
    name: "Migration",
    title: "Bring your club across without a project plan",
    summary:
      "Upload the export from whatever you use now. Every run is a dry run first, and reversible until you commit it.",
    icon: "Import",
    body: [
      "The reason clubs stay on software they dislike is not loyalty. It is that moving means one volunteer spending three weekends on a spreadsheet, and if it goes wrong the club loses its records in a year when it also loses a president.",
      "Upload a CSV from ClubRunner, DACdb, or a spreadsheet somebody has been keeping since 2009. Columns are matched for you and you correct what it got wrong. Every run shows exactly what it will do before it does anything, and stays reversible until you commit.",
    ],
    does: [
      "Column matching that handles the exports people actually have",
      "Dry run first, always, showing every row it will create or change",
      "Duplicate detection against the members already there",
      "Reversible until committed",
    ],
    limit:
      "Free-text history — notes, follow-up records, why somebody left — usually isn't in any system's export. That part of your club's memory generally doesn't survive any migration, ours included.",
  },
  {
    slug: "public-page",
    name: "Club website",
    title: "A club website that isn't from 2006",
    summary:
      "As many pages as you want, on your own domain, with the meetings and projects filling themselves in from the records you already keep.",
    icon: "People",
    body: [
      "Most Rotary club websites are maintained by one member who learned the tool in 2011 and would very much like to stop. They go stale because updating them is a separate act from running the club.",
      "Here it isn't. Three of the section types read your own records when a visitor loads the page — the meetings section is your calendar, the projects section is your projects, the officers section is this year's board. Record next week's speaker and the site has it. Nobody updates the website, because there is nothing to update.",
      "Around those, you write ordinary pages: your history, your committees, an FAQ, the auction. Sections rather than a blank text box, so the result is laid out properly whether or not anybody on the board has done this before. If you'd rather not start from nothing, it will draft a page from your club's own record and hand it to you to edit.",
      "Point your club's domain at it and we obtain the certificate. Your site serves at your address; the private side never does.",
    ],
    does: [
      "As many pages as you like, built from sections rather than a blank box",
      "Meetings, projects and officers that update themselves — nobody maintains them",
      "Your own domain, with the certificate handled, at no extra cost",
      "Colour and type from Rotary's own palette, with the contrast checked for you",
      "A join form that reaches the membership chair, with spam handled",
      "Donations, if the club wants them, straight into its own Stripe account",
      "Never shows your roster",
    ],
    limit:
      "It's a section builder, not a blank canvas — you choose from about eighteen kinds of section and fill them in, rather than dragging things wherever you like. That is a deliberate trade for a board that changes every July: it means nobody can make a page that looks wrong, and it means we can restyle every club's site at once. If your club has someone who genuinely wants pixel control, they will find this frustrating and should keep whatever they're using.",
  },
];

export function featureBySlug(slug: string): Feature | undefined {
  return FEATURES.find((f) => f.slug === slug);
}
