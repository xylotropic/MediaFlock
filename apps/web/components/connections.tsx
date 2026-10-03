"use client";
import { useState } from "react";
import { ArrowRight, ExternalLink, Plus } from "lucide-react";
import { useApp, useLoad, useAction } from "./context";
import { Header, ErrorNote, LocalTime } from "./ui";
import { ConnectModal, IntegrationModal, ServiceModal } from "./screens";

export function ConnectionsPage() {
  const { data, error } = useLoad("integrations"),
    { data: health, error: healthError } = useLoad("connections/health"),
    { data: accounts } = useLoad("accounts");
  const { request, notify, navigate } = useApp(),
    action = useAction();
  const [service, setService] = useState<string | null>(null),
    [connect, setConnect] = useState(false),
    [reference, setReference] = useState(false);
  return (
    <>
      <Header
        title="Connections"
        description="Connect your services and social accounts."
      />
      {(error || action.error) && <ErrorNote message={error || action.error} />}
      <section className="connection-section">
        <h2>Services</h2>
        {[
          {
            id: "postforme",
            title: "Post for Me",
            description: "Publishing and social accounts",
            url: "https://www.postforme.dev",
          },
          {
            id: "openai",
            title: "OpenAI",
            description: "Optional AI drafting",
            url: "https://platform.openai.com/api-keys",
          },
        ].map((item) => {
          const entry = data?.entries.find((x: any) => x.service === item.id);
          return (
            <article className="connection-row" key={item.id}>
              <div className="grow">
                <h3>{item.title}</h3>
                <p className="small muted">{item.description}</p>
                {entry?.last_checked_at && (
                  <p className="tiny muted">
                    Checked <LocalTime value={entry.last_checked_at} />
                  </p>
                )}
              </div>
              <span className="tiny muted">
                {entry?.status === "connected"
                  ? "Connected"
                  : entry?.has_key
                    ? entry.enabled
                      ? "Ready to check"
                      : "Disabled"
                    : "Not connected"}
              </span>
              <div className="row wrap">
                <button
                  className="btn compact"
                  onClick={() => setService(item.id)}
                >
                  {entry?.has_key ? "Manage" : "Connect"}
                </button>
                {entry?.has_key && (
                  <button
                    className="btn compact"
                    disabled={action.busy}
                    onClick={() =>
                      void action
                        .run(() =>
                          request(
                            "integrations/" + item.id + "/check",
                            "POST",
                            {},
                          ),
                        )
                        .then((result) => notify(result.message))
                        .catch(() => {})
                    }
                  >
                    Check connection
                  </button>
                )}
                <a
                  className="btn icon ghost"
                  href={item.url}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={"Open " + item.title}
                >
                  <ExternalLink size={13} />
                </a>
              </div>
            </article>
          );
        })}
        <article className="connection-row">
          <div className="grow">
            <h3>Supabase</h3>
            <p className="small muted">Database, sign-in and private media</p>
          </div>
          <span className="tiny muted">
            {healthError || health?.backend === "unavailable"
              ? "Unavailable"
              : health?.backend === "connected"
                ? "Connected"
                : "Checking…"}
          </span>
        </article>
      </section>
      <section className="connection-section">
        <div className="row spread">
          <h2>Social accounts</h2>
          <button className="btn compact" onClick={() => setConnect(true)}>
            <Plus size={12} />
            Connect account
          </button>
        </div>
        {accounts?.length ? (
          <button className="work-row" onClick={() => navigate("accounts")}>
            <span className="grow">
              {accounts.filter((x: any) => x.status === "connected").length}{" "}
              connected accounts
            </span>
            <ArrowRight size={14} />
          </button>
        ) : (
          <p className="work-empty">
            Connect Post for Me above, then authorize the accounts you want to
            use.
          </p>
        )}
      </section>
      <details className="connection-section">
        <summary>Additional services</summary>
        <div className="stack section-space">
          {data?.services.map((item: any) => (
            <div className="row spread" key={item.id}>
              <a
                className="action-link"
                href={item.url}
                target="_blank"
                rel="noreferrer"
              >
                {item.name}
                <ExternalLink size={12} />
              </a>
              <button
                className="btn compact"
                disabled={action.busy}
                onClick={() =>
                  void action
                    .run(
                      () => request("services/" + item.id, "DELETE"),
                      "Service removed.",
                    )
                    .catch(() => {})
                }
              >
                Remove
              </button>
            </div>
          ))}
          <button className="btn compact" onClick={() => setReference(true)}>
            Add service link
          </button>
        </div>
      </details>
      {service && (
        <IntegrationModal
          service={service}
          entry={data?.entries.find((x: any) => x.service === service)}
          onClose={() => setService(null)}
        />
      )}
      {connect && <ConnectModal onClose={() => setConnect(false)} />}
      {reference && <ServiceModal onClose={() => setReference(false)} />}
    </>
  );
}
