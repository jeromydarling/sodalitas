/**
 * media.ts — the image slots, and the prompts that fill them.
 *
 * `scripts/generate-images.ts` turns the prompts into files with Workers AI,
 * and `<Media>` renders a slot only once its file exists. Until then the
 * layouts close up cleanly rather than showing a placeholder — a grey box with
 * a mountain glyph is worse than nothing, because it reads as broken.
 *
 * ## What went wrong the first time, because it shapes everything below
 *
 * The first set had one rule about people — "no recognisable faces" — and it
 * produced exactly two outcomes. Empty rooms, which read as *abandoned*. And,
 * where the model did put people in, a sparse group of elderly white people in
 * a church hall: the precise stereotype Rotary spends its public-image budget
 * fighting, on the front page of a product about clubs not dying. One picture
 * undid the argument the copy was making.
 *
 * The mistake was thinking of the rule as a prohibition. A prohibition tells a
 * diffusion model what to leave out and nothing about what to make, so it falls
 * back on its priors — and its prior for "community hall meeting" is a funeral
 * reception. The fix is to describe the photograph you want: where the camera
 * is, what the shutter is doing, who is in the room.
 *
 * So the direction now is:
 *
 *   **Motion, not absence.** A slow shutter renders a room full of people as
 *   warmth and movement. Nobody's face resolves, which was the point, but the
 *   room reads as alive rather than empty — and a blurred figure has no age or
 *   race for the model to stereotype.
 *
 *   **Hands and gestures at close range.** A hand pulling out a chair says
 *   welcome more clearly than a wide shot of a room, and it crops the problem
 *   out of frame instead of forbidding it.
 *
 *   **Say who is there.** Where people appear at any distance, the prompt names
 *   a mixed-age group explicitly. Left unsaid, the model picks, and it picks
 *   wrong for this audience every time.
 *
 * ## Alt text
 *
 * Written here rather than at the call site, so it is composed alongside the
 * prompt by whoever is thinking about the image. Decorative slots carry an
 * empty string deliberately — a screen reader announcing "abstract background
 * texture" is noise, not access.
 *
 * ## Editing anything below regenerates every image
 *
 * This file is the trigger for .github/workflows/images.yml, which runs the
 * generator with the Cloudflare token in Actions, converts the results to WebP
 * and commits them. A prompt change is a one-line edit and a push — nobody
 * needs an API token on their laptop to change what a picture looks like.
 */

/**
 * How a slot is rendered, which the prompt has to know about.
 *
 * A backdrop is going to sit at 18% opacity behind a headline, so it needs a
 * quiet middle and no detail worth reading. A detail is 300px wide in a
 * column and needs one legible subject. Same generator, different pictures.
 */
export type MediaTreatment =
  /** Full-bleed behind text, heavily faded. Composition matters, detail doesn't. */
  | "backdrop"
  /** A framed photograph in the flow of the page. */
  | "plate"
  /** Edge-to-edge across a section band, short and wide. */
  | "band"
  /** Small, in a column or beside a paragraph. One subject, close. */
  | "detail";

export interface MediaSlot {
  /** Also the filename: app/media/<key>.<ext>. */
  key: string;
  /** What the picture is of. The film stock and treatment are appended. */
  prompt: string;
  /** Empty string means decorative — the image adds nothing a reader needs. */
  alt: string;
  /** Width/height. The generator asks for this; the layout reserves it. */
  aspect: "16/9" | "4/3" | "3/2" | "1/1" | "21/9";
  treatment: MediaTreatment;
  /** Where it appears, so an unused slot is obvious. Checked by a test. */
  usedOn: string;
}

/**
 * The film.
 *
 * Named stock rather than adjectives. "Natural light, muted colour" is the
 * kind of instruction that produces a clean digital render with the saturation
 * pulled down — which is what the first set looked like. Portra 400 with
 * halation and visible grain produces something that looks *photographed*,
 * and the imperfection is most of why: a slightly wrong horizon and a blown
 * highlight are things a camera does and a renderer doesn't.
 */
export const FILM =
  "Shot on 35mm film, Kodak Portra 400, visible film grain, gentle halation blooming around " +
  "the highlights, warm cast, soft shadow roll-off, slight vignette, handheld and imperfectly " +
  "framed, shallow depth of field, no digital sharpening, no HDR";

/**
 * Appended to every prompt on top of the film stock.
 *
 * Each negative is here because the model did it anyway on an earlier run.
 * Faces and lettering are the two things that make an image read as generated,
 * and letterboxing is the one that breaks the layout outright.
 */
export const HOUSE_STYLE =
  `${FILM}. A still photograph, not a film still and not a cinematic frame — ` +
  // "35mm film" reads as cinema to the model as readily as it reads as a
  // camera, and cinema means bars. Two slots came back letterboxed before
  // this line existed, one of them twice.
  "fills the entire frame edge to edge, no letterboxing, no black bars, no borders, no matting. " +
  "All signs and labels blank: no text, no lettering, no shop names, no logos, no watermarks. " +
  "No face is sharply rendered anywhere in the picture.";

/**
 * How treatment changes the shot.
 *
 * Appended after the house style, so one line in the registry decides both
 * where an image goes and how it is composed.
 */
const TREATMENT_DIRECTION: Record<MediaTreatment, string> = {
  backdrop:
    "Composed as a background: the middle of the frame is quiet and uncluttered, interest " +
    "pushed to the edges, low contrast, nothing a viewer would want to read.",
  plate: "Composed as a photograph in its own right, with a clear subject.",
  band: "A wide horizontal crop, the subject running across the frame.",
  detail: "Close in on one subject, filling the frame, everything else thrown out of focus.",
};

export const MEDIA: MediaSlot[] = [
  // ── Home ────────────────────────────────────────────────────────────────
  //
  // Four images across the page rather than one. The homepage argument runs:
  // this is a club (alive), this is the work (outside, hands), this is what
  // welcome looks like (close, human), come and see (evening, warm). The
  // pictures carry that arc; before, one wide shot of an empty hall carried
  // the opposite of it.
  {
    key: "home-hero",
    // The one that has to work hardest. A long exposure is doing two jobs:
    // it makes a room of people read as warmth rather than as individuals,
    // and it means no face exists to be rendered badly or stereotyped.
    prompt:
      "Inside a busy community hall at lunchtime, photographed on a long exposure from the " +
      "back of the room. Twenty or thirty people of mixed ages, thirties through seventies, " +
      "around round tables — every figure softened into motion blur, nobody still, the room " +
      "clearly full. Tall windows throwing bright daylight across the tables. Warm, busy, " +
      "slightly overexposed.",
    alt: "",
    aspect: "21/9",
    treatment: "backdrop",
    usedOn: "/",
  },
  {
    key: "home-work",
    prompt:
      "Outdoors on a bright Saturday morning: a work party in high-visibility vests unloading " +
      "timber and tools from the back of a pickup truck at the edge of a park. A mixed group, " +
      "several of them in their thirties, one crouching over a toolbox. Caught mid-movement, " +
      "long shadows, breath visible in the cold.",
    alt: "A club work party unloading tools at the start of a service project",
    aspect: "21/9",
    treatment: "band",
    usedOn: "/",
  },
  {
    key: "home-welcome",
    // Welcome, at the scale it actually happens. A wide shot of a room says
    // nothing; one chair pulled out says the whole thing.
    //
    // Was "a hand pulling out a chair", and the hand is why it changed: hands
    // are the thing diffusion models are worst at, and two runs produced
    // something between a glove and a claw on the front page. The chair alone
    // carries the same meaning and has no anatomy to get wrong.
    prompt:
      "One empty banquet chair pulled back and turned slightly out from a table already laid " +
      "for lunch — a water jug, glasses, a folded napkin at the place. Room made for somebody " +
      "who hasn't arrived yet. No people anywhere in the picture. Warm indoor light, shot wide " +
      "open, the rest of the room dissolved behind.",
    alt: "A chair pulled out at a table laid for lunch, waiting for somebody",
    aspect: "1/1",
    treatment: "detail",
    usedOn: "/",
  },
  {
    key: "home-evening",
    // "Seen from outside through a window" gave the model three planes to
    // reconcile — street, glass, interior — and it resolved them as a
    // triptych with a hard vertical seam down the middle and an invented
    // neon sign. One plane instead: stand in the doorway.
    prompt:
      "Standing in the open doorway of a hall at the end of an evening meeting, looking in. " +
      "A mixed-age group, thirties through sixties, still standing about in twos and threes " +
      "talking, all of them softened by motion blur. Warm lamplight, chairs pushed back, " +
      "coats over arms. Nobody leaving yet.",
    alt: "A club still talking after the meeting has finished",
    aspect: "21/9",
    treatment: "band",
    usedOn: "/",
  },

  // ── Feature and content pages ───────────────────────────────────────────
  {
    key: "retention-hero",
    // The one image in the set that is *supposed* to be about absence, and
    // the only place emptiness is the argument rather than an accident.
    prompt:
      "A round banquet table after lunch. Every place around it has been used — crumpled " +
      "napkins, drained glasses, chairs pushed back at angles — except one, where the napkin " +
      "is still folded, the glass still full and the cutlery untouched. The empty setting is " +
      "in the foreground and clearly the subject. Nobody in frame, late afternoon light.",
    alt: "One empty place at a table where everyone else has been sitting",
    aspect: "3/2",
    treatment: "plate",
    usedOn: "/retention",
  },
  {
    key: "guests-spot",
    // Three runs of "two people from behind, crowd beyond" produced, in
    // order: two faces in profile, an elderly crowd, and two elderly men in
    // suits with an elderly crowd. The framing kept inviting the model to
    // populate a room and it kept populating it the same way.
    //
    // So the subject changed to the object instead of the people. A tray of
    // blank badges by the door is what a club that expects visitors looks
    // like, and it says it without a single person in frame.
    prompt:
      "Close on a tray of blank white adhesive name badges and a marker pen on a small table " +
      "just inside a doorway, one badge already peeled from the backing sheet. All the badges " +
      "are entirely blank with no writing on them. Beyond the table, a room out of focus and " +
      "full of warm light. Nobody in frame.",
    alt: "Blank name badges laid out by the door for visitors",
    aspect: "4/3",
    treatment: "plate",
    usedOn: "/features/guests",
  },
  {
    key: "projects-spot",
    prompt:
      "Close overhead crop of a trestle table, camera looking straight down. Two pairs of hands " +
      "and forearms reach in from the edges of the frame to pack tins into cardboard boxes. " +
      "Nothing above the elbows is in shot. Daylight from a high window, the work half finished.",
    alt: "Volunteers sorting donated food into boxes at a service project",
    aspect: "4/3",
    treatment: "plate",
    usedOn: "/features/committees",
  },
  {
    key: "handover-spot",
    prompt:
      "A worn ring binder and a folded agenda left on a wooden table beside two coffee cups, " +
      "one drained and one full. Afternoon light across the grain of the table, nobody present.",
    alt: "A club's records left on a table between two officers",
    aspect: "4/3",
    treatment: "plate",
    usedOn: "/features/handover",
  },
  {
    key: "district-spot",
    prompt:
      "A wide daylight view over a small city and the towns around it from a hillside, soft " +
      "haze flattening the distance, no landmark identifiable. The photograph fills the whole " +
      "frame corner to corner.",
    alt: "The spread of towns a Rotary district covers",
    aspect: "16/9",
    treatment: "plate",
    usedOn: "/features/district",
  },
  {
    key: "about-hero",
    // Was a street of shopfronts, and shopfronts mean signs — which FLUX
    // letters in convincing gibberish however firmly you ask it not to. Two
    // runs, two streets of nonsense words. Fighting a diffusion model over
    // text is a losing game, so the subject changed instead.
    prompt:
      "A small town square on an overcast weekday morning. A war memorial, a few benches, bare " +
      "plane trees, wet paving, a red brick civic building behind. No shopfronts, no signage, " +
      "no vehicles, nobody about.",
    alt: "The kind of small town square a Rotary club is rooted in",
    aspect: "16/9",
    treatment: "plate",
    usedOn: "/about",
  },
  {
    key: "contact-spot",
    prompt:
      "A quiet corner table by a window with a notebook open, a pen across the page and a cup " +
      "of tea going cold. Soft daylight from the side, nobody in frame.",
    alt: "",
    aspect: "3/2",
    treatment: "detail",
    usedOn: "/contact",
  },
];

export function mediaSlot(key: string): MediaSlot | undefined {
  return MEDIA.find((m) => m.key === key);
}

/** The full prompt: subject, then how it's shot, then how it's used. */
export function promptFor(slot: MediaSlot): string {
  return `${slot.prompt} ${TREATMENT_DIRECTION[slot.treatment]} ${HOUSE_STYLE}`;
}
