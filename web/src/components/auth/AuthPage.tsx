import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { signIn, signUp } from "@/lib/auth-client";

type AuthMode = "signin" | "signup" | "reset-request";

export function AuthPage({
    authOptions
}: {
    authOptions: {
        minPasswordLength: number;
    };
}) {
    const [authMode, setAuthMode] = useState<AuthMode>("signin");
    const [error, setError] = useState<string | null>(null);
    const [statusMessage, setStatusMessage] = useState<string | null>(null);
    const [resetToken, setResetToken] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        if (typeof window === "undefined") {
            return;
        }

        const searchParams = new URLSearchParams(window.location.search);
        const token = searchParams.get("token");
        const resetError = searchParams.get("error");
        if (token) {
            setResetToken(token);
        } else if (resetError) {
            setError("That password reset link is invalid or expired.");
        }
    }, []);

    async function handleEmailAuth(event: FormEvent<HTMLFormElement>, mode: "signin" | "signup") {
        event.preventDefault();
        setError(null);
        setStatusMessage(null);
        setSubmitting(true);
        const form = new FormData(event.currentTarget);
        const email = String(form.get("email") ?? "");
        const password = String(form.get("password") ?? "");
        const name = String(form.get("name") ?? email);

        try {
            if (mode === "signup") {
                if (password.length < authOptions.minPasswordLength) {
                    setError(passwordLengthMessage(authOptions.minPasswordLength));
                    return;
                }
                await signUpWithEmail({ email, password, name });
            } else {
                await signInWithEmail({ email, password });
            }
            window.location.assign("/");
        } catch (authError) {
            setError(formatAuthError(authError, mode, authOptions.minPasswordLength));
        } finally {
            setSubmitting(false);
        }
    }

    async function handleRequestPasswordReset(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setError(null);
        setStatusMessage(null);
        setSubmitting(true);
        const form = new FormData(event.currentTarget);
        const email = String(form.get("email") ?? "");

        try {
            await requestPasswordResetEmail({ email });
            setStatusMessage("If that email exists, check your inbox for a reset link.");
        } catch (authError) {
            const message = authError instanceof Error ? authError.message.toLowerCase() : "";
            if (message.includes("too many") || message.includes("rate")) {
                setError("Too many attempts. Try again later.");
            } else {
                setStatusMessage("If that email exists, check your inbox for a reset link.");
            }
        } finally {
            setSubmitting(false);
        }
    }

    async function handleResetPassword(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!resetToken) {
            setError("That password reset link is invalid or expired.");
            return;
        }

        setError(null);
        setStatusMessage(null);
        setSubmitting(true);
        const form = new FormData(event.currentTarget);
        const newPassword = String(form.get("newPassword") ?? "");
        const confirmPassword = String(form.get("confirmPassword") ?? "");
        if (newPassword.length < authOptions.minPasswordLength) {
            setError(passwordLengthMessage(authOptions.minPasswordLength));
            setSubmitting(false);
            return;
        }

        if (newPassword !== confirmPassword) {
            setError("Passwords do not match.");
            setSubmitting(false);
            return;
        }

        try {
            await resetPasswordWithToken({ token: resetToken, newPassword });
            setResetToken(null);
            setStatusMessage("Password updated. Sign in with your new password.");
            if (typeof window !== "undefined") {
                window.history.replaceState(null, "", "/");
            }
        } catch (authError) {
            setError(authError instanceof Error ? authError.message : "Password reset failed");
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <main className="auth-page">
            <div className="auth-shell">
                <section className="auth-hero" aria-label="Goldshelf">
                    <h1>Goldshelf</h1>
                    <p>Rank your taste, one choice at a time.</p>
                </section>

                <section className="auth-panel" aria-labelledby="auth-heading">
                    <div className="auth-copy">
                        <p className="auth-kicker">
                            {resetToken
                                ? "Account Recovery"
                                : authMode === "signin"
                                    ? "Welcome Back"
                                    : authMode === "reset-request"
                                        ? "Account Recovery"
                                        : "Welcome to Goldshelf"}
                        </p>
                        <h2 id="auth-heading">
                            {resetToken
                                ? "Reset password"
                                : authMode === "signin"
                                    ? "Sign in"
                                    : authMode === "reset-request"
                                        ? "Reset password"
                                        : "Create account"}
                        </h2>
                        <p className="muted">
                            {resetToken
                                ? "Choose a new password to get back to your lists."
                                : authMode === "signin"
                                    ? "Pick up where your rankings left off."
                                    : authMode === "reset-request"
                                        ? "Enter your email and we will send a reset link."
                                        : "Start building rankings that actually reflect your taste."}
                        </p>
                    </div>

                    {error ? <div className="status">{error}</div> : null}
                    {statusMessage ? <div className="status">{statusMessage}</div> : null}

                    {resetToken ? (
                        <form className="auth-form" onSubmit={handleResetPassword}>
                            <PasswordField
                                label="New password"
                                name="newPassword"
                                placeholder="New password"
                                autoComplete="new-password"
                            />
                            <PasswordField
                                label="Confirm password"
                                name="confirmPassword"
                                placeholder="Confirm new password"
                                autoComplete="new-password"
                            />
                            <button className="primary auth-submit" disabled={submitting} type="submit">
                                {submitting ? "Updating..." : "Update password"}
                            </button>
                        </form>
                    ) : authMode === "reset-request" ? (
                        <form className="auth-form" onSubmit={handleRequestPasswordReset}>
                            <label className="auth-field">
                                <span>Email</span>
                                <input name="email" type="email" placeholder="you@example.com" autoComplete="email" required />
                            </label>
                            <button className="primary auth-submit" disabled={submitting} type="submit">
                                {submitting ? "Sending..." : "Send reset link"}
                            </button>
                        </form>
                    ) : (
                        <form className="auth-form" onSubmit={(event) => handleEmailAuth(event, authMode)}>
                            {authMode === "signup" ? (
                                <label className="auth-field">
                                    <span>Name</span>
                                    <input name="name" placeholder="Jane Doe" autoComplete="name" required />
                                </label>
                            ) : null}
                            <label className="auth-field">
                                <span>Email</span>
                                <input name="email" type="email" placeholder="you@example.com" autoComplete="email" required />
                            </label>
                            <PasswordField
                                label="Password"
                                name="password"
                                placeholder={authMode === "signin" ? "Password" : "At least 12 characters"}
                                autoComplete={authMode === "signin" ? "current-password" : "new-password"}
                            />
                            <button className="primary auth-submit" disabled={submitting} type="submit">
                                {submitting
                                    ? authMode === "signin" ? "Signing in..." : "Creating account..."
                                    : authMode === "signin" ? "Sign in" : "Create account"}
                            </button>
                        </form>
                    )}

                    {!resetToken ? (
                        <p className="auth-switch muted">
                            {authMode === "signin" ? (
                                <>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setError(null);
                                            setStatusMessage(null);
                                            setAuthMode("reset-request");
                                        }}
                                    >
                                        Forgot password?
                                    </button>
                                    <span aria-hidden="true"> · </span>
                                </>
                            ) : authMode === "reset-request" ? "Remembered it?" : "Already have an account?"}{" "}
                            <button
                                type="button"
                                onClick={() => {
                                    setError(null);
                                    setStatusMessage(null);
                                    setAuthMode((currentMode) => currentMode === "signin" ? "signup" : "signin");
                                }}
                            >
                                {authMode === "signin" ? "Create an account" : "Sign in"}
                            </button>
                        </p>
                    ) : null}
                </section>
            </div>
        </main>
    );
}

function PasswordField({
    label,
    name,
    placeholder,
    autoComplete
}: {
    label: string;
    name: string;
    placeholder: string;
    autoComplete: string;
}) {
    const [visible, setVisible] = useState(false);

    return (
        <label className="auth-field">
            <span>{label}</span>
            <span className="password-field">
                <input
                    name={name}
                    type={visible ? "text" : "password"}
                    placeholder={placeholder}
                    autoComplete={autoComplete}
                    required
                />
                <button
                    aria-label={visible ? "Hide password" : "Show password"}
                    type="button"
                    onClick={() => setVisible((isVisible) => !isVisible)}
                >
                    <EyeIcon hidden={visible} />
                </button>
            </span>
        </label>
    );
}

function EyeIcon({ hidden }: { hidden: boolean }) {
    return (
        <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 24 24" width="18">
            <path
                d="M2.75 12s3.25-6 9.25-6 9.25 6 9.25 6-3.25 6-9.25 6-9.25-6-9.25-6Z"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.8"
            />
            <path
                d="M12 14.75a2.75 2.75 0 1 0 0-5.5 2.75 2.75 0 0 0 0 5.5Z"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.8"
            />
            {hidden ? (
                <path
                    d="M4 20 20 4"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeWidth="1.8"
                />
            ) : null}
        </svg>
    );
}

async function resetPasswordWithToken({
    token,
    newPassword
}: {
    token: string;
    newPassword: string;
}) {
    const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: {
            "content-type": "application/json"
        },
        body: JSON.stringify({
            token,
            newPassword
        })
    });

    if (!response.ok) {
        throw new Error(await readAuthError(response, "Password reset failed"));
    }
}

async function requestPasswordResetEmail({ email }: { email: string }) {
    const response = await fetch("/api/auth/request-password-reset", {
        method: "POST",
        headers: {
            "content-type": "application/json"
        },
        body: JSON.stringify({
            email: email.trim(),
            redirectTo: "https://goldshelf.net/"
        })
    });

    if (!response.ok) {
        throw new Error(await readAuthError(response, "Password reset request failed"));
    }
}

async function signInWithEmail({
    email,
    password
}: {
    email: string;
    password: string;
}) {
    const result = await signIn.email({
        email: email.trim(),
        password,
        callbackURL: "/"
    });

    if (result.error) {
        throw new Error(result.error.message || result.error.code || "Sign in failed");
    }
}

async function readAuthError(response: Response, fallback: string) {
    const text = await response.text().catch(() => "");
    const body = text ? safeJsonParse(text) : null;
    if (body && typeof body === "object") {
        if ("message" in body && typeof body.message === "string") {
            return body.message;
        }

        if ("code" in body && typeof body.code === "string") {
            return body.code.replaceAll("_", " ").toLowerCase();
        }
    }

    if (text.trim()) {
        return text.trim();
    }

    return `${fallback} (${response.status})`;
}

function formatAuthError(error: unknown, mode: AuthMode, minPasswordLength: number) {
    const message = error instanceof Error ? error.message : "Authentication failed";
    const normalizedMessage = message.toLowerCase();

    if (normalizedMessage.includes("too many") || normalizedMessage.includes("rate")) {
        return "Too many attempts. Try again later.";
    }

    if (mode === "signin") {
        return "Email or password is incorrect.";
    }

    if (
        normalizedMessage.includes("password") &&
        (
            normalizedMessage.includes("character") ||
            normalizedMessage.includes("length") ||
            normalizedMessage.includes("short")
        )
    ) {
        return passwordLengthMessage(minPasswordLength);
    }

    return message;
}

function passwordLengthMessage(minPasswordLength: number) {
    return `Use at least ${minPasswordLength} characters.\nLonger passphrases are more secure.`;
}

function safeJsonParse(text: string) {
    try {
        return JSON.parse(text) as unknown;
    } catch {
        return null;
    }
}

async function signUpWithEmail({
    email,
    password,
    name
}: {
    email: string;
    password: string;
    name: string;
}) {
    const result = await signUp.email({
        email: email.trim(),
        password,
        name: name.trim() || email.trim(),
        callbackURL: "/"
    });

    if (result.error) {
        throw new Error(result.error.message || result.error.code || "Account creation failed");
    }
}
