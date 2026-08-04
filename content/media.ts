/**
 * media.ts — the image slots, and the prompts that fill them.
 *
 * `scripts/generate-images.ts` turns the prompts into files with Workers AI,
 * and `<Media>` renders a slot only once its file exists. Until then the
 * layouts close up cleanly rather than showing a placeholder — a grey box with
 * a mountain glyph is worse than nothing, because it reads as broken.
 *
 * ## The rule that had to go
 *
 * This set spent four rounds trying to show people without showing a face —
 * first by forbidding faces, then by blurring them, then by silhouetting them.
 * Every one of those is a contortion, and contorted photographs look contorted.
 * Motion blur in particular reads as a mistake rather than as a technique when
 * it is the only thing holding a picture together.
 *
 * The real problem was never faces. It was **crowds**. Ask any of these models
 * for thirty people in a community hall and you get thirty badly-drawn people,
 * and — left to choose — always the same thirty: elderly, white, sparse, in
 * what looks like a funeral reception. That is the picture that undid the
 * argument the copy was making, and no amount of blur was going to fix a
 * composition that was wrong before the shutter opened.
 *
 * So the rule now is about **cast size, not faces**:
 *
 *   **One to three people, or none.** These models render two people at a
 *   table beautifully and thirty people in a hall appallingly, and a club is
 *   better represented by two members talking than by a wide shot of a room
 *   anyway. Half the set is objects and rooms, which is what a good stock
 *   library looks like too.
 *
 *   **Faces are fine.** At this cast size they come out looking like
 *   photographs, and a face doing something ordinary is worth more than a
 *   clever crop that avoids one.
 *
 *   **Say who they are.** With two people in frame it matters more, not less.
 *   Left unsaid the model picks, and it picks the same way every time.
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
  // The cast rule, in the place it can't be forgotten. Crowds are where these
  // models fall apart and where the stereotype lives; three people is the
  // most any of these prompts asks for.
  "At most three people anywhere in the picture — never a crowd, never a full room of people.";

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
    // Four rounds went into rendering a full room and every one failed. This
    // one doesn't try: two people at a table, which is a photograph these
    // models make well, and which says more about a club than a wide shot of
    // thirty strangers ever did. At 18% behind a headline the room around
    // them is all the backdrop needs.
    prompt:
      "Two club members sitting across the corner of a table in a community hall, mid " +
      "conversation — a woman in her thirties listening, a man in his sixties talking with a " +
      "hand raised. Coffee cups and a notebook between them. Tall windows behind throwing " +
      "bright daylight across the table, the rest of the hall soft and out of focus.",
    alt: "",
    aspect: "21/9",
    treatment: "backdrop",
    usedOn: "/",
  },
  {
    key: "home-work",
    prompt:
      "Two volunteers in high-visibility vests planting a young tree at the edge of a park on " +
      "a bright cold Saturday morning — a man in his forties holding the sapling upright, a " +
      "woman in her twenties treading the soil in. A spade and a watering can beside them, " +
      "bare trees behind, low winter sun and long shadows.",
    alt: "A club work party unloading tools at the start of a service project",
    aspect: "21/9",
    treatment: "band",
    usedOn: "/",
  },
  {
    key: "home-welcome",
    prompt:
      "Exactly two women greeting each other just inside the door of a hall: a member in her " +
      "fifties with a welcoming hand out, and a visitor in her thirties still holding her " +
      "coat. Both smiling, caught mid-sentence rather than posed. Warm light from the room " +
      "beyond, thrown out of focus.",
    alt: "A member welcoming a visitor at the door",
    aspect: "1/1",
    treatment: "detail",
    usedOn: "/",
  },
  {
    key: "home-evening",
    // "Seen from outside through a window" gave the model three planes to
    // reconcile — street, glass, interior — and it resolved them as a
    // triptych with a hard seam and an invented neon sign. One plane, and
    // three people rather than a room of them.
    // "…and two others listening" is how four white men in overcoats got in.
    // Every person in a prompt gets described or the model supplies its own,
    // and the one it supplies is always the same.
    prompt:
      "Exactly three people standing talking with coats on at the end of an evening meeting, " +
      "nobody in a hurry to leave — a Black woman in her thirties laughing, a man in his " +
      "fifties with his hands in his pockets, a woman in her twenties beside him. Stacked " +
      "chairs and a cleared table behind them, warm lamplight overhead, the rest of the hall " +
      "dark.",
    alt: "Three members still talking after the meeting has finished",
    aspect: "21/9",
    treatment: "band",
    usedOn: "/",
  },

  // ── Feature and content pages ───────────────────────────────────────────
  {
    key: "retention-hero",
    // The one image in the set that is *supposed* to be about absence, and
    // the only place emptiness is the argument rather than an accident.
    // Three runs of "one used place among many" produced a pleasant, fully
    // laid table with no story in it — a contrast across eight place settings
    // is more bookkeeping than a diffusion model will do. One chair, alone,
    // is a picture it can make.
    prompt:
      "A single empty chair standing alone in the middle of a large emptied function room, " +
      "every other chair stacked against the far wall. Bare floor, late afternoon light " +
      "across it from one window. Nobody in frame.",
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
      "Exactly two people at a lunch table: a South Asian woman in her forties leaning in to " +
      "say something to a first-time visitor beside her, a man in his twenties, both half " +
      "turned towards each other and smiling. Plates and glasses in front of them, the room " +
      "behind out of focus.",
    alt: "A member sitting with a visitor at lunch",
    aspect: "4/3",
    treatment: "plate",
    usedOn: "/features/guests",
  },
  {
    key: "projects-spot",
    prompt:
      "Two volunteers packing tins into cardboard boxes on a trestle table in a church hall — " +
      "a man in his sixties and a woman in her thirties working opposite each other, heads " +
      "down, half the boxes filled. Daylight from a high window.",
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
