"use client";
import { useState } from "react";
import { useApp, useAction } from "./context";
import { Modal, Field, ErrorNote } from "./ui";
const formatsByPlatform: Record<string, string[]> = {
  youtube: ["video", "short"],
  facebook: ["video", "image", "text"],
  instagram: ["reel", "image", "carousel"],
  tiktok: ["video", "image", "carousel"],
  linkedin: ["video", "image", "text"],
  x: ["video", "image", "text"],
};
const typesByPlatform: Record<string, [string, string][]> = {
  youtube: [["youtube_channel", "YouTube channel"]],
  facebook: [["facebook_page", "Facebook Page"]],
  instagram: [["instagram_professional", "Instagram professional account"]],
  tiktok: [["tiktok_creator", "TikTok account"]],
  linkedin: [
    ["linkedin_person", "LinkedIn profile"],
    ["linkedin_organization", "LinkedIn organization"],
  ],
  x: [["x_account", "X account"]],
};
export function AccountPermissionReview({
  account,
  onClose,
}: {
  account: any;
  onClose: () => void;
}) {
  const { request } = useApp(),
    action = useAction();
  const [type, setType] = useState(
      typesByPlatform[account.platform]?.[0]?.[0] || "",
    ),
    [formats, setFormats] = useState<string[]>([]),
    [publishing, setPublishing] = useState(false),
    [feeds, setFeeds] = useState<boolean | null>(null),
    [evidence, setEvidence] = useState("");
  return (
    <Modal
      title="Review account permissions"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Close
          </button>
          <button
            className="btn primary"
            disabled={
              action.busy ||
              !publishing ||
              !formats.length ||
              evidence.trim().length < 20
            }
            onClick={() =>
              void action
                .run(
                  () =>
                    request("accounts/" + account.id + "/permissions", "POST", {
                      connectionGeneration: account.connection_generation,
                      capabilityGeneration: account.capability_generation,
                      accountType: type,
                      formats,
                      publishingGranted: true,
                      feedsGranted: feeds,
                      evidence,
                    }),
                  "Permission review saved.",
                )
                .then(onClose)
                .catch(() => {})
            }
          >
            Save review
          </button>
        </>
      }
    >
      <div className="stack">
        {action.error && <ErrorNote message={action.error} />}
        <strong>{account.handle}</strong>
        <p className="small muted">
          Check permissions in Post for Me or your social account, then record
          them here. A connection does not confirm publishing access.
        </p>
        <Field label="Account type">
          <select
            aria-label="Account type"
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            {typesByPlatform[account.platform]?.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <fieldset className="stack">
          <legend>Allowed formats</legend>
          {formatsByPlatform[account.platform]?.map((format) => (
            <label className="check-row" key={format}>
              <input
                type="checkbox"
                checked={formats.includes(format)}
                onChange={(e) =>
                  setFormats(
                    e.target.checked
                      ? [...formats, format]
                      : formats.filter((x) => x !== format),
                  )
                }
              />
              {format === "short"
                ? "YouTube Shorts"
                : format[0].toUpperCase() + format.slice(1)}
            </label>
          ))}
        </fieldset>
        <label className="check-row">
          <input
            type="checkbox"
            checked={publishing}
            onChange={(e) => setPublishing(e.target.checked)}
          />
          I checked that publishing is allowed
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={feeds === true}
            onChange={(e) => setFeeds(e.target.checked)}
          />
          I checked that feed access is allowed
        </label>
        <Field label="Where did you check these permissions?">
          <textarea
            aria-label="Permission review notes"
            value={evidence}
            onChange={(e) => setEvidence(e.target.value)}
            placeholder="Describe the permission screen or confirmation you checked."
          />
        </Field>
      </div>
    </Modal>
  );
}
