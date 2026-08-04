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

/**
 * Editing anything below regenerates every image.
 *
 * This file is the trigger for .github/workflows/images.yml, which runs the
 * generator with the Cloudflare token in Actions, converts the results to WebP
 * and commits them. So a prompt change is a one-line edit and a push — nobody
 * needs an API token on their laptop to change what a picture looks like.
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

/**
 * Appended to every prompt, so the set looks like one set.
 *
 * The negatives are longer than they look like they need to be, and each one
 * is here because the model did it anyway on the first run:
 *
 *   **Faces.** "No recognisable faces" was read as "no *famous* faces" and
 *   produced eight volunteers in sharp focus. Generated people are the single
 *   clearest AI tell on a marketing site, and this product's whole argument is
 *   that it doesn't make things up. So the instruction is now positive and
 *   specific — say what the camera sees, not what it must avoid.
 *
 *   **Letterboxing.** Asked for a 16/9 landscape, FLUX drew a widescreen
 *   *photograph* — black cinema bars baked into the pixels, which render as a
 *   black band on the page.
 *
 *   **Signage.** "No text" still produced shopfronts lettered in convincing
 *   gibberish. Blank signage has to be asked for.
 */
export const HOUSE_STYLE =
  "Natural available light, muted colour, shallow depth of field, documentary photography, " +
  "unposed, 35mm. Fills the entire frame edge to edge — no letterboxing, no black bars, " +
  "no borders, no vignette frame. All signs and labels blank: no text, no lettering, " +
  "no shop names, no logos, no watermarks.";

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
    // Rewritten after the first run put two people in sharp three-quarter
    // profile. "Seen from behind" wasn't enough — the camera position has to
    // be stated, and the faces ruled out in the same breath.
    prompt:
      "Photographed from directly behind two people standing at the edge of a busy function " +
      "room. The camera is behind them at shoulder height; we see the backs of their heads and " +
      "their shoulders only, and no face is visible anywhere in the picture. One has an arm " +
      "raised towards the tables. Warm light, the crowd beyond thrown well out of focus.",
    alt: "One member introducing a visitor to the room",
    aspect: "4/3",
    usedOn: "/features/guests",
  },
  {
    key: "projects-spot",
    // "Volunteers' hands… no faces" produced eight full-length volunteers.
    // The fix is to describe the crop rather than to forbid the subject.
    prompt:
      "Close overhead crop of a trestle table, camera looking straight down. Two pairs of " +
      "hands and forearms reach in from the edges of the frame to pack tins into cardboard " +
      "boxes. Nothing above the elbows is in shot and there are no people visible. Daylight " +
      "from a high window, work half finished.",
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
    // Came back letterboxed: a widescreen *photograph*, black bars and all,
    // inside a 16/9 canvas. Asking for the frame to be filled is the fix.
    prompt:
      "A wide daylight view over a small city and its surrounding towns from a hillside, " +
      "soft haze, no landmarks identifiable. The photograph fills the whole frame corner to " +
      "corner with no bars, borders or matting of any kind.",
    alt: "The spread of towns a Rotary district covers",
    aspect: "16/9",
    usedOn: "/features/district",
  },
  {
    key: "about-hero",
    // Was a street of shopfronts, and shopfronts mean signs — which FLUX
    // letters in convincing gibberish however firmly you ask it not to. Two
    // runs, two streets of nonsense words. Fighting a diffusion model over
    // text is a losing game, so the subject changed instead: a town square
    // with no shopfront in it has nothing to letter.
    prompt:
      "A small town square on an overcast weekday morning. A war memorial, a few benches, " +
      "bare plane trees, wet paving, a red brick civic building behind. No shopfronts, no " +
      "signage, no vehicles, nobody about.",
    alt: "The kind of small town square a Rotary club is rooted in",
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
