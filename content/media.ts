/**
 * media.ts — the image slots, and the prompts that fill them.
 *
 * No images ship with the repository. Each slot below declares where a picture
 * goes, what it should show, and what it means for a reader who can't see it;
 * `scripts/generate-images.ts` turns the prompts into files with Workers AI,
 * and `<Media>` renders a slot only once its file exists. Until then the
 * layouts close up cleanly rather than showing a placeholder — a grey box with
 * a mountain glyph is worse than nothing, because it reads as broken.
 *
 * ## Writing prompts for this product
 *
 * Rotary is not a stock-photo boardroom. The prompts avoid: people in suits
 * shaking hands, laptop-and-coffee desks, glowing network diagrams, anything
 * that looks like a bank advertisement. What they aim for is ordinary rooms
 * where ordinary service actually happens — a function room at lunchtime, a
 * park on a Saturday, a table with too many chairs.
 *
 * Nobody's face is ever the subject. Partly because generated faces still look
 * wrong at a glance, and partly because a photograph of a specific smiling
 * person implies a member who does not exist. Backs, hands, rooms, middle
 * distance.
 *
 * ## Alt text
 *
 * Written here rather than at the call site, so it is composed alongside the
 * prompt by whoever is thinking about the image. Decorative slots carry an
 * empty string deliberately — a screen reader announcing "abstract background
 * texture" is noise, not access.
 */

export interface MediaSlot {
  /** Also the filename: app/media/<key>.<ext>. */
  key: string;
  /** Fed to the image model. */
  prompt: string;
  /** Empty string means decorative — the image adds nothing a reader needs. */
  alt: string;
  /** Width/height. The generator asks for this; the layout reserves it. */
  aspect: "16/9" | "4/3" | "3/2" | "1/1";
  /** Where it appears, so an unused slot is obvious. */
  usedOn: string;
}

/** Appended to every prompt, so the set looks like one set. */
export const HOUSE_STYLE =
  "Natural available light, muted colour, shallow depth of field, documentary photography, " +
  "unposed, no text, no logos, no watermarks, no recognisable faces, 35mm";

export const MEDIA: MediaSlot[] = [
  {
    key: "home-hero",
    prompt:
      "A community hall set for a weekly lunch meeting, seen from the back of the room. " +
      "Round tables with white cloths, water jugs, a small lectern at the front. " +
      "A few empty chairs among the full ones. Late morning light through high windows.",
    alt: "A community hall set up for a club's weekly lunch meeting, with a few empty chairs among the full ones",
    aspect: "16/9",
    usedOn: "/",
  },
  {
    key: "retention-hero",
    prompt:
      "A single empty chair at a round banquet table where the other places are used — " +
      "napkins moved, glasses half full. Warm indoor light, quiet, nobody in frame.",
    alt: "One empty place at a table where everyone else has been sitting",
    aspect: "3/2",
    usedOn: "/retention",
  },
  {
    key: "guests-spot",
    prompt:
      "Two people seen from behind at the edge of a busy function room, one gesturing " +
      "towards the tables as if introducing the other. Warm light, out of focus crowd beyond.",
    alt: "One member introducing a visitor to the room",
    aspect: "4/3",
    usedOn: "/features/guests",
  },
  {
    key: "projects-spot",
    prompt:
      "Volunteers' hands sorting tinned food into cardboard boxes on a trestle table in a " +
      "church hall. Daylight, no faces, work in progress.",
    alt: "Volunteers sorting donated food into boxes at a service project",
    aspect: "4/3",
    usedOn: "/features/projects",
  },
  {
    key: "handover-spot",
    prompt:
      "A worn ring binder and a folded agenda left on a wooden table beside two coffee cups, " +
      "one empty and one full. Afternoon light, nobody present.",
    alt: "A club's records left on a table between two officers",
    aspect: "4/3",
    usedOn: "/features/handover",
  },
  {
    key: "district-spot",
    prompt:
      "A wide daylight view over a small city and its surrounding towns from a hillside, " +
      "soft haze, no landmarks identifiable.",
    alt: "The spread of towns a Rotary district covers",
    aspect: "16/9",
    usedOn: "/features/district",
  },
  {
    key: "about-hero",
    prompt:
      "An ordinary weekday street of small independent shopfronts in a mid-sized town, " +
      "early morning, quiet, one shop light on.",
    alt: "A small town main street of the kind Rotary clubs are rooted in",
    aspect: "16/9",
    usedOn: "/about",
  },
  {
    key: "contact-spot",
    prompt:
      "A quiet corner table by a window with a notebook, a pen and a cooling cup of tea. " +
      "Soft daylight, nobody in frame.",
    alt: "",
    aspect: "3/2",
    usedOn: "/contact",
  },
];

export function mediaSlot(key: string): MediaSlot | undefined {
  return MEDIA.find((m) => m.key === key);
}

/** The full prompt sent to the model, house style included. */
export function promptFor(slot: MediaSlot): string {
  return `${slot.prompt} ${HOUSE_STYLE}`;
}
