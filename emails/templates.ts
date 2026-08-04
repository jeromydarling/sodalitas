/**
 * templates.ts — every email the product sends.
 *
 * All of them in one file, in plain text, so the whole voice can be read at
 * once and nothing drifts. Rotary is secular and slightly allergic to being
 * sold to; these read like a note from a person at the club, because that is
 * what they are standing in for.
 *
 * Two rules, both tested:
 *   * Nothing here manufactures urgency or lays on guilt. A club that feels
 *     nagged by its own software stops opening the tab.
 *   * Anything that isn't transactional carries a one-click unsubscribe.
 */

import { brand } from "@content/brand";

export interface Template {
  subject: string;
  text: string;
  /** Transactional mail bypasses suppression and needs no unsubscribe line. */
  transactional: boolean;
}

const SIGN_OFF = (clubName: string) => `\n\n— ${clubName}`;

/**
 * The opt-out footer.
 *
 * An empty token degrades to a sentence with no link rather than emitting
 * `.../unsubscribe/` with nothing after it. That dead URL shipped once already:
 * a caller passed `""` and every recipient got a link to a 404. A footer that
 * can't be rendered broken is worth more than a rule saying don't do that.
 *
 * Still worth minting a real token at every call site — this is the floor, not
 * the intent. `issueUnsubscribeToken` in emails/unsubscribe.ts is one await.
 */
function unsubscribeLine(appUrl: string, token: string): string {
  const opener = `\n\n———\nYou're getting this because you're on the club's list. `;
  if (!token) {
    return opener + `If you'd rather not, reply to this email and we'll take you off.`;
  }
  return opener + `If you'd rather not: ${appUrl}/unsubscribe/${token}`;
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export function signInLink(opts: { url: string; appUrl: string }): Template {
  return {
    transactional: true,
    subject: `Your sign-in link`,
    text:
      `Here's your link to sign in to ${brand.name}:\n\n` +
      `${opts.url}\n\n` +
      `It works once and lasts an hour. If you didn't ask for it you can ignore this — ` +
      `nobody can get in without the link.`,
  };
}

export function welcomeAfterSignup(opts: { firstName: string; clubName: string; appUrl: string }): Template {
  return {
    transactional: true,
    subject: `${opts.clubName} is set up`,
    text:
      `Hello ${opts.firstName},\n\n` +
      `${opts.clubName} is ready. Your next few months of meetings are already on the ` +
      `calendar, so there's something to record attendance against straight away.\n\n` +
      `The one thing worth doing first is getting your roster in — everything else reads ` +
      `from it:\n\n${opts.appUrl}/app/import\n\n` +
      `Export a CSV from whatever you're using now and paste it in. We'll show you exactly ` +
      `what we'd do before anything changes, and you can undo it afterwards.`,
  };
}

export function teamInvite(opts: {
  inviterName: string;
  clubName: string;
  roleLabel: string;
  url: string;
}): Template {
  return {
    transactional: true,
    subject: `${opts.inviterName} has added you to ${opts.clubName}`,
    text:
      `${opts.inviterName} has set you up as ${opts.roleLabel} for ${opts.clubName} ` +
      `on ${brand.name}.\n\n` +
      `${opts.url}\n\n` +
      `The link signs you in — there's no password to make up. It's good for a week.`,
  };
}

// ── The club talking to people ────────────────────────────────────────────────

export function guestFollowUp(opts: {
  guestName: string;
  clubName: string;
  senderName: string;
  meetingDate: string;
  unsubscribeToken: string;
  appUrl: string;
}): Template {
  return {
    transactional: false,
    // Drafted for a human to edit and send. Nothing in this product emails a
    // guest on its own.
    subject: `Good to see you at ${opts.clubName}`,
    text:
      `Hello ${opts.guestName},\n\n` +
      `It was good to have you with us. I hope you enjoyed it — and I'd genuinely like to ` +
      `know what you made of it, whether or not it's for you.\n\n` +
      `You're welcome back any week, with no expectation attached.\n\n` +
      `${opts.senderName}` +
      SIGN_OFF(opts.clubName) +
      unsubscribeLine(opts.appUrl, opts.unsubscribeToken),
  };
}

export function checkIn(opts: {
  firstName: string;
  clubName: string;
  senderName: string;
  unsubscribeToken: string;
  appUrl: string;
}): Template {
  return {
    transactional: false,
    // Deliberately not "we've missed you at meetings" — that reads as a
    // register being taken, and the point is to ask after the person.
    subject: `How are you?`,
    text:
      `Hello ${opts.firstName},\n\n` +
      `No agenda here — I just realised we haven't caught up in a while and wanted to see ` +
      `how you're doing.\n\n` +
      `If there's something the club could be doing differently, I'd like to hear it.\n\n` +
      `${opts.senderName}` +
      SIGN_OFF(opts.clubName) +
      unsubscribeLine(opts.appUrl, opts.unsubscribeToken),
  };
}

export function meetingReminder(opts: {
  firstName: string;
  clubName: string;
  date: string;
  time: string | null;
  location: string | null;
  topic: string | null;
  speaker: string | null;
  unsubscribeToken: string;
  appUrl: string;
}): Template {
  const where = [opts.time, opts.location].filter(Boolean).join(", ");
  const programme = opts.topic
    ? `\n\nThis week: ${opts.topic}${opts.speaker ? `, with ${opts.speaker}` : ""}.`
    : "";
  return {
    transactional: false,
    subject: `${opts.clubName} — ${opts.date}`,
    text:
      `Hello ${opts.firstName},\n\n` +
      `A reminder that we're meeting on ${opts.date}${where ? ` — ${where}` : ""}.` +
      programme +
      `\n\nBring someone if you'd like to. Guests are always welcome.` +
      SIGN_OFF(opts.clubName) +
      unsubscribeLine(opts.appUrl, opts.unsubscribeToken),
  };
}

export function duesReminder(opts: {
  firstName: string;
  clubName: string;
  amount: string;
  periodLabel: string;
  payUrl: string | null;
  unsubscribeToken: string;
  appUrl: string;
}): Template {
  return {
    transactional: false,
    subject: `${opts.clubName} dues — ${opts.periodLabel}`,
    text:
      `Hello ${opts.firstName},\n\n` +
      `Your dues for ${opts.periodLabel} come to ${opts.amount}.` +
      (opts.payUrl ? `\n\nYou can pay here: ${opts.payUrl}` : `\n\nThe treasurer can take it however suits you.`) +
      // Said plainly, because it is true and because it is the thing somebody
      // in difficulty most needs to hear.
      `\n\nIf the timing is awkward, say so — we would far rather keep you than the dues.` +
      SIGN_OFF(opts.clubName) +
      unsubscribeLine(opts.appUrl, opts.unsubscribeToken),
  };
}

export function joinAcknowledgement(opts: { name: string; clubName: string }): Template {
  return {
    transactional: true,
    subject: `Thanks for getting in touch with ${opts.clubName}`,
    text:
      `Hello ${opts.name},\n\n` +
      `Thanks for your note — someone from the club will be in touch shortly.\n\n` +
      `You're welcome to come along to a meeting before deciding anything. There's no ` +
      `commitment in visiting, and lunch is usually on us the first time.` +
      SIGN_OFF(opts.clubName),
  };
}

export function receipt(opts: {
  name: string;
  clubName: string;
  amount: string;
  what: string;
  date: string;
}): Template {
  return {
    transactional: true,
    subject: `Receipt from ${opts.clubName}`,
    text:
      `Hello ${opts.name},\n\n` +
      `Thank you. We've recorded ${opts.amount} for ${opts.what} on ${opts.date}.\n\n` +
      `Keep this for your records.` +
      SIGN_OFF(opts.clubName),
  };
}

/** Every template, for the voice tests and a settings-page preview. */
export const ALL_TEMPLATES = {
  signInLink: () => signInLink({ url: "https://example.test/auth/magic/abc", appUrl: "https://example.test" }),
  welcomeAfterSignup: () =>
    welcomeAfterSignup({ firstName: "Ada", clubName: "Rotary Club of Lakeside", appUrl: "https://example.test" }),
  teamInvite: () =>
    teamInvite({
      inviterName: "Ada Okonkwo",
      clubName: "Rotary Club of Lakeside",
      roleLabel: "Club Treasurer",
      url: "https://example.test/invite/abc",
    }),
  guestFollowUp: () =>
    guestFollowUp({
      guestName: "Sam",
      clubName: "Rotary Club of Lakeside",
      senderName: "Ada",
      meetingDate: "6 August",
      unsubscribeToken: "tok",
      appUrl: "https://example.test",
    }),
  checkIn: () =>
    checkIn({
      firstName: "Bill",
      clubName: "Rotary Club of Lakeside",
      senderName: "Ada",
      unsubscribeToken: "tok",
      appUrl: "https://example.test",
    }),
  meetingReminder: () =>
    meetingReminder({
      firstName: "Bill",
      clubName: "Rotary Club of Lakeside",
      date: "Thursday 6 August",
      time: "12:00",
      location: "Blue Water Grill",
      topic: "The new lakefront trail",
      speaker: "Priya Raman",
      unsubscribeToken: "tok",
      appUrl: "https://example.test",
    }),
  duesReminder: () =>
    duesReminder({
      firstName: "Bill",
      clubName: "Rotary Club of Lakeside",
      amount: "$150",
      periodLabel: "2026 first half",
      payUrl: null,
      unsubscribeToken: "tok",
      appUrl: "https://example.test",
    }),
  joinAcknowledgement: () => joinAcknowledgement({ name: "Sam", clubName: "Rotary Club of Lakeside" }),
  receipt: () =>
    receipt({
      name: "Bill",
      clubName: "Rotary Club of Lakeside",
      amount: "$150",
      what: "dues, 2026 first half",
      date: "6 August 2026",
    }),
} as const;
