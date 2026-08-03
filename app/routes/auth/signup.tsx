import { Form, Link, redirect, useNavigation } from "react-router";
import type { Route } from "./+types/signup";
import { envContext } from "@worker/loadContext";
import { brand } from "@content/brand";
import { marketingMeta } from "~/seo";
import { Button, Field, Input, Select } from "~/ui";
import { looksLikeEmail, normalizeEmail, hashIp } from "@worker/auth/crypto";
import { checkAll, recordFailure } from "@worker/auth/ratelimit";
import { createSession, sessionCookie, shouldUseSecureCookie } from "@worker/auth/session";
import { clientIp } from "@worker/context";
import { createClubAccount } from "@db/services/onboarding";
import { ROLES } from "@domain/roles";

export function meta(_: Route.MetaArgs) {
  return marketingMeta({
    title: "Start a club account",
    description: `Set up ${brand.name} for your Rotary or Rotaract club. Takes about two minutes.`,
    path: "/signup",
  });
}

/** The offices most likely to be doing the signing up. */
const SIGNUP_ROLES = [
  "club_secretary",
  "club_president",
  "club_admin",
  "membership_chair",
  "club_treasurer",
] as const;

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.get(envContext);
  const form = await request.formData();

  const email = String(form.get("email") ?? "").trim();
  const firstName = String(form.get("firstName") ?? "").trim();
  const lastName = String(form.get("lastName") ?? "").trim();
  const clubName = String(form.get("clubName") ?? "").trim();

  const fail = (error: string) => ({ error });

  if (!firstName || !lastName) return fail("We need your name so the club has a first member.");
  if (!looksLikeEmail(email)) return fail("That email address doesn't look quite right.");
  if (clubName.length < 3) return fail("What's the club called? The full name is fine.");

  const ipKey = await hashIp(clientIp(request), env.IP_HASH_SECRET ?? "dev");
  const limit = await checkAll(env.KV, [
    { rule: "magicLink", subject: normalizeEmail(email) },
    { rule: "magicLinkIp", subject: ipKey },
  ]);
  if (!limit.allowed) {
    return fail("That's a few attempts in a short time. Give it fifteen minutes and try again.");
  }

  // A club that already exists under this account is almost always a
  // double-submit, not a second club. Say so plainly rather than making two.
  const existing = await env.DB.prepare(
    `SELECT c.name FROM clubs c
       JOIN tenant_users tu ON tu.tenant_id = c.tenant_id
       JOIN users u ON u.id = tu.user_id
      WHERE u.email_norm = ? LIMIT 1`,
  )
    .bind(normalizeEmail(email))
    .first<{ name: string }>();

  if (existing) {
    await recordFailure(env.KV, "magicLink", normalizeEmail(email));
    return fail(
      `That address already runs ${existing.name}. Sign in instead, and you can add another club from Settings.`,
    );
  }

  const now = new Date().toISOString();
  const result = await createClubAccount(
    env,
    {
      email,
      firstName,
      lastName,
      clubName,
      riNumber: String(form.get("riNumber") ?? "").trim() || null,
      city: String(form.get("city") ?? "").trim() || null,
      stateCode: String(form.get("stateCode") ?? "").trim() || null,
      roleKey: String(form.get("roleKey") ?? "club_secretary"),
      meetingWeekday: Number(form.get("meetingWeekday") ?? 4),
      meetingTime: String(form.get("meetingTime") ?? "12:00"),
      meetingLocation: String(form.get("meetingLocation") ?? "").trim() || null,
    },
    now,
  );

  // Signed straight in. Making someone who just typed their address go and
  // fetch a link from their inbox is a step that loses people for no security
  // gain — they proved control of nothing either way at this point.
  const { token } = await createSession(env, {
    userId: result.userId,
    tenantId: result.tenantId,
    userAgent: request.headers.get("User-Agent"),
    ipHash: ipKey,
  });

  return redirect("/app", {
    headers: { "Set-Cookie": sessionCookie(token, { secure: shouldUseSecureCookie(request) }) },
  });
}

export default function Signup({ actionData }: Route.ComponentProps) {
  const nav = useNavigation();
  const busy = nav.state === "submitting";

  return (
    <main className="mx-auto max-w-lg px-6 py-16">
      <Link to="/" className="text-lg font-semibold tracking-tight text-ink-900 dark:text-ink-50">
        {brand.name}
      </Link>

      <h1 className="mt-8 text-2xl font-semibold text-ink-900 dark:text-ink-100">
        Set your club up
      </h1>
      <p className="mt-2 text-pretty text-ink-600 dark:text-ink-400">
        About two minutes. You can import your roster straight afterwards, and
        nothing here is hard to change later.
      </p>

      <Form method="post" className="mt-8 space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First name" name="firstName">
            <Input id="firstName" name="firstName" required autoFocus autoComplete="given-name" />
          </Field>
          <Field label="Last name" name="lastName">
            <Input id="lastName" name="lastName" required autoComplete="family-name" />
          </Field>
        </div>

        <Field label="Your email" name="email" hint="This is how you'll sign in — no password needed.">
          <Input id="email" name="email" type="email" required autoComplete="email" />
        </Field>

        <Field label="Your role in the club" name="roleKey">
          <Select id="roleKey" name="roleKey" defaultValue="club_secretary">
            {SIGNUP_ROLES.map((key) => (
              <option key={key} value={key}>
                {ROLES[key]!.label}
              </option>
            ))}
          </Select>
        </Field>

        <hr className="border-ink-200 dark:border-ink-800" />

        <Field label="Club name" name="clubName" hint="However it appears on your banner.">
          <Input id="clubName" name="clubName" required placeholder="Rotary Club of …" />
        </Field>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <Field label="City" name="city">
              <Input id="city" name="city" autoComplete="address-level2" />
            </Field>
          </div>
          <Field label="State" name="stateCode">
            <Input id="stateCode" name="stateCode" maxLength={3} />
          </Field>
        </div>

        <Field
          label="Club number"
          name="riNumber"
          hint="Your Rotary International club ID, if you have it to hand. Skip it otherwise."
        >
          <Input id="riNumber" name="riNumber" inputMode="numeric" />
        </Field>

        <hr className="border-ink-200 dark:border-ink-800" />

        <p className="text-sm text-ink-600 dark:text-ink-400">
          When do you meet? We'll put the next few months on your calendar so
          there's something to take attendance against.
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Day" name="meetingWeekday">
            <Select id="meetingWeekday" name="meetingWeekday" defaultValue="4">
              {WEEKDAYS.map((d, i) => (
                <option key={d} value={i}>
                  {d}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Time" name="meetingTime">
            <Input id="meetingTime" name="meetingTime" type="time" defaultValue="12:00" />
          </Field>
        </div>

        <Field label="Where" name="meetingLocation">
          <Input id="meetingLocation" name="meetingLocation" placeholder="The venue, or a room" />
        </Field>

        {actionData?.error && (
          <p className="rounded-lg bg-risk-500/10 px-4 py-3 text-sm text-risk-500">
            {actionData.error}
          </p>
        )}

        <Button type="submit" disabled={busy} className="w-full">
          {busy ? "Setting things up…" : "Create the club"}
        </Button>

        <p className="text-center text-sm text-ink-500">
          Already have an account?{" "}
          <Link to="/login" className="text-brand-600 hover:underline">
            Sign in
          </Link>
        </p>
      </Form>
    </main>
  );
}
