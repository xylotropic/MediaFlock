"use client";
import { Button, ButtonLink } from "./base/buttons/button";
import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { useApp, useLoad, useAction } from "./context";
import { ErrorNote, LocalTime } from "./ui";
import { ServiceMark } from "./service-mark";

export function SubscriptionConnections() {
  const { request, notify } = useApp();
  const { data, error, reload } = useLoad("subscriptions/chatgpt");
  const action = useAction();
  const [attempt, setAttempt] = useState<{
    attemptId: string;
    url: string;
  } | null>(null);
  const [progress, setProgress] = useState("");
  useEffect(() => {
    if (!attempt) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await request(
          "subscriptions/chatgpt/attempt?attemptId=" + attempt.attemptId,
        );
        if (cancelled) return;
        setProgress(result.message);
        if (result.status === "verified") {
          await request("subscriptions/chatgpt/finalize", "POST", {
            attemptId: attempt.attemptId,
          });
          if (!cancelled) {
            setAttempt(null);
            setProgress("");
            await reload();
            notify("ChatGPT signed in. Choose a model before drafting.");
          }
          return;
        }
        if (
          ["denied", "error", "cancelled", "complete"].includes(result.status)
        ) {
          setAttempt(null);
          await reload();
          return;
        }
        timer = setTimeout(() => void poll(), 2000);
      } catch (e) {
        if (!cancelled) {
          setProgress(
            e instanceof Error ? e.message : "Sign-in could not be checked.",
          );
          setAttempt(null);
        }
      }
    };
    timer = setTimeout(() => void poll(), 1000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [attempt, notify, reload, request]);
  const begin = (profileId?: string, enablePlanUsage = false) =>
    void action
      .run(async () => {
        const next = await request("subscriptions/chatgpt/begin", "POST", {
          profileId,
          enablePlanUsage,
        });
        setAttempt(next);
        setProgress("Open ChatGPT sign-in in Chrome, then return here.");
      })
      .catch(() => {});
  return (
    <>
      <article className="connection-row">
        <ServiceMark service="chatgpt" />
        <div className="grow">
          <h3>ChatGPT</h3>
          <p className="small muted">
            AI drafting with your ChatGPT subscription
          </p>
        </div>
        <span className="tiny muted">
          {error
            ? "Unavailable"
            : data === null
              ? "Checking…"
              : !data.available
                ? "On this Mac"
                : data.profiles.some(
                      (p: any) =>
                        p.id === data.selectedId &&
                        p.signedIn &&
                        p.planPermission &&
                        !p.reconnectRequired,
                    )
                  ? "Signed in"
                  : "Not connected"}
        </span>
        {data?.available ? (
          <Button
            variant="secondary"
            size="small"
            type="button"
            className=""
            disabled={action.busy || !!attempt}
            onClick={() => begin()}
          >
            Continue with ChatGPT
          </Button>
        ) : (
          data && (
            <ButtonLink
              trailingIcon={ExternalLink}
              variant="secondary"
              size="small"
              className=""
              href={data.localUrl}
              target="_blank"
              rel="noreferrer"
            >
              Open on this Mac
            </ButtonLink>
          )
        )}
      </article>
      {(error || action.error) && <ErrorNote message={error || action.error} />}
      {attempt && (
        <div className="stack section-space">
          <p className="small muted">{progress}</p>
          <div className="row wrap">
            <ButtonLink
              trailingIcon={ExternalLink}
              variant="secondary"
              size="small"
              className=""
              href={attempt.url}
              target="_blank"
              rel="noreferrer"
            >
              Open ChatGPT sign-in
            </ButtonLink>
            <Button
              variant="ghost"
              size="small"
              type="button"
              className=""
              disabled={action.busy}
              onClick={() =>
                void action
                  .run(async () => {
                    await request("subscriptions/chatgpt/cancel", "POST", {
                      attemptId: attempt.attemptId,
                    });
                    setAttempt(null);
                    setProgress("Sign-in cancelled.");
                  })
                  .catch(() => {})
              }
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
      {!attempt && progress && <p className="small muted">{progress}</p>}
      {data?.available && data.profiles.length > 0 && (
        <div className="stack section-space">
          <label className="small">
            ChatGPT account
            <select
              value={data.selectedId || ""}
              disabled={action.busy || !!attempt}
              onChange={(event) =>
                void action
                  .run(async () => {
                    await request("subscriptions/chatgpt/select", "POST", {
                      profileId: event.target.value,
                    });
                    await reload();
                  })
                  .catch(() => {})
              }
            >
              <option value="" disabled>
                Choose an account
              </option>
              {data.profiles
                .filter((p: any) => p.identityVerified)
                .map((p: any) => (
                  <option value={p.id} key={p.id}>
                    {p.label}
                  </option>
                ))}
            </select>
          </label>
          {data.profiles
            .filter((p: any) => p.id === data.selectedId)
            .map((profile: any) => (
              <SubscriptionSettings
                key={
                  profile.id +
                  ":" +
                  profile.model +
                  ":" +
                  profile.reconnectRequired +
                  ":" +
                  profile.signedIn
                }
                profile={profile}
                onReconnect={() =>
                  begin(profile.id, profile.signedIn && !profile.planPermission)
                }
                onSaved={reload}
              />
            ))}
          {data.profiles
            .filter((p: any) => !p.identityVerified)
            .map((p: any) => (
              <div className="row spread" key={p.id}>
                <span className="small muted">
                  Unfinished sign-in · {p.id.slice(0, 8)}
                </span>
                <Button
                  variant="secondary"
                  size="small"
                  type="button"
                  className=""
                  disabled={action.busy || !!attempt}
                  onClick={() => begin(p.id)}
                >
                  Resume sign-in
                </Button>
              </div>
            ))}
        </div>
      )}
      {data?.available && (
        <p className="tiny muted section-space">
          Connections stay encrypted on this Mac. Drafting uses your ChatGPT
          allowance; automatic retries and API key fallback are disabled.{" "}
          <a
            href="https://chatgpt.com/settings/usage"
            target="_blank"
            rel="noreferrer"
          >
            Manage plan usage and disable extra credits in ChatGPT.
          </a>
        </p>
      )}
      <article className="connection-row">
        <ServiceMark service="elevenlabs" />
        <div className="grow">
          <h3>ElevenLabs</h3>
          <p className="small muted">
            Voice creation with your existing subscription
          </p>
          <p className="tiny muted">
            Create and download voices in ElevenLabs. MediaFlock is not
            connected to your ElevenLabs account.
          </p>
        </div>
        <ButtonLink
          trailingIcon={ExternalLink}
          variant="secondary"
          size="small"
          className=""
          href="https://elevenlabs.io/app"
          target="_blank"
          rel="noreferrer"
        >
          Open ElevenLabs
        </ButtonLink>
      </article>
    </>
  );
}
function SubscriptionSettings({
  profile,
  onReconnect,
  onSaved,
}: {
  profile: any;
  onReconnect: () => void;
  onSaved: () => Promise<void>;
}) {
  const { request, notify } = useApp(),
    action = useAction();
  const [models, setModels] = useState<any[]>([]),
    [error, setError] = useState("");
  const [model, setModel] = useState(profile.model),
    [budget, setBudget] = useState(profile.dailyTokenEstimate);
  useEffect(() => {
    if (
      !profile.signedIn ||
      profile.reconnectRequired ||
      !profile.planPermission
    )
      return;
    let cancelled = false;
    request("subscriptions/chatgpt/models?profileId=" + profile.id)
      .then((value) => {
        if (!cancelled) setModels(value);
      })
      .catch((e) => {
        if (!cancelled)
          setError(
            e instanceof Error ? e.message : "Models could not be checked.",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [
    profile.id,
    profile.planPermission,
    profile.reconnectRequired,
    profile.signedIn,
    request,
  ]);
  return (
    <div className="stack">
      {profile.signedIn && !profile.renewable && (
        <p className="small muted">
          This sign-in cannot renew automatically. Reconnect when it expires.
        </p>
      )}
      {profile.revocationUnconfirmed && !profile.signedIn && (
        <p className="small muted">
          Remote revocation was not confirmed. Remove MediaFlock in ChatGPT
          settings if you want to revoke its access.
        </p>
      )}
      {!profile.signedIn ||
      profile.reconnectRequired ||
      !profile.planPermission ? (
        <div className="row spread">
          <p className="small muted">
            {!profile.planPermission && profile.signedIn
              ? "ChatGPT plan usage was not granted."
              : "Reconnect this saved account before drafting."}
          </p>
          <Button
            variant="secondary"
            size="small"
            type="button"
            className=""
            onClick={onReconnect}
          >
            {profile.signedIn && !profile.planPermission
              ? "Enable plan usage"
              : "Reconnect ChatGPT"}
          </Button>
        </div>
      ) : (
        <>
          <label className="small">
            Model
            <select
              value={model}
              onChange={(event) => setModel(event.target.value)}
            >
              <option value="" disabled>
                {models.length ? "Choose a model" : "Loading available models…"}
              </option>
              {models.map((item) => (
                <option value={item.slug} key={item.slug}>
                  {item.displayName}
                </option>
              ))}
            </select>
          </label>
          <label className="small">
            Daily token estimate
            <input
              type="number"
              min={1000}
              max={1000000}
              step={1000}
              value={budget}
              onChange={(event) => setBudget(Number(event.target.value))}
            />
          </label>
          <p className="tiny muted">
            This estimate controls local request admission. It is not a
            guaranteed limit on ChatGPT usage. Unreported usage keeps the full
            estimate reserved.
          </p>
          <Button
            variant="secondary"
            size="small"
            type="button"
            className=""
            disabled={action.busy || !model}
            onClick={() =>
              void action
                .run(async () => {
                  await request("subscriptions/chatgpt/settings", "PUT", {
                    profileId: profile.id,
                    model,
                    dailyTokenEstimate: budget,
                  });
                  await onSaved();
                  notify("ChatGPT settings saved.");
                })
                .catch(() => {})
            }
          >
            Save ChatGPT settings
          </Button>
        </>
      )}
      {profile.lastVerifiedInference && (
        <p className="tiny muted">
          Drafting verified <LocalTime value={profile.lastVerifiedInference} />
        </p>
      )}
      {(error || action.error) && <ErrorNote message={error || action.error} />}
      {profile.signedIn && (
        <Button
          variant="ghost"
          size="small"
          type="button"
          className=""
          disabled={action.busy}
          onClick={() =>
            void action
              .run(async () => {
                const result = await request(
                  "subscriptions/chatgpt/disconnect",
                  "POST",
                  { profileId: profile.id },
                );
                await onSaved();
                notify(result.message);
              })
              .catch(() => {})
          }
        >
          Disconnect ChatGPT
        </Button>
      )}
    </div>
  );
}
