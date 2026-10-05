"use client";
import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { Button, ButtonLink } from "./base/buttons/button";
import { useApp, useLoad, useAction } from "./context";
import { ErrorNote, Field, Modal } from "./ui";
import { ServiceMark } from "./service-mark";
export function ElevenLabsConnection() {
  const { data } = useLoad("integrations"),
    { data: usage } = useLoad("voice/status"),
    { request, notify } = useApp(),
    action = useAction();
  const entry = data?.entries.find((e: any) => e.service === "elevenlabs");
  const [open, setOpen] = useState(false),
    [key, setKey] = useState(""),
    [label, setLabel] = useState("");
  return (
    <>
      <article className="connection-row">
        <ServiceMark service="elevenlabs" />
        <div className="grow">
          <h3>ElevenLabs</h3>
        </div>
        <span className="tiny muted">
          {!entry?.has_key
            ? "Not connected"
            : !entry.enabled
              ? "Disabled"
              : entry.status === "transcription_verified"
                ? "Transcription verified"
                : entry.status === "account_verified"
                  ? "Account verified"
                  : "Configured"}
        </span>
        <div className="row wrap">
          <Button
            variant="secondary"
            size="small"
            onClick={() => {
              setLabel(entry?.config?.accountLabel || "");
              setOpen(true);
            }}
          >
            {entry?.has_key ? "Manage" : "Connect"}
          </Button>
          {entry?.has_key && (
            <Button
              variant="secondary"
              size="small"
              disabled={action.busy}
              onClick={() =>
                void action
                  .run(() => request("voice/check", "POST", {}))
                  .then((result) =>
                    result.status === "account_verified" ||
                    result.status === "transcription_verified"
                      ? notify(result.message)
                      : action.setError(result.message),
                  )
                  .catch(() => {})
              }
            >
              Check account
            </Button>
          )}
          <ButtonLink
            variant="ghost"
            iconOnly
            leadingIcon={ExternalLink}
            aria-label="Open ElevenLabs"
            href="https://elevenlabs.io/app"
            target="_blank"
            rel="noreferrer"
          />
        </div>
      </article>
      {action.error && <ErrorNote message={action.error} />}
      {usage?.unresolved && (
        <div className="note stack">
          <span>
            A previous transcription result is unknown. Review ElevenLabs usage
            before starting another recording.
          </span>
          <Button
            variant="secondary"
            size="small"
            disabled={action.busy}
            onClick={() =>
              void action
                .run(
                  () =>
                    request("voice/acknowledge", "POST", {
                      requestId: usage.unresolved.id,
                    }),
                  "Unknown result acknowledged. The previous request still counts toward today’s allowance.",
                )
                .catch(() => {})
            }
          >
            I checked the previous request
          </Button>
        </div>
      )}
      {open && (
        <Modal
          title="Connect ElevenLabs"
          onClose={() => {
            setKey("");
            setOpen(false);
          }}
          footer={
            <>
              <Button
                variant="secondary"
                onClick={() => {
                  setKey("");
                  setOpen(false);
                }}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                disabled={
                  action.busy ||
                  (!key && !entry?.has_key) ||
                  data?.mode !== "live"
                }
                onClick={() =>
                  void action
                    .run(async () => {
                      await request("integrations/elevenlabs", "PUT", {
                        ...(key ? { apiKey: key } : {}),
                        enabled: true,
                        config: {
                          accountLabel: label,
                          includedCreditsOnly: true,
                        },
                      });
                      setKey("");
                      setOpen(false);
                    }, "ElevenLabs connection saved.")
                    .catch(() => {})
                }
              >
                Save connection
              </Button>
            </>
          }
        >
          <div className="stack">
            <Field label="API key">
              <input
                aria-label="ElevenLabs API key"
                type="password"
                autoComplete="off"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder={
                  entry?.has_key
                    ? "Leave blank to keep the saved key"
                    : "Enter your restricted transcription key"
                }
              />
            </Field>
            <Field label="Account label">
              <input
                aria-label="ElevenLabs account label"
                value={label}
                maxLength={200}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Your account or workspace name"
              />
            </Field>
            <p className="small muted">
              Use a key with Speech to Text and User read permissions. The key
              stays encrypted on the server. Transcription requires included
              credits and disabled credit extensions. Recording stops after 90
              seconds; MediaFlock allows 10 requests per day.
            </p>
            {data?.mode === "demo" && (
              <p className="small muted">
                Live credentials belong in your live workspace.
              </p>
            )}
            {entry?.has_key && (
              <Button
                variant="secondary"
                disabled={action.busy}
                onClick={() =>
                  void action
                    .run(
                      () => request("integrations/elevenlabs", "DELETE"),
                      "ElevenLabs disconnected.",
                    )
                    .then(() => {
                      setKey("");
                      setOpen(false);
                    })
                    .catch(() => {})
                }
              >
                Disconnect
              </Button>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
