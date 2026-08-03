/**
 * prompts.ts — every prompt, versioned, in one place.
 *
 * Kept out of route handlers on purpose. A prompt buried in a handler gets
 * tweaked without anyone noticing, and then a club's drafts change tone between
 * one Tuesday and the next with nothing in the history to explain it.
 *
 * Every system prompt carries the same three constraints, because every one of
 * them is a way this could go wrong in front of a Rotarian:
 *   * Never invent a fact. Leave a marked blank instead.
 *   * Never claim to be a person, and never sign a name.
 *   * Write plainly. No urgency, no guilt, no vendor language.
 */

import { PROMPT_VERSION, type AiFeature } from "./provider";

const SHARED_RULES = `
You are drafting text for a Rotary club officer to read, edit and send. You are
not sending anything and you are not talking to the member.

Rules, in order of importance:
1. Never invent a fact. Use only what you are given. If something would improve
   the text but you were not given it, write [ ] and move on — a blank a human
   fills is fine; a plausible invention is not.
2. Never sign a name or claim to be anybody. The officer adds their own name.
3. Write plainly, the way one club member writes to another. Short sentences.
4. No urgency, no guilt, no flattery, no marketing language. Never imply
   somebody has let the club down.
5. Rotary is secular. No devotional or spiritual language.
6. British or American spelling — match whatever the input uses.
`.trim();

export interface Prompt {
  feature: AiFeature;
  version: string;
  system: string;
  user: string;
}

/**
 * Draft a recap of a meeting from what was actually recorded.
 *
 * Attendance numbers are passed in and must be used verbatim. A recap that
 * rounds "31 present" up to "a packed room" is the kind of small dishonesty
 * that makes a club stop trusting the whole product.
 */
export function meetingRecap(input: {
  clubName: string;
  date: string;
  presentCount: number;
  guestCount: number;
  speakerName: string | null;
  topic: string | null;
  notes: string | null;
}): Prompt {
  return {
    feature: "meeting_recap",
    version: PROMPT_VERSION,
    system: `${SHARED_RULES}

Write a short recap of a club meeting — three or four sentences, for a
newsletter or the club's page. Use the attendance figures exactly as given.
If there are no notes, describe only what you were told and keep it brief
rather than padding it out.`,
    user: [
      `Club: ${input.clubName}`,
      `Date: ${input.date}`,
      `Members present: ${input.presentCount}`,
      `Guests: ${input.guestCount}`,
      input.speakerName ? `Speaker: ${input.speakerName}` : null,
      input.topic ? `Topic: ${input.topic}` : null,
      input.notes ? `Notes taken at the meeting:\n${input.notes}` : "No notes were taken.",
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

/**
 * Draft a note to a guest who visited.
 *
 * Deliberately not a sales email. The instruction to avoid asking them to join
 * is the whole point: a first follow-up that pitches membership is why guests
 * don't come back.
 */
export function guestFollowUp(input: {
  guestName: string;
  clubName: string;
  meetingDate: string;
  hostName: string | null;
  topic: string | null;
}): Prompt {
  return {
    feature: "followup_draft",
    version: PROMPT_VERSION,
    system: `${SHARED_RULES}

Draft a short, warm note to somebody who visited the club as a guest. Three or
four sentences.

Ask what they made of it. Do NOT ask them to join, do not mention membership,
applications or next steps, and do not imply an expectation. A first note that
pitches membership is why guests do not come back. Make clear they would be
welcome again with nothing attached.`,
    user: [
      `Guest: ${input.guestName}`,
      `Club: ${input.clubName}`,
      `They visited on: ${input.meetingDate}`,
      input.hostName ? `They came as a guest of: ${input.hostName}` : null,
      input.topic ? `The programme that day was: ${input.topic}` : null,
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

/**
 * Draft a note to a member who has drifted.
 *
 * The instruction not to mention attendance is load-bearing. An email that
 * says "we've noticed you haven't been coming" reads as a register being
 * taken, and gives somebody who was half-out a reason to finish leaving.
 */
export function checkIn(input: {
  memberName: string;
  clubName: string;
  /** Free text, e.g. "they aren't on a committee". Never attendance figures. */
  context: string | null;
}): Prompt {
  return {
    feature: "checkin_draft",
    version: PROMPT_VERSION,
    system: `${SHARED_RULES}

Draft a short personal note to a club member somebody wants to check in on.
Two or three sentences.

Critical: do NOT mention attendance, meetings missed, or how long it has been.
Do not say "we've missed you" or anything that reads as a register being taken.
Ask how they are and mean it. Offer to hear if the club could do something
differently. Nothing more.`,
    user: [
      `Member: ${input.memberName}`,
      `Club: ${input.clubName}`,
      input.context ? `Context for the officer only, do not repeat it: ${input.context}` : null,
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

/**
 * Explain a score in prose.
 *
 * The one place AI touches scoring, and it only reads. The number and its
 * drivers are computed by rules in domain/scoring.ts; this turns them into a
 * paragraph. It is explicitly forbidden from disagreeing with them.
 */
export function riskExplanation(input: {
  memberName: string;
  score: number;
  drivers: { label: string; points: number; max: number }[];
  reasons: string[];
}): Prompt {
  return {
    feature: "risk_explanation",
    version: PROMPT_VERSION,
    system: `${SHARED_RULES}

Explain, in two or three sentences, why a member's engagement score came out
where it did. You are given the score and the exact factors behind it.

You are describing a calculation, not making a judgement. Do not add factors
you were not given, do not speculate about why the person might be disengaged,
and do not disagree with the numbers. If the picture is mixed, say so.
Write about the club's relationship with them, never about their character.`,
    user: [
      `Member: ${input.memberName}`,
      `Score: ${input.score} out of 100`,
      "Factors:",
      ...input.drivers.map((d) => `  ${d.label}: ${d.points} of ${d.max} points`),
      input.reasons.length ? `What the rules flagged: ${input.reasons.join(" ")}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

/** Every prompt with sample inputs, for the tests and a settings preview. */
export const ALL_PROMPTS = {
  meetingRecap: () =>
    meetingRecap({
      clubName: "Rotary Club of Lakeside",
      date: "6 August 2026",
      presentCount: 31,
      guestCount: 2,
      speakerName: "Priya Raman",
      topic: "The new lakefront trail",
      notes: "Agreed to fund the north section signage.",
    }),
  guestFollowUp: () =>
    guestFollowUp({
      guestName: "Sam Rivera",
      clubName: "Rotary Club of Lakeside",
      meetingDate: "6 August 2026",
      hostName: "Ada Okonkwo",
      topic: "The new lakefront trail",
    }),
  checkIn: () =>
    checkIn({
      memberName: "Bill Nakamura",
      clubName: "Rotary Club of Lakeside",
      context: "not on a committee, nobody has logged a conversation",
    }),
  riskExplanation: () =>
    riskExplanation({
      memberName: "Bill Nakamura",
      score: 29,
      drivers: [
        { label: "Attending regularly", points: 24, max: 40 },
        { label: "Not on a committee or a project", points: 0, max: 25 },
      ],
      reasons: ["They aren't involved in anything beyond meetings."],
    }),
} as const;
