import { unsubscribeByToken } from "@/lib/drip/engine";
import { parseEmailScopeParam, type EmailScope } from "@/lib/drip/emailScope";

/**
 * RFC 8058 one-click unsubscribe endpoint.
 *
 * Referenced by the `List-Unsubscribe` header on nurture mail (see
 * `unsubscribeHeaders` in src/lib/drip/engine.ts). Gmail/Yahoo POST here
 * directly from the mail client with no user session, so:
 *
 * - **No auth and no CSRF token.** The unguessable per-contact unsubscribe
 *   token *is* the credential, and the only thing this endpoint can do is
 *   unsubscribe the contact that token belongs to.
 * - **No caching** — a cached response would report someone else's outcome.
 *
 * `GET` is not the one-click path: some clients and link scanners follow the
 * https URL with a GET, and silently unsubscribing on a prefetch would be a
 * bug. GET therefore only redirects a human to the confirmation page.
 */
export const dynamic = "force-dynamic";

/** Pull the token and email scope from the query string, then form or JSON body. */
async function readUnsubscribeParams(
  request: Request
): Promise<{ token: string; scope: EmailScope }> {
  const query = new URL(request.url).searchParams;
  const queryToken = query.get("token");
  const queryScope = query.get("scope");

  const contentType = request.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("application/json")) {
      const body: unknown = await request.json();
      const record =
        typeof body === "object" && body !== null
          ? (body as Record<string, unknown>)
          : {};
      return {
        token: queryToken || (typeof record.token === "string" ? record.token : ""),
        scope: parseEmailScopeParam(queryScope ?? record.scope),
      };
    }
    // Mail clients send application/x-www-form-urlencoded per RFC 8058.
    const body = await request.text();
    const form = new URLSearchParams(body);
    return {
      token: queryToken || form.get("token") || "",
      scope: parseEmailScopeParam(queryScope ?? form.get("scope")),
    };
  } catch {
    // A malformed or absent body is just a missing token, not a 500.
    return {
      token: queryToken ?? "",
      scope: parseEmailScopeParam(queryScope),
    };
  }
}

export async function POST(request: Request): Promise<Response> {
  const { token, scope } = await readUnsubscribeParams(request);
  if (!token) {
    return Response.json({ ok: false }, { status: 404 });
  }

  const result = await unsubscribeByToken(token, scope);
  // `alreadyDone` is still success: a second POST (or a client retry) must not
  // report failure, or the sender sees a broken unsubscribe.
  return result.ok
    ? Response.json({ ok: true }, { status: 200 })
    : Response.json({ ok: false }, { status: 404 });
}

export async function GET(request: Request): Promise<Response> {
  const query = new URL(request.url).searchParams;
  const token = query.get("token") ?? "";
  const scope = parseEmailScopeParam(query.get("scope"));
  const scopeParam = scope === "course" ? "&scope=course" : "";
  // Built by hand rather than Response.redirect(): that helper demands an
  // absolute URL, and a same-origin relative Location is what we want here.
  return new Response(null, {
    status: 302,
    headers: {
      Location: `/unsubscribe?token=${encodeURIComponent(token)}${scopeParam}`,
    },
  });
}
