import { Form, Link, useNavigation } from "react-router";
import type { Route } from "./+types/site-brand";
import { envContext } from "@worker/loadContext";
import { appMeta } from "~/seo";
import { getContext, requireNotDemo } from "@worker/context";
import {
  siteFor, getOrCreateSite, listBrandKits, createBrandKit, updateBrandKit,
  applyBrandKit, activeTokens, listMedia,
} from "@db/services/sites";
import {
  buildRamp, buildNeutralRamp, auditTokens, validateTokens, textOn,
  solidStep, FONT_PAIRS, DENSITIES, RAMP_STEPS, type BrandTokens,
} from "@domain/palette";
import {
  ROTARY_COLOURS, BRAND_PRESETS, LOGO_RULES, AREAS_OF_FOCUS, PEOPLE_OF_ACTION,
  BRAND_VOICE, TYPE_GUIDANCE, BRAND_CENTER_URL, paletteAdvice, rotaryColour,
} from "@content/rotary";
import { proposeBrand, type ClubFacts } from "@ai/site";
import { isConfigured } from "@ai/provider";
import { PageHeader, Card, Chip, Button, Field, Input, Select } from "~/ui";
import { Eyebrow } from "~/brand";

export function meta(_: Route.MetaArgs) {
  return appMeta("Brand studio");
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = await getContext(request, context.get(envContext));
  ctx.require("site.edit");
  const db = ctx.db();

  const club = await db.first<{
    id: string; name: string; city: string | null;
    state_code: string | null; charter_date: string | null;
  }>("clubs", { columns: "id, name, city, state_code, charter_date" });
  if (!club) throw new Response("This account has no club yet.", { status: 404 });

  const site = await getOrCreateSite(db, club, ctx.now, ctx.user?.id ?? null);
  const [kits, tokens, media] = await Promise.all([
    listBrandKits(db, club.id),
    activeTokens(db, site),
    listMedia(db, club.id, 40),
  ]);

  return {
    club: { name: club.name },
    activeKitId: site.brand_kit_id,
    tokens,
    warnings: auditTokens(tokens),
    advice: paletteAdvice(tokens.brandHex, tokens.accentHex),
    kits: kits.map((k) => {
      const parsed = validateTokens(JSON.parse(k.tokens_json || "{}"));
      return {
        id: k.id,
        name: k.name,
        source: k.source,
        applied: k.id === site.brand_kit_id,
        brandHex: parsed.brandHex,
        accentHex: parsed.accentHex,
      };
    }),
    media: media.map((m) => ({ id: m.id, filename: m.filename })),
    aiReady: isConfigured(ctx.env),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const ctx = await getContext(request, context.get(envContext));
  ctx.require("site.edit");
  const db = ctx.db();

  const club = await db.first<{
    id: string; name: string; city: string | null;
    state_code: string | null; charter_date: string | null;
    meeting_blurb: string | null; public_blurb: string | null;
  }>("clubs", {
    columns: "id, name, city, state_code, charter_date, meeting_blurb, public_blurb",
  });
  if (!club) return { error: "This account has no club yet." };

  const site = (await siteFor(db, club.id)) ?? (await getOrCreateSite(db, club, ctx.now, ctx.user?.id ?? null));
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "preset") {
    const preset = BRAND_PRESETS.find((p) => p.key === String(form.get("presetKey") ?? ""));
    if (!preset) return { error: "We don't have that one." };
    const kit = await createBrandKit(
      db,
      {
        clubId: club.id,
        name: preset.name,
        source: "preset",
        presetKey: preset.key,
        tokens: {
          brandHex: preset.brandHex,
          accentHex: preset.accentHex,
          fontPair: preset.fontPair,
          radius: preset.radius,
          density: preset.density,
        },
      },
      ctx.now,
    );
    await applyBrandKit(db, site, kit.id, ctx.now, ctx.user?.id ?? null);
    return { ok: true };
  }

  if (intent === "custom") {
    const tokens = {
      brandHex: String(form.get("brandHex") ?? ""),
      accentHex: String(form.get("accentHex") ?? ""),
      fontPair: String(form.get("fontPair") ?? ""),
      radius: String(form.get("radius") ?? ""),
      density: String(form.get("density") ?? ""),
      voice: { warmth: String(form.get("warmth") ?? "3"), note: String(form.get("voiceNote") ?? "") },
    };
    const logoMediaId = String(form.get("logoMediaId") ?? "") || null;

    // Edit the applied kit in place when it's one the club made; a preset is
    // copied first so "reset to Royal" still means something afterwards.
    const current = site.brand_kit_id
      ? await db.byId<{ id: string; source: string }>("brand_kits", site.brand_kit_id)
      : null;

    if (current && current.source === "manual") {
      await updateBrandKit(db, current.id, { tokens, logoMediaId }, ctx.now);
    } else {
      const kit = await createBrandKit(
        db,
        { clubId: club.id, name: `${club.name} colours`, source: "manual", tokens, logoMediaId },
        ctx.now,
      );
      await applyBrandKit(db, site, kit.id, ctx.now, ctx.user?.id ?? null);
    }
    return { ok: true, saved: true };
  }

  if (intent === "apply") {
    const result = await applyBrandKit(db, site, String(form.get("kitId") ?? ""), ctx.now, ctx.user?.id ?? null);
    return result.ok ? { ok: true } : { error: result.message };
  }

  if (intent === "ai") {
    requireNotDemo(ctx, "Proposing a colour scheme");

    const facts: ClubFacts = {
      name: club.name,
      city: club.city,
      stateCode: club.state_code,
      charterYear: club.charter_date ? club.charter_date.slice(0, 4) : null,
      meets: club.meeting_blurb,
      location: null,
      projects: await db
        .all<{ name: string; area_of_focus: string | null }>("projects", {
          columns: "name, area_of_focus",
          where: "club_id = ? AND is_public = 1",
          params: [club.id],
          limit: 10,
        })
        .then((rows) => rows.map((r) => ({ name: r.name, area: r.area_of_focus, summary: null }))),
      figures: [],
      notes: club.public_blurb,
    };

    const result = await proposeBrand(
      ctx.env,
      db,
      {
        facts,
        brief: String(form.get("brief") ?? "").slice(0, 500),
        clubId: club.id,
        userId: ctx.user?.id ?? null,
        today: ctx.today,
      },
      ctx.now,
    );

    if (!result.ok) return { error: result.message };

    // Saved, never applied. It sits in the list until somebody chooses it.
    await createBrandKit(
      db,
      { clubId: club.id, name: result.name, source: "ai", tokens: result.tokens },
      ctx.now,
    );
    return { ok: true, why: result.why };
  }

  return { error: "We didn't recognise that." };
}

// ── Pieces ────────────────────────────────────────────────────────────────────

function Swatch({ hex, label, small = false }: { hex: string; label?: string; small?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={`inline-block rounded border border-black/10 ${small ? "size-5" : "size-8"}`}
        style={{ backgroundColor: hex }}
        aria-hidden
      />
      {label && (
        <span className="text-sm text-ink-700 dark:text-ink-300">
          {label} <span className="text-ink-400">{hex}</span>
        </span>
      )}
    </div>
  );
}

function RampStrip({ hex }: { hex: string }) {
  const ramp = buildRamp(hex);
  if (!ramp) return null;
  return (
    <div className="flex overflow-hidden rounded-lg">
      {RAMP_STEPS.map((step) => (
        <span
          key={step}
          className="h-8 flex-1"
          style={{ backgroundColor: ramp[step] }}
          title={`${step} · ${ramp[step]}`}
        />
      ))}
    </div>
  );
}

/** The tokens rendered as the thing they actually produce. */
function Specimen({ tokens }: { tokens: BrandTokens }) {
  const brand = buildRamp(tokens.brandHex)!;
  const accent = buildRamp(tokens.accentHex)!;
  const ink = buildNeutralRamp(tokens.brandHex)!;
  const solid = brand[solidStep(brand)];
  const accentSolid = accent[solidStep(accent, 500)];
  const fonts = FONT_PAIRS[tokens.fontPair];

  return (
    <div
      className="overflow-hidden rounded-xl border"
      style={{ borderColor: ink[200], backgroundColor: "#fff" }}
    >
      <div className="px-6 py-8">
        <p
          className="text-xs font-semibold tracking-[0.14em] uppercase"
          style={{ color: brand[700] }}
        >
          Since 1948
        </p>
        <h3
          className="mt-2 text-2xl leading-tight font-semibold"
          style={{ fontFamily: fonts.display, color: ink[900] }}
        >
          Rotary Club of Lakeside
        </h3>
        <p className="mt-2 max-w-md" style={{ fontFamily: fonts.text, color: ink[700] }}>
          We're a group of people who meet on Thursdays and get things done. Visitors are welcome at
          any meeting.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <span
            className="inline-block px-4 py-2 text-sm font-medium"
            style={{
              backgroundColor: solid,
              color: textOn(solid),
              borderRadius: `${tokens.radius}px`,
              fontFamily: fonts.text,
            }}
          >
            Come to a meeting
          </span>
          <span
            className="inline-block border px-4 py-2 text-sm font-medium"
            style={{
              borderColor: ink[300],
              color: ink[900],
              borderRadius: `${tokens.radius}px`,
              fontFamily: fonts.text,
            }}
          >
            What we do
          </span>
        </div>
      </div>
      <div
        className="px-6 py-4 text-sm font-medium"
        style={{ backgroundColor: accentSolid, color: textOn(accentSolid), fontFamily: fonts.text }}
      >
        This is what your accent colour looks like carrying text.
      </div>
    </div>
  );
}

// ── The screen ────────────────────────────────────────────────────────────────

export default function BrandStudio({ loaderData, actionData }: Route.ComponentProps) {
  const { tokens, warnings, advice, kits, media, aiReady, club } = loaderData;
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <PageHeader
        title="Brand studio"
        subtitle={
          <>
            Colour, type and voice for {club.name}'s{" "}
            <Link to="/app/site" className="underline underline-offset-4">
              website
            </Link>
            . Everything here starts from Rotary's own palette, and everything here is yours to
            change.
          </>
        }
      />

      {actionData && "error" in actionData && actionData.error && (
        <p className="mb-6 rounded-lg border border-risk-500/30 bg-risk-500/5 px-4 py-3 text-sm text-ink-800 dark:text-ink-200">
          {actionData.error}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          <Card>
            <h2 className="mb-4 font-medium text-ink-900 dark:text-ink-100">What you have now</h2>
            <Specimen tokens={tokens} />

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <div>
                <p className="mb-1.5 text-sm text-ink-500">Main</p>
                <RampStrip hex={tokens.brandHex} />
              </div>
              <div>
                <p className="mb-1.5 text-sm text-ink-500">Accent</p>
                <RampStrip hex={tokens.accentHex} />
              </div>
            </div>

            {warnings.length > 0 && (
              <div className="mt-5 rounded-lg border border-watch-500/30 bg-watch-500/5 px-4 py-3 text-sm">
                <p className="font-medium text-ink-800 dark:text-ink-200">
                  Worth knowing — we're not going to stop you:
                </p>
                <ul className="mt-1 space-y-1 text-ink-700 dark:text-ink-300">
                  {warnings.map((w, i) => (
                    <li key={i}>
                      <strong>{w.where}:</strong> {w.message} ({w.ratio}:1)
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {advice && (
              <p className="mt-4 rounded-lg bg-ink-50 px-4 py-3 text-sm text-ink-700 dark:bg-ink-800/40 dark:text-ink-300">
                {advice}
              </p>
            )}
          </Card>

          {/* ── Presets ─────────────────────────────────────────────────── */}
          <Card>
            <h2 className="font-medium text-ink-900 dark:text-ink-100">Start from one of these</h2>
            <p className="mt-1 mb-4 text-sm text-ink-600 dark:text-ink-400">
              Every one is inside the Rotary palette, so picking any of them puts you on-brand
              without having to think about it.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {BRAND_PRESETS.map((preset) => (
                <Form method="post" key={preset.key}>
                  <input type="hidden" name="intent" value="preset" />
                  <input type="hidden" name="presetKey" value={preset.key} />
                  <button className="w-full rounded-xl border border-ink-200 p-4 text-left transition hover:border-brand-400 dark:border-ink-800">
                    <span className="mb-3 flex gap-1.5">
                      <span
                        className="inline-block size-7 rounded"
                        style={{ backgroundColor: preset.brandHex }}
                        aria-hidden
                      />
                      <span
                        className="inline-block size-7 rounded"
                        style={{ backgroundColor: preset.accentHex }}
                        aria-hidden
                      />
                    </span>
                    <span className="block font-medium text-ink-900 dark:text-ink-100">
                      {preset.name}
                    </span>
                    <span className="block text-sm text-ink-500">{preset.blurb}</span>
                  </button>
                </Form>
              ))}
            </div>
          </Card>

          {/* ── Custom ──────────────────────────────────────────────────── */}
          <Card>
            <h2 className="font-medium text-ink-900 dark:text-ink-100">Or set it yourself</h2>
            <p className="mt-1 mb-4 text-sm text-ink-600 dark:text-ink-400">
              Pick two colours and we work out the other eighteen — every tint, every shade, and
              which of black or white can be read on each. You can't produce an unreadable site from
              here.
            </p>

            <Form method="post" className="space-y-4">
              <input type="hidden" name="intent" value="custom" />

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Main colour" name="brandHex" hint="Headers, buttons, links.">
                  <div className="flex gap-2">
                    <input
                      type="color"
                      name="brandHex"
                      defaultValue={tokens.brandHex}
                      className="h-10 w-16 rounded-lg border border-ink-300 dark:border-ink-700"
                    />
                    <Input defaultValue={tokens.brandHex} readOnly className="font-mono" tabIndex={-1} />
                  </div>
                </Field>
                <Field label="Accent" name="accentHex" hint="One band, one rule, sparingly.">
                  <div className="flex gap-2">
                    <input
                      type="color"
                      name="accentHex"
                      defaultValue={tokens.accentHex}
                      className="h-10 w-16 rounded-lg border border-ink-300 dark:border-ink-700"
                    />
                    <Input defaultValue={tokens.accentHex} readOnly className="font-mono" tabIndex={-1} />
                  </div>
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Type" name="fontPair">
                  <Select id="fontPair" name="fontPair" defaultValue={tokens.fontPair}>
                    {Object.entries(FONT_PAIRS).map(([key, pair]) => (
                      <option key={key} value={key}>
                        {pair.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Corners" name="radius" hint="0 is formal, 16 is friendly.">
                  <Input
                    id="radius"
                    type="number"
                    name="radius"
                    min={0}
                    max={24}
                    defaultValue={tokens.radius}
                  />
                </Field>
                <Field label="Spacing" name="density">
                  <Select id="density" name="density" defaultValue={tokens.density}>
                    {DENSITIES.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>

              <Field
                label="Your logo"
                name="logoMediaId"
                hint={`Get your club signature free from the Brand Center — you're licensed to have it.`}
              >
                <Select id="logoMediaId" name="logoMediaId" defaultValue="">
                  <option value="">None yet</option>
                  {media.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.filename}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field
                label="How the club sounds"
                name="voiceNote"
                hint="One sentence, in your own words. Drafting reads this; it's never printed."
              >
                <Input
                  id="voiceNote"
                  name="voiceNote"
                  maxLength={240}
                  defaultValue={tokens.voice.note}
                  placeholder="We're a working lunch club. Nobody wears a tie."
                />
              </Field>
              <input type="hidden" name="warmth" value={tokens.voice.warmth} />

              <Button variant="secondary">Save these</Button>
            </Form>
          </Card>

          {/* ── Rotary reference ────────────────────────────────────────── */}
          <Card>
            <Eyebrow tone="gold">The Rotary kit</Eyebrow>
            <h2 className="mt-3 font-medium text-ink-900 dark:text-ink-100">The official palette</h2>
            <p className="mt-1 mb-4 text-sm text-ink-600 dark:text-ink-400">
              Royal Blue and Gold are the emblem. The rest are secondaries — meant one or two at a
              time, not nine.
            </p>
            <ul className="grid gap-3 sm:grid-cols-2">
              {ROTARY_COLOURS.map((c) => (
                <li key={c.key}>
                  <Swatch hex={c.hex} label={c.name} />
                  <p className="mt-1 ml-10 text-xs text-ink-500">{c.use}</p>
                </li>
              ))}
            </ul>

            <h3 className="mt-8 font-medium text-ink-900 dark:text-ink-100">Your logo</h3>
            <ul className="mt-3 space-y-3">
              {LOGO_RULES.map((rule) => (
                <li key={rule.title}>
                  <p className="font-medium text-ink-800 dark:text-ink-200">{rule.title}</p>
                  <p className="text-sm text-ink-600 dark:text-ink-400">{rule.body}</p>
                </li>
              ))}
            </ul>
            <a
              href={BRAND_CENTER_URL}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-block text-sm underline underline-offset-4 hover:text-brand-700"
            >
              Rotary Brand Center ↗
            </a>

            <h3 className="mt-8 font-medium text-ink-900 dark:text-ink-100">
              Writing like people of action
            </h3>
            <p className="mt-1 text-sm text-ink-600 dark:text-ink-400">{PEOPLE_OF_ACTION.premise}</p>
            <ol className="mt-3 space-y-2">
              {PEOPLE_OF_ACTION.structure.map((step) => (
                <li key={step.step} className="text-sm">
                  <span className="font-medium text-ink-800 dark:text-ink-200">{step.step}.</span>{" "}
                  <span className="text-ink-600 dark:text-ink-400">{step.guidance}</span>
                </li>
              ))}
            </ol>
            <p className="mt-4 text-sm font-medium text-ink-800 dark:text-ink-200">Worth avoiding</p>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-ink-600 dark:text-ink-400">
              {PEOPLE_OF_ACTION.avoid.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>

            <h3 className="mt-8 font-medium text-ink-900 dark:text-ink-100">The voice</h3>
            <dl className="mt-3 grid gap-3 sm:grid-cols-2">
              {BRAND_VOICE.traits.map((t) => (
                <div key={t.key}>
                  <dt className="font-medium text-ink-800 capitalize dark:text-ink-200">{t.key}</dt>
                  <dd className="text-sm text-ink-600 dark:text-ink-400">{t.note}</dd>
                </div>
              ))}
            </dl>

            <h3 className="mt-8 font-medium text-ink-900 dark:text-ink-100">Setting type</h3>
            <ul className="mt-2 space-y-2 text-sm text-ink-600 dark:text-ink-400">
              <li>{TYPE_GUIDANCE.headline}</li>
              <li>{TYPE_GUIDANCE.body}</li>
              <li>{TYPE_GUIDANCE.measure}</li>
            </ul>

            <h3 className="mt-8 font-medium text-ink-900 dark:text-ink-100">
              The seven areas of focus
            </h3>
            <p className="mt-1 text-sm text-ink-600 dark:text-ink-400">
              Tagging a project with one of these makes it speak Rotary, and makes it roll up to the
              district in a shape they already use.
            </p>
            <ul className="mt-3 space-y-2">
              {AREAS_OF_FOCUS.map((area) => (
                <li key={area.key} className="flex gap-3">
                  <span
                    className="mt-1.5 inline-block size-3 shrink-0 rounded-full"
                    style={{ backgroundColor: rotaryColour(area.colour)?.hex }}
                    aria-hidden
                  />
                  <span>
                    <span className="block font-medium text-ink-800 dark:text-ink-200">
                      {area.name}
                    </span>
                    <span className="block text-sm text-ink-600 dark:text-ink-400">{area.blurb}</span>
                  </span>
                </li>
              ))}
            </ul>

            <p className="mt-8 border-t border-ink-100 pt-4 text-xs text-ink-500 dark:border-ink-800">
              Rotary International owns the Rotary marks; your club is licensed to use them and
              Sodalitas is not. We ship colour values and layout advice, never the emblem itself —
              download your club signature from the Brand Center, where it's yours by right. Where
              your district has told you something different from this page, your district is right.
            </p>
          </Card>
        </div>

        {/* ── Side column ──────────────────────────────────────────────── */}
        <div className="space-y-6">
          <Card>
            <h3 className="font-medium text-ink-900 dark:text-ink-100">Ask for a scheme</h3>
            {aiReady ? (
              <>
                <p className="mt-1 mb-3 text-sm text-ink-600 dark:text-ink-400">
                  It can only choose from Rotary's palette, and it lands in the list below without
                  changing anything.
                </p>
                <Form method="post" className="space-y-3">
                  <input type="hidden" name="intent" value="ai" />
                  <Input
                    name="brief"
                    maxLength={500}
                    placeholder="Something warmer. We're mostly under 40."
                  />
                  <Button variant="secondary" className="w-full" disabled={busy}>
                    {busy ? "Thinking…" : "Propose a scheme"}
                  </Button>
                </Form>
                {actionData && "why" in actionData && actionData.why && (
                  <p className="mt-3 rounded-lg bg-ink-50 px-3 py-2 text-sm text-ink-700 dark:bg-ink-800/40 dark:text-ink-300">
                    {actionData.why}
                  </p>
                )}
              </>
            ) : (
              <p className="mt-1 text-sm text-ink-600 dark:text-ink-400">
                Not switched on for this club. Everything else on this screen works.
              </p>
            )}
          </Card>

          <Card>
            <h3 className="mb-3 font-medium text-ink-900 dark:text-ink-100">Your schemes</h3>
            <ul className="space-y-3">
              {kits.map((kit) => (
                <li key={kit.id} className="flex items-center justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="flex shrink-0 gap-1">
                      <Swatch hex={kit.brandHex} small />
                      <Swatch hex={kit.accentHex} small />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-ink-800 dark:text-ink-200">
                        {kit.name}
                      </span>
                      <span className="text-xs text-ink-500">
                        {kit.source === "ai" ? "proposed" : kit.source}
                      </span>
                    </span>
                  </span>
                  {kit.applied ? (
                    <Chip tone="steady">In use</Chip>
                  ) : (
                    <Form method="post">
                      <input type="hidden" name="intent" value="apply" />
                      <input type="hidden" name="kitId" value={kit.id} />
                      <Button variant="quiet" className="px-2">
                        Use this
                      </Button>
                    </Form>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
