"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, ArrowLeft } from "lucide-react";
import { ThinkingOrb } from "thinking-orbs";
import { Brand, ErrorNote } from "./ui";
import { useReducedMotion } from "./effects";

function subscribeQuery(callback: () => void) {
  window.addEventListener("popstate", callback);
  return () => window.removeEventListener("popstate", callback);
}
function queryNotice() {
  return new URLSearchParams(window.location.search).get("auth");
}
export type AuthView = "signin" | "signup" | "recover" | "reset";

export function AuthPanel({
  view = "signin",
  ready = true,
  mode = "live",
  signupEnabled = true,
  emailEnabled = false,
  recoveryEnabled = false,
  onSuccess,
}: {
  view?: AuthView;
  ready?: boolean;
  mode?: string;
  signupEnabled?: boolean;
  emailEnabled?: boolean;
  recoveryEnabled?: boolean;
  onSuccess?: () => Promise<void>;
}) {
  const reduced = useReducedMotion();
  const router = useRouter();
  const [email, setEmail] = useState(
    mode === "demo" ? "floyd@mediaflock.local" : "",
  );
  const [password, setPassword] = useState(
    mode === "demo" ? "MediaFlock-demo-2026!" : "",
  );
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [issuedCode, setIssuedCode] = useState("");
  const [savedCode, setSavedCode] = useState(false);
  const [recoverByEmail, setRecoverByEmail] = useState(false);
  const codeRecovery = view === "recover" && recoveryEnabled && !recoverByEmail;
  const notice = useSyncExternalStore(subscribeQuery, queryNotice, () => null);
  const confirmationError =
    notice === "confirmation_failed" && !message
      ? "This link has expired or was already used. Request a new link below."
      : "";
  const title =
    view === "signup"
      ? "Create your account"
      : view === "recover"
        ? "Reset your password"
        : view === "reset"
          ? "Choose a new password"
          : "Welcome back";
  const description =
    view === "signup"
      ? "Your content starts here."
      : view === "recover"
        ? codeRecovery
          ? "Use the recovery code you saved when you created your account."
          : "Enter your email. We will send you a reset link."
        : view === "reset"
          ? "Use at least 12 characters."
          : "Sign in to MediaFlock.";
  const action =
    view === "signup"
      ? "Create account"
      : view === "recover"
        ? codeRecovery
          ? "Reset password"
          : "Send reset link"
        : view === "reset"
          ? "Save password"
          : "Sign in";
  async function submit() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const path =
        view === "signup"
          ? "/api/signup"
          : view === "recover"
            ? codeRecovery
              ? "/api/auth/recovery-code"
              : "/api/auth/recover"
            : view === "reset"
              ? "/api/auth/password"
              : "/api/login";
      const body =
        view === "signup"
          ? {
              email,
              password,
              name,
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            }
          : view === "recover"
            ? codeRecovery
              ? { email, recoveryCode, newPassword: password }
              : { email }
            : view === "reset"
              ? { password }
              : { email, password };
      const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error?.message || "Please try again.");
      if (data.status === "confirmation_required") {
        setMessage("Check your inbox to confirm your email, then sign in.");
        setPassword("");
      } else if (data.recoveryCode) {
        setIssuedCode(data.recoveryCode);
        setPassword("");
      } else if (codeRecovery) {
        setRecoveryCode("");
        setPassword("");
        router.push("/signin?auth=password_reset");
      } else if (view === "recover") {
        setMessage(
          "If this email has an account, a reset link will arrive in your inbox.",
        );
      } else if (onSuccess) await onSuccess();
      else
        router.push(view === "reset" ? "/signin?auth=password_reset" : "/app");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  async function resend() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/resend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error?.message || "Please try again.");
      setMessage(
        "If your account needs confirmation, a new link will arrive in your inbox.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-page">
      <section className="login-brand">
        <Link href="/" aria-label="MediaFlock home">
          <Brand />
        </Link>
        <div className="auth-brand-content">
          <h1>
            Make it.
            <br />
            Schedule it.
            <br />
            Go viral.
          </h1>
          <p>
            MediaFlock is a next generation Social Media Harness built for
            brands trying to scale.
          </p>
        </div>
        <Link href="/" className="auth-home">
          <ArrowLeft size={14} /> Back to MediaFlock
        </Link>
      </section>
      <section className="login-form-wrap" aria-labelledby="auth-title">
        <form
          className="login-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="auth-orb" aria-hidden="true">
            <ThinkingOrb
              state={busy ? "working" : "breathing"}
              size={64}
              theme="light"
              paused={reduced}
            />
          </div>
          <h2 id="auth-title">{title}</h2>
          <p>{description}</p>
          {view === "recover" && recoveryEnabled && emailEnabled && (
            <button
              className="auth-text-link"
              type="button"
              disabled={busy}
              onClick={() => {
                setRecoverByEmail(!recoverByEmail);
                setError("");
                setMessage("");
              }}
            >
              {recoverByEmail
                ? "Use a recovery code"
                : "Send me an email instead"}
            </button>
          )}
          {(error || confirmationError) && (
            <ErrorNote message={error || confirmationError} />
          )}
          {notice === "password_reset" && (
            <p className="auth-message" role="status">
              Password saved. Sign in with your new password.
            </p>
          )}
          {message && (
            <p className="auth-message" role="status">
              {message}
            </p>
          )}
          {issuedCode ? (
            <div className="stack">
              <p className="auth-message">
                Save this recovery code in a password manager. It appears only
                once and lets you reset your password. Each code can be used
                once.
              </p>
              <pre
                className="log auth-recovery-code"
                aria-label="Your recovery code"
              >
                {issuedCode}
              </pre>
              <button
                className="btn"
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(issuedCode);
                    setMessage("Recovery code copied.");
                  } catch {
                    setError("Select and copy the code above.");
                  }
                }}
              >
                Copy recovery code
              </button>
              <label className="row small">
                <input
                  type="checkbox"
                  checked={savedCode}
                  onChange={(e) => setSavedCode(e.target.checked)}
                />{" "}
                I saved my recovery code
              </label>
              <button
                className="btn primary"
                type="button"
                disabled={!savedCode}
                onClick={() => {
                  setIssuedCode("");
                  if (onSuccess) void onSuccess();
                  else router.push("/app");
                }}
              >
                Open MediaFlock <ArrowRight size={15} />
              </button>
            </div>
          ) : view === "signup" && !signupEnabled ? (
            <p className="auth-message">
              Account creation is currently closed. Sign in if you already have
              an account.
            </p>
          ) : view === "recover" && !emailEnabled && !recoveryEnabled ? (
            <p className="auth-message">
              Password recovery is being set up. Contact your workspace owner if
              you need help signing in.
            </p>
          ) : (
            <div className="stack">
              {view === "signup" && (
                <div className="field">
                  <label htmlFor="name">Name</label>
                  <input
                    id="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoComplete="name"
                    maxLength={80}
                    required
                  />
                </div>
              )}
              {view !== "reset" && (
                <div className="field">
                  <label htmlFor="email">Email</label>
                  <input
                    id="email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    maxLength={254}
                    required
                  />
                </div>
              )}
              {codeRecovery && (
                <div className="field">
                  <label htmlFor="recovery-code">Recovery code</label>
                  <input
                    id="recovery-code"
                    value={recoveryCode}
                    onChange={(e) => setRecoveryCode(e.target.value)}
                    autoComplete="off"
                    maxLength={200}
                    required
                  />
                </div>
              )}
              {(view !== "recover" || codeRecovery) && (
                <div className="field">
                  <div className="row spread">
                    <label htmlFor="password">
                      {view === "reset" || codeRecovery
                        ? "New password"
                        : "Password"}
                    </label>
                    {view === "signin" && (emailEnabled || recoveryEnabled) && (
                      <Link href="/forgot-password" className="auth-text-link">
                        Forgot password?
                      </Link>
                    )}
                  </div>
                  <input
                    id="password"
                    type="password"
                    autoComplete={
                      view === "signin" ? "current-password" : "new-password"
                    }
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    minLength={view === "signin" ? 1 : 12}
                    maxLength={200}
                    required
                  />
                  {view === "signup" && (
                    <span className="muted small">At least 12 characters.</span>
                  )}
                </div>
              )}
              <button
                className="btn primary"
                disabled={busy || !ready}
                type="submit"
              >
                {busy ? "Please wait…" : action}
                <ArrowRight size={15} />
              </button>
            </div>
          )}
          {!ready && (
            <p className="auth-message" role="alert">
              We could not connect. Refresh the page and try again.
            </p>
          )}
          <div className="auth-links">
            {view === "signin" ? (
              <p>
                New to MediaFlock? <Link href="/signup">Create an account</Link>
              </p>
            ) : (
              <p>
                Already have an account? <Link href="/signin">Sign in</Link>
              </p>
            )}
            {view === "signin" && emailEnabled && (
              <button
                className="auth-text-link"
                type="button"
                onClick={() => void resend()}
                disabled={busy || !email}
              >
                Resend confirmation email
              </button>
            )}
          </div>
        </form>
      </section>
    </main>
  );
}

export function AuthScreen({ view }: { view: AuthView }) {
  const [config, setConfig] = useState<{
    ready: boolean;
    mode?: string;
    selfSignupEnabled?: boolean;
    authEmailEnabled?: boolean;
    recoveryCodesEnabled?: boolean;
  } | null>(null);
  useEffect(() => {
    fetch("/api/config", { cache: "no-store" })
      .then((r) => r.json())
      .then((r) => setConfig(r.data))
      .catch(() => setConfig({ ready: false }));
  }, []);
  if (!config)
    return (
      <main className="auth-loading" role="status">
        Loading MediaFlock…
      </main>
    );
  return (
    <AuthPanel
      view={view}
      ready={config.ready}
      mode={config.mode}
      signupEnabled={config.selfSignupEnabled}
      emailEnabled={config.authEmailEnabled}
      recoveryEnabled={config.recoveryCodesEnabled}
    />
  );
}
