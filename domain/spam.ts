/**
 * spam.ts — scoring public form submissions.
 *
 * A public "join our club" form is a spam magnet, and a Rotary club's form is
 * a particularly attractive one: it reaches a room of local business owners.
 *
 * The posture, taken from CROS and worth repeating: **accept spam silently.**
 * A submission that scores as spam gets exactly the same friendly thank-you as
 * a real one and is then filed away where the club can review it. Telling a bot
 * it was caught teaches whoever wrote it which rule to change; telling a real
 * person their genuine message "looks like spam" is worse still.
 *
 * The one thing we do report is a real mistake — a missing name, an address
 * with no @ — because that is a person who wants to reach the club and can't.
 * Spam never reaches that branch.
 */

export interface Submission {
  name: string;
  email: string;
  message: string;
  /** Hidden field. A human never fills this in; a naive bot fills everything. */
  honeypot: string;
  /** Milliseconds between the form rendering and being submitted. */
  elapsedMs: number;
}

export interface SpamVerdict {
  /** False only for genuine human mistakes worth reporting back. */
  valid: boolean;
  /** Shown to the sender when `valid` is false. Kind and specific. */
  message: string | null;
  isSpam: boolean;
  score: number;
  /** For the club's review screen. Never shown to the sender. */
  reasons: string[];
}

/** At or above this, the submission is filed as spam. */
export const SPAM_THRESHOLD = 5;
/** A form completed faster than this was not read. */
const MIN_ELAPSED_MS = 2_500;

const PITCH_PHRASES = [
  "seo services", "search engine optimization", "increase your traffic",
  "guest post", "link building", "backlink", "web design services",
  "digital marketing", "crypto", "bitcoin", "forex", "investment opportunity",
  "make money", "work from home", "loan offer", "casino", "viagra",
  "cheap", "discount code", "limited offer", "click here", "act now",
  "dear sir/madam", "dear sir or madam", "to whom it may concern",
  "i am reaching out", "i hope this email finds you well",
];

/** Domains that look like a real one at a glance. */
const LOOKALIKE_DOMAINS = [
  "gmial.com", "gmai.com", "gmal.com", "gnail.com", "hotmial.com",
  "yahoo.co", "outlok.com", "rotary-international.org",
];

const URL_RE = /https?:\/\/|www\./gi;

function looksLikeEmail(email: string): boolean {
  const e = email.trim();
  if (e.length < 6 || e.length > 254) return false;
  const at = e.indexOf("@");
  if (at < 1 || at !== e.lastIndexOf("@")) return false;
  const domain = e.slice(at + 1);
  return domain.includes(".") && !domain.startsWith(".") && !domain.endsWith(".") && !/\s/.test(e);
}

/**
 * Score a submission.
 *
 * Layered rather than any single test, because each signal on its own has a
 * false-positive rate a club would notice. A message with one link from a
 * real address with a real name gets through; three links, a pitch phrase and
 * a two-second fill does not.
 */
export function scoreSubmission(s: Submission): SpamVerdict {
  const reasons: string[] = [];
  let score = 0;

  // ── Real mistakes, reported back ──
  const name = s.name.trim();
  const email = s.email.trim();

  // Only report these when the submission is otherwise human-looking, so we
  // never hand a bot a diagnostic.
  const humanLooking = !s.honeypot.trim() && s.elapsedMs >= MIN_ELAPSED_MS;

  if (humanLooking && name.length < 2) {
    return {
      valid: false,
      message: "We need a name and an email address we can reply to — that's all.",
      isSpam: false,
      score: 0,
      reasons: [],
    };
  }
  if (humanLooking && !looksLikeEmail(email)) {
    return {
      valid: false,
      message: "That email address doesn't look quite right. Mind checking it?",
      isSpam: false,
      score: 0,
      reasons: [],
    };
  }

  // ── Spam signals ──
  if (s.honeypot.trim()) {
    score += 10;
    reasons.push("filled the hidden field");
  }

  if (s.elapsedMs > 0 && s.elapsedMs < MIN_ELAPSED_MS) {
    score += 4;
    reasons.push("submitted too fast to have read the form");
  }

  const body = `${name} ${s.message}`.toLowerCase();

  const links = (s.message.match(URL_RE) ?? []).length;
  if (links >= 3) {
    score += 5;
    reasons.push(`${links} links`);
  } else if (links > 0) {
    score += 2;
    reasons.push("contains a link");
  }

  const pitches = PITCH_PHRASES.filter((p) => body.includes(p));
  if (pitches.length > 0) {
    score += Math.min(pitches.length * 3, 6);
    reasons.push(`sales language (${pitches.slice(0, 2).join(", ")})`);
  }

  const domain = email.slice(email.indexOf("@") + 1).toLowerCase();
  if (LOOKALIKE_DOMAINS.includes(domain)) {
    score += 4;
    reasons.push(`look-alike domain (${domain})`);
  }

  // A name that is a URL or has no letters in it.
  if (URL_RE.test(name) || !/[a-z]/i.test(name)) {
    score += 4;
    reasons.push("name doesn't look like a name");
  }

  // Bulk submitters paste the same block everywhere; it's usually long and
  // says nothing about this club.
  if (s.message.length > 1200 && !/\b(club|rotary|meeting|member|join|visit)\b/i.test(s.message)) {
    score += 3;
    reasons.push("long message that never mentions the club");
  }

  if (/(.)\1{9,}/.test(s.message)) {
    score += 3;
    reasons.push("repeated characters");
  }

  return {
    valid: true,
    message: null,
    isSpam: score >= SPAM_THRESHOLD,
    score,
    reasons,
  };
}
