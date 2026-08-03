import { redirect } from "react-router";
import type { Route } from "./+types/logout";
import { envContext } from "@worker/loadContext";
import { destroySession, sessionTokenFrom, clearCookie, shouldUseSecureCookie } from "@worker/auth/session";

/** Sign out. POST only — a GET would let any image tag sign a member out. */
export async function action({ request, context }: Route.ActionArgs) {
  const env = context.get(envContext);
  const token = sessionTokenFrom(request);
  if (token) await destroySession(env, token);
  return redirect("/", {
    headers: { "Set-Cookie": clearCookie({ secure: shouldUseSecureCookie(request) }) },
  });
}

export async function loader() {
  return redirect("/");
}
