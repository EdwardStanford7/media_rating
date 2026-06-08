import { createMiddleware } from "@tanstack/react-start";
import { getRequestHeaders, setResponseStatus } from "@tanstack/react-start/server";
import { auth } from "@/server/lib/auth";
import { UnauthorizedError } from "@/lib/errors";

export type AuthSession = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>;
export type AuthUser = AuthSession["user"];

/**
 * Requires a signed-in user. Injects `user` (and the full `session`) into
 * the server-function context. Without a valid session the function fails
 * with a 401 and an UnauthorizedError that the client can detect via
 * `isUnauthorizedError` (see src/lib/errors.ts).
 */
export const authMiddleware = createMiddleware().server(async ({ next }) => {
    const session = await auth.api.getSession({ headers: getRequestHeaders() });

    if (!session?.user) {
        setResponseStatus(401);
        throw new UnauthorizedError();
    }

    return next({ context: { user: session.user, session } });
});

/**
 * Resolves the session when present but allows anonymous callers.
 * Injects `user: AuthUser | null` into the server-function context.
 */
export const optionalAuthMiddleware = createMiddleware().server(async ({ next }) => {
    const session = await auth.api.getSession({ headers: getRequestHeaders() });

    return next({
        context: {
            user: session?.user ?? null,
            session: session ?? null
        }
    });
});
