import { Form, useNavigation } from "react-router";
import type { Route } from "./+types/contact";
import { envContext } from "@worker/loadContext";
import { brand } from "@content/brand";
import { Icon, Reveal, Eyebrow } from "~/brand";
import { Media, hasMedia } from "~/media";
import { marketingMeta } from "~/seo";
import { sendTransactional } from "@emails/send";
import { scoreSubmission } from "@domain/spam";
import { hashIp, looksLikeEmail } from "@worker/auth/crypto";
import { checkRateLimit, recordFailure } from "@worker/auth/ratelimit";
import { clientIp } from "@worker/context";
import { Field, Input, Textarea, Button } from "~/ui";

export function meta(_: Route.MetaArgs) {
  return marketingMeta({
    title: "Ask a question",
    description:
      "Questions about moving a club across, what Sodalitas does and doesn't do, or whether it's the right fit at all. A person reads these.",
    path: "/contact",
  });
}

const THANKS =
  "Thanks — that's arrived. Someone will read it and reply, usually within a day or two.";

/**
 * The contact form.
 *
 * Mails the reply-to address rather than storing anything. A contact message
 * isn't club data, it doesn't belong to a tenant, and giving it a table would
 * mean building a screen to read it — this way it lands in the same inbox as
 * every reply, which is where it would have ended up anyway.
 */
export async function action({ request, context }: Route.ActionArgs) {
  const env = context.get(envContext);
  const ipKey = await hashIp(clientIp(request), env.IP_HASH_SECRET ?? "dev");

  const limit = await checkRateLimit(env.KV, "contactForm", ipKey);
  // Same friendly answer as success. A throttled bot learns nothing about which
  // rule caught it.
  if (!limit.allowed) return { ok: true as const, message: THANKS };

  const form = await request.formData();
  const name = String(form.get("name") ?? "").trim();
  const email = String(form.get("email") ?? "").trim();
  const message = String(form.get("message") ?? "").trim();

  const verdict = scoreSubmission({
    name,
    email,
    message,
    honeypot: String(form.get("website") ?? ""),
    elapsedMs: Number(form.get("elapsed") ?? 0),
  });

  // Only a genuine human reaches an error — spam is never reported as invalid.
  if (!verdict.valid) return { ok: false as const, message: verdict.message! };
  if (!looksLikeEmail(email)) {
    return { ok: false as const, message: "We'll need an email address to reply to." };
  }

  await recordFailure(env.KV, "contactForm", ipKey);

  // Spam is accepted with the same answer and simply not forwarded.
  if (!verdict.isSpam) {
    await sendTransactional(env, {
      to: env.MAIL_REPLY_TO,
      subject: `Question from ${name || email}`,
      text:
        `${message}\n\n` +
        `———\n` +
        `From: ${name || "(no name)"} <${email}>\n` +
        `Club: ${String(form.get("club") ?? "") || "(not given)"}\n` +
        `Role: ${String(form.get("role") ?? "") || "(not given)"}`,
      templateKey: "contactForm",
    });
  }

  return { ok: true as const, message: THANKS };
}

export default function Contact({ actionData }: Route.ComponentProps) {
  const nav = useNavigation();
  const busy = nav.state === "submitting";

  return (
    <div className="mx-auto max-w-5xl px-6 py-16 sm:py-24">
      <div className="grid gap-16 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="max-w-xl">
          <Eyebrow>Contact</Eyebrow>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight text-balance text-ink-900 sm:text-5xl dark:text-ink-50">
            Ask us something
          </h1>
          <p className="mt-5 text-lg text-pretty text-ink-600 dark:text-ink-400">
            Especially the awkward questions — whether your club's export will come across
            cleanly, what happens to the data if you leave, or whether this is the wrong fit.
            We'd rather tell you now.
          </p>

          {actionData?.ok ? (
            <Reveal>
              <p className="mt-10 rounded-2xl border border-steady-500/30 bg-steady-500/[0.08] px-5 py-4 text-steady-500">
                {actionData.message}
              </p>
            </Reveal>
          ) : (
            <Form method="post" className="mt-10 space-y-5">
              {/* Honeypot. Hidden from people, irresistible to naive bots. */}
              <div aria-hidden className="absolute h-0 w-0 overflow-hidden">
                <label htmlFor="website">Website</label>
                <input id="website" name="website" tabIndex={-1} autoComplete="off" />
              </div>
              <input type="hidden" name="elapsed" defaultValue="0" ref={stampElapsed} />

              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="Your name" name="name">
                  <Input id="name" name="name" required autoComplete="name" />
                </Field>
                <Field label="Email" name="email">
                  <Input id="email" name="email" type="email" required autoComplete="email" />
                </Field>
              </div>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="Your club" name="club" hint="Optional.">
                  <Input id="club" name="club" placeholder="Rotary Club of …" />
                </Field>
                <Field label="Your role" name="role" hint="Optional.">
                  <Input id="role" name="role" placeholder="Secretary, president, member…" />
                </Field>
              </div>
              <Field label="What would you like to know?" name="message">
                <Textarea id="message" name="message" rows={6} required />
              </Field>

              {actionData && actionData.ok === false && (
                <p className="text-sm text-risk-500">{actionData.message}</p>
              )}

              <Button type="submit" disabled={busy}>
                {busy ? "Sending…" : "Send"}
              </Button>
            </Form>
          )}
        </div>

        <aside className="space-y-6">
          {hasMedia("contact-spot") && <Media slot="contact-spot" className="hidden lg:block" />}
          <div className="rounded-2xl border border-ink-200 p-6 dark:border-ink-800">
            <h2 className="flex items-center gap-2.5 font-medium text-ink-900 dark:text-ink-100">
              <Icon.Clock className="text-ink-400" />
              A person reads these
            </h2>
            <p className="mt-2 text-sm text-pretty text-ink-600 dark:text-ink-400">
              There's no ticketing system and no chatbot. Replies usually take a day or two,
              longer at weekends.
            </p>
          </div>
          <div className="rounded-2xl border border-ink-200 p-6 dark:border-ink-800">
            <h2 className="flex items-center gap-2.5 font-medium text-ink-900 dark:text-ink-100">
              <Icon.Book className="text-ink-400" />
              Possibly already answered
            </h2>
            <p className="mt-2 text-sm text-pretty text-ink-600 dark:text-ink-400">
              The guide on moving between systems covers what does and doesn't survive an
              export, and the comparison page names where the alternatives do more than we do.
            </p>
          </div>
          <p className="text-sm text-ink-500">
            {brand.name} is not affiliated with or endorsed by Rotary International.
          </p>
        </aside>
      </div>
    </div>
  );
}

/**
 * Stamp the render time on the client.
 *
 * Server-rendered and edge-cacheable, so a server timestamp would measure the
 * cache's age rather than this visitor's reading time.
 */
function stampElapsed(el: HTMLInputElement | null) {
  if (!el) return;
  const start = Date.now();
  const form = el.form;
  if (!form) return;
  form.addEventListener(
    "submit",
    () => {
      el.value = String(Date.now() - start);
    },
    { once: true },
  );
}
