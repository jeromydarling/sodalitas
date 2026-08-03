import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
} from "react-router";
import type { Route } from "./+types/root";
import { brand } from "@content/brand";
import "./app.css";

export const links: Route.LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

/**
 * Error copy is specific and kind. A club officer who hits an error is usually
 * mid-task with a meeting starting in ten minutes; "Something went wrong" tells
 * them nothing and blaming them tells them worse.
 */
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let heading = "Something broke on our end";
  let detail = "That's ours to fix, not yours. Try again in a moment.";

  if (isRouteErrorResponse(error)) {
    if (error.status === 404) {
      heading = "That page isn't here";
      detail = "The link may be old, or the club may have changed its address.";
    } else if (error.status === 401) {
      heading = "You'll need to sign in first";
      detail = "Your session may have expired. Signing in again takes a few seconds.";
    } else if (error.status === 403) {
      heading = "That's not yours to see";
      detail =
        "Your role in this club doesn't include this page. If you think it should, a club president or administrator can change that in Settings.";
    } else {
      heading = `${error.status} ${error.statusText}`;
      detail = error.data || detail;
    }
  }

  return (
    <main className="mx-auto flex min-h-svh max-w-xl flex-col justify-center px-6 py-16">
      <p className="text-sm font-medium text-brand-600">{brand.name}</p>
      <h1 className="mt-3 text-2xl font-semibold text-ink-900 dark:text-ink-100">{heading}</h1>
      <p className="mt-3 text-ink-600 dark:text-ink-300">{detail}</p>
      <div className="mt-8 flex gap-4 text-sm">
        <a className="font-medium text-brand-600 hover:underline" href="/">
          Back to the start
        </a>
        <a className="font-medium text-brand-600 hover:underline" href="/login">
          Sign in
        </a>
      </div>
      {import.meta.env.DEV && error instanceof Error && (
        <pre className="mt-8 overflow-x-auto rounded-lg bg-ink-900 p-4 text-xs text-ink-100">
          {error.stack}
        </pre>
      )}
    </main>
  );
}
