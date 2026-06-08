import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { auth, getEmailSignUpOptions } from "@/server/lib/auth";

export const getAuthOptions = createServerFn({ method: "GET" }).handler(getEmailSignUpOptions);

export const getSession = createServerFn({ method: "GET" }).handler(async () => {
    const headers = getRequestHeaders();
    return auth.api.getSession({ headers });
});
