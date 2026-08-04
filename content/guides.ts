/**
 * guides.ts — the guides registry.
 *
 * Written for club officers, not for search engines, on the theory that the
 * only durable way to be found is to be the page somebody would have wanted
 * anyway. Each one answers a question a membership chair or president actually
 * asks, and each one is useful to a club that never buys anything.
 *
 * They are structured data rather than markdown files so that the same content
 * feeds the page, the sitemap and llms.txt without a parser and without three
 * copies drifting apart. The voice rules in content/brand.ts are enforced over
 * this registry by guides.test.ts, exactly as they are over the email
 * templates — marketing copy is where a voice slips first.
 *
 * Two rules for adding one:
 *   * It must be worth reading by a club that will never be a customer.
 *   * Where we have a number, use the number. Where we don't, say we don't.
 */

export interface GuideSection {
  heading: string;
  paragraphs: string[];
  /** Rendered as a list after the paragraphs. */
  list?: string[];
}

export interface Guide {
  slug: string;
  title: string;
  /** One sentence. Used on the index, in the sitemap and in llms.txt. */
  summary: string;
  /** Who it's for, said plainly, so people can skip it. */
  audience: string;
  /** YYYY-MM-DD. Shown, because an undated guide is untrustworthy. */
  updated: string;
  sections: GuideSection[];
}

export const GUIDES: Guide[] = [
  {
    slug: "why-members-leave",
    title: "Why members leave Rotary clubs, and what shows up first",
    summary:
      "Members almost never resign over a grievance. They drift, and the drift is visible months earlier in attendance, involvement and who last spoke to them.",
    audience: "Membership chairs, club presidents",
    updated: "2026-08-04",
    sections: [
      {
        heading: "The resignation is not the event",
        paragraphs: [
          "When a club loses a member, the resignation email arrives as a surprise. It usually shouldn't have been one. By the time somebody writes it, they have generally been gone for months in every way except the roster.",
          "The sequence is remarkably consistent. A member misses a meeting for an ordinary reason — work, travel, a sick parent. Nothing happens. They miss the next one because the first absence made the second easier. Nobody calls, because everybody assumes somebody else did. Six weeks later they feel awkward about coming back, and awkwardness is a far more powerful force than any of us like to admit.",
          "What ends the membership is not a decision. It is the absence of a phone call in week three.",
        ],
      },
      {
        heading: "What actually predicts it",
        paragraphs: [
          "Three things carry most of the signal, and only one of them is attendance.",
        ],
        list: [
          "Attendance trend, not attendance rate. A member at 60% who used to be at 90% is in more trouble than a steady 60% who has always been a 60%. The change is the information; the level is mostly personality and work schedule.",
          "Involvement beyond showing up. Someone on a committee or a service project has reasons to be there that survive a bad month. Someone who only ever attends has one thread holding them, and it is thin.",
          "Days since a human spoke to them. Not an email blast. A call, a note, a conversation that acknowledged them specifically. This is the one clubs track least and the one that moves most.",
        ],
      },
      {
        heading: "The trap in attendance data",
        paragraphs: [
          "Attendance is the easiest thing to measure and therefore the thing clubs over-weight. It produces two errors in opposite directions.",
          "The first is treating a busy season as disengagement. An accountant vanishing in tax season is not drifting; they are working. A club that chases them with concern in March is being tiresome, and being tiresome costs you the credibility you need in September.",
          "The second is worse. A member who attends every single week, says little, is on no committee and hasn't been spoken to properly in a year looks perfect on an attendance report. They are often the next resignation, and nothing in the attendance data will tell you.",
        ],
      },
      {
        heading: "What to do in week three",
        paragraphs: [
          "One person, one member, one specific reason. Not a committee discussion about engagement.",
          "The call that works is short and has no agenda: you were missed, is everything all right, here's what you missed, hope to see you Thursday. It must come from somebody who actually knows them. A call from a stranger holding a list is worse than no call, because it tells the member they are a task on somebody's spreadsheet.",
          "If they are going through something — and often they are — the right answer is almost never about the club. Say the club will be there when they are ready, mean it, and then be there. Clubs that handle a hard year well keep people for decades.",
        ],
      },
      {
        heading: "What not to do",
        paragraphs: [
          "Do not send the whole club an email about attendance. Everybody who reads it is by definition attending, and the person it was aimed at now knows exactly what the club thinks of them.",
          "Do not put somebody's attendance percentage on a screen at a meeting. It has never once produced attendance and it reliably produces resignations.",
          "Do not wait for the annual review. July is the month clubs discover who left, which is roughly nine months after the point where anything could have been done about it.",
        ],
      },
    ],
  },

  {
    slug: "first-ninety-days",
    title: "The first ninety days of a new member",
    summary:
      "Most members who leave within two years were lost in their first three months. What the club does in that window matters more than anything after it.",
    audience: "Membership chairs, sponsors, club presidents",
    updated: "2026-08-04",
    sections: [
      {
        heading: "The window is shorter than it feels",
        paragraphs: [
          "A new member arrives with more goodwill than they will ever have again. They came to meetings before they had to. They said yes. Whatever they hoped Rotary would be, they still believe it on their first day.",
          "That belief has a shelf life. If it isn't converted into a specific relationship and a specific job within about three months, it decays into politeness — and a polite member is a member who will quietly not renew.",
        ],
      },
      {
        heading: "Three things, in order",
        paragraphs: [
          "Almost every successful onboarding does the same three things, and the order matters more than the content.",
        ],
        list: [
          "A person before a role. One member who is explicitly, by name, responsible for them — sitting with them, introducing them, answering the questions they are embarrassed to ask. A sponsor in name only is worse than none, because everyone assumes the job is done.",
          "A job before an induction. Something small, real, and finishable within a month. Running the raffle. Bringing a guest. Helping at one project. People commit to what they have contributed to, and a member who has done something is a member with a reason to come back.",
          "A reason to be missed. By ninety days there should be somebody who notices when they aren't there. That is the whole trick. Everything else is administration.",
        ],
      },
      {
        heading: "What the induction ceremony does and doesn't do",
        paragraphs: [
          "It matters, and it is not onboarding. A badge, a certificate and a round of applause mark a beginning; they don't create one. Clubs that do a warm induction and nothing else lose the same people as clubs that do nothing.",
          "If the induction is the last time the club does something deliberate about that member, the club has held a small ceremony to mark the start of a departure.",
        ],
      },
      {
        heading: "The questions nobody asks out loud",
        paragraphs: [
          "New members almost never ask these, and almost always want to know. Answer them before they have to.",
        ],
        list: [
          "How much is this going to cost me in a year — dues, meals, the projects everyone chips in for, the raffle?",
          "What happens if I can't come for a while?",
          "Who is everyone? A room where everybody else already knows each other is exhausting for months.",
          "What am I actually supposed to do here beyond attending?",
          "Is it all right to say no to something?",
        ],
      },
      {
        heading: "How to tell it worked",
        paragraphs: [
          "At ninety days, ask the sponsor two questions. Who does this member talk to when they arrive? What have they done for the club that they chose to do?",
          "If the honest answers are \"me\" and \"nothing yet\", there is still time, and that is worth knowing in month three rather than month twenty.",
        ],
      },
    ],
  },

  {
    slug: "july-handover",
    title: "Handing over in July without losing the club's memory",
    summary:
      "Rotary leadership turns over every year, and the club's institutional memory usually turns over with it. A short checklist for keeping what the last board knew.",
    audience: "Outgoing and incoming club officers",
    updated: "2026-08-04",
    sections: [
      {
        heading: "What actually gets lost",
        paragraphs: [
          "The spreadsheet gets handed over. The password gets handed over, eventually, usually in October. What doesn't get handed over is everything that was in the outgoing president's head.",
          "Which member is going through a divorce and should be asked gently. Which local business said to come back in the spring. Why that project stalled and whose feelings are still involved. Who introduced whom. That knowledge is the club, and it evaporates every July because there was never anywhere to put it.",
          "The result is a club that restarts every year from the roster — which is why a club can spend a decade rediscovering the same things.",
        ],
      },
      {
        heading: "A handover that takes an afternoon",
        paragraphs: [
          "Not a manual. Four conversations and one written list.",
        ],
        list: [
          "The members you were worried about, and why. By name. This is the single most valuable thing the outgoing board knows and the thing least likely to be written down.",
          "The guests and prospective members in flight, whose turn it is, and what was last said to them. Handovers are where a visitor who came three times quietly becomes nobody's job.",
          "The commitments already made in the club's name — to a partner charity, a school, a business, another club. The ones nobody wrote down are the ones that damage a reputation when they're dropped.",
          "The things that were tried and didn't work, with the honest reason. Otherwise next year's board will try them again, at the same cost, in the same order.",
        ],
      },
      {
        heading: "Access, and taking it back",
        paragraphs: [
          "Every year, clubs discover that a treasurer from three years ago still has access to the bank, the mailing list and the member database. Nobody meant it; nobody remembered.",
          "The fix is to give access with an end date on the day you grant it, rather than to remember to remove it later. Nobody has ever reliably remembered to remove it later. If your tools support expiry, set every officer's access to end on 30 June. If they don't, put one recurring calendar entry in July and treat it as seriously as the audit.",
        ],
      },
      {
        heading: "What the incoming board should ask for",
        paragraphs: [
          "Ask for the worry list first. Not the budget, not the calendar — those are written down somewhere and can be found. The worry list exists only in one person's memory, and you have a few weeks before it fades.",
          "Then ask what the outgoing president would do differently with another year. They have just spent twelve months learning it and are about to stop being responsible for it, which is the most candid anyone gets.",
        ],
      },
    ],
  },

  {
    slug: "moving-club-software",
    title: "Moving a club off ClubRunner or DACdb without losing anything",
    summary:
      "What to export first, what never comes across cleanly, and the honest reasons to stay where you are.",
    audience: "Club secretaries, presidents, anyone who has been asked to look into it",
    updated: "2026-08-04",
    sections: [
      {
        heading: "Export before you decide anything",
        paragraphs: [
          "Whatever you end up doing, get your data out and keep a copy. Clubs discover the shape of their own records only when they look at the export, and it is much better to discover it while you still have both systems.",
          "Ask for the member list, the attendance history, and any dues or payment history. Take the widest export offered, even the columns you think are junk.",
        ],
      },
      {
        heading: "What usually comes across cleanly",
        paragraphs: [
          "Names, addresses, phone numbers, email addresses, join dates, classifications and membership types generally survive any move, because everybody stores them roughly the same way.",
        ],
      },
      {
        heading: "What usually doesn't",
        paragraphs: [
          "Be realistic about these before you promise the board a clean migration.",
        ],
        list: [
          "Attendance history at meeting-by-meeting resolution. Often it comes out as totals or percentages, and the individual meetings are gone.",
          "Anything free-text — notes, follow-up history, why somebody left. This is where the club's memory lives and it is rarely in the export at all.",
          "Website content and page layouts. These essentially never transfer between systems, and any vendor who says otherwise is describing a rebuild.",
          "Photographs and documents, which usually have to be downloaded by hand and are the part everyone underestimates.",
          "Anything tied to Rotary International synchronisation, which is a relationship between your club and RI rather than a file you own.",
        ],
      },
      {
        heading: "Do it in the right month",
        paragraphs: [
          "Move in the quiet stretch after the July handover and before the autumn programme starts, with the incoming secretary involved from the first day. A migration run by an outgoing officer in June produces a system nobody who has to use it understands.",
          "Run both systems for one full dues cycle. It costs a couple of months of overlap and it is the difference between a bad week and a bad year.",
        ],
      },
      {
        heading: "Good reasons not to move",
        paragraphs: [
          "Said plainly, because a guide that only argues one way isn't worth reading.",
          "If your district pays for DACdb, it is effectively free to your club, and free is difficult to beat. If your club runs paid events — a fundraiser with ticketing, registration and a guest list — ClubRunner does that and we do not. If your club synchronises membership data directly with Rotary International and relies on that, check carefully before moving; Sodalitas does not do it yet.",
          "On websites we used to send clubs to ClubRunner outright. We build sites now, and ours has something theirs doesn't: the meetings, projects and officers sections read your live records, so they cannot go stale. What ClubRunner still has is free-form layout — if somebody at your club wants a page arranged exactly their way, ours will frustrate them.",
          "And if the only complaint is that the current system is ugly, that is a real cost but it is smaller than the cost of a migration. Wait until there is a second reason.",
        ],
      },
    ],
  },

  {
    slug: "what-clubs-pay",
    title: "What a Rotary club actually spends on software",
    summary:
      "The subscription is rarely the whole bill. A method for working out your real number, including the tools nobody remembers you pay for.",
    audience: "Club treasurers, presidents, boards approving a budget",
    updated: "2026-08-04",
    sections: [
      {
        heading: "The number on the invoice is not the number",
        paragraphs: [
          "Most clubs can tell you what their club management system costs. Very few can tell you what the club spends on software, because the spend is spread across several people's personal cards and two years of board minutes.",
          "The exercise below takes about twenty minutes and the answer is usually between two and four times what anyone guessed.",
        ],
      },
      {
        heading: "Count all of it",
        paragraphs: [
          "Go through the last twelve months of the club's statements and the treasurer's reimbursements, and look for:",
        ],
        list: [
          "The club management system or website platform, and its domain name.",
          "Email — a bulk sending tool, or an inbox the club pays for.",
          "Payment processing for dues, plus any separate invoicing tool.",
          "Event ticketing, used a few times a year and charged per event.",
          "Sign-up sheets and volunteer rosters, often on somebody's personal subscription.",
          "Form tools, survey tools, and the one file-storage account that holds the club's photographs.",
          "Anything a past officer set up and still pays for personally, which the club will inherit the moment they step down.",
        ],
      },
      {
        heading: "Then count the part that isn't money",
        paragraphs: [
          "The hours matter more than the fees and are almost never counted. Re-keying the same member into three systems. Reconciling a dues spreadsheet against a bank statement. Chasing the one person who has the login.",
          "You don't need a precise figure. You need enough of one to have an honest conversation about whether consolidating is worth the disruption, because for some clubs it genuinely isn't.",
        ],
      },
      {
        heading: "What to do with the answer",
        paragraphs: [
          "If the total is small and the club is content, stop. This is not a problem worth solving and there are better uses of a board meeting.",
          "If the total is large, the useful question is not which system is cheapest. It is how many separate things the club would still be paying for afterwards. Replacing one $40 subscription with a different $35 subscription while keeping the other five is not a saving; it is an afternoon.",
          "Our own pricing, and a comparison that names where the alternatives do more than we do, are on the pricing and compare pages. We would rather you did this arithmetic properly and concluded we were the wrong answer than the reverse.",
        ],
      },
    ],
  },
];

/** Look one up. Returns undefined for an unknown slug — routes turn that into a 404. */
export function guideBySlug(slug: string): Guide | undefined {
  return GUIDES.find((g) => g.slug === slug);
}

/** Rough reading time, from the words actually on the page. */
export function readingMinutes(guide: Guide): number {
  const words = guide.sections.reduce(
    (n, s) =>
      n +
      s.heading.split(/\s+/).length +
      s.paragraphs.join(" ").split(/\s+/).length +
      (s.list?.join(" ").split(/\s+/).length ?? 0),
    0,
  );
  // 220wpm is about right for prose somebody is skimming for an answer.
  return Math.max(1, Math.round(words / 220));
}
