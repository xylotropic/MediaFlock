"use client";
import { uploadOriginal } from "./upload";
import { useState, useEffect } from "react";
import {
  Plus,
  ArrowRight,
  ArrowUpRight,
  Play,
  Search,
  Upload,
  FileText,
  Clock,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Download,
  Check,
  RefreshCw,
  SlidersHorizontal,
  Copy,
  ExternalLink,
  Layers,
  FlaskConical,
  SquarePen,
} from "lucide-react";
import { useApp, useLoad, useAction } from "./context";
import {
  OperationStatus,
  OperationOrb,
  SilverFrame,
  FocusBeam,
  LiquidTabs,
} from "./effects";
import { AccountPermissionReview } from "./account-permissions";
import { ObservationChart } from "./charts";
import {
  Header,
  Panel,
  Platform,
  Status,
  Empty,
  Modal,
  Field,
  ErrorNote,
  LocalTime,
  num,
  platformNames,
} from "./ui";
const blankPayload = {
  hook: "",
  caption: "",
  title: "",
  description: "",
  cta: "",
  visibility: "public",
  settings: {},
  media: [],
  utm: "",
};
const workspaceTimezones = Array.from(
  new Set(["UTC", ...Intl.supportedValuesOf("timeZone")]),
).sort();
function Loading({ error }: { error?: string }) {
  return error ? (
    <ErrorNote message={error} />
  ) : (
    <OperationStatus label="Loading your content…" state="connecting" />
  );
}
function useFormAction() {
  const action = useAction();
  return {
    ...action,
    submit: async (
      fn: () => Promise<any>,
      done: (result: any) => void,
      message?: string,
    ) => {
      try {
        const value = await action.run(fn, message);
        done(value);
      } catch {}
    },
  };
}
function WorkerButton({ compact = false }: { compact?: boolean }) {
  const { request } = useApp(),
    a = useAction();
  return (
    <button
      className={"btn " + (compact ? "compact" : "")}
      disabled={a.busy}
      onClick={() =>
        void a
          .run(
            () => request("worker", "POST", {}),
            "Demo processing started. Refresh in a few seconds.",
          )
          .catch(() => {})
      }
    >
      {a.busy ? <OperationOrb state="connecting" /> : <Play size={12} />}{" "}
      {a.busy ? "Starting…" : "Process queue"}
    </button>
  );
}
export function Overview() {
  const { data, error } = useLoad("overview"),
    { navigate, newContent, inspectJob, timezone, mode } = useApp();
  if (!data) return <Loading error={error} />;
  return (
    <>
      <Header
        title="Overview"
        description="Review drafts, upcoming posts and recent results."
        actions={
          <>
            <button className="btn primary" onClick={newContent}>
              <Plus size={13} />
              New content
            </button>
            {mode === "demo" && <WorkerButton />}
          </>
        }
      />
      <section className="work-section">
        <div className="work-heading">
          <h2>Ready for review</h2>
          <button className="action-link" onClick={() => navigate("approvals")}>
            View approvals <ArrowRight size={13} />
          </button>
        </div>
        {data.pending.length ? (
          data.pending.map((x: any) => (
            <button
              key={x.id}
              className="work-row"
              onClick={() => navigate("approvals")}
            >
              <div className="grow">
                <strong>{x.title}</strong>
                <div className="tiny muted">{x.handle}</div>
              </div>
              <span className="tiny muted">
                <LocalTime value={x.scheduled_at} timezone={timezone} />
              </span>
              <ArrowRight size={14} />
            </button>
          ))
        ) : (
          <p className="work-empty">No content waiting for approval.</p>
        )}
      </section>
      <section className="work-section">
        <div className="work-heading">
          <h2>Upcoming posts</h2>
          <button className="action-link" onClick={() => navigate("calendar")}>
            View calendar <ArrowRight size={13} />
          </button>
        </div>
        {data.upcoming.length ? (
          data.upcoming.map((x: any) => (
            <button
              key={x.id}
              className="work-row"
              onClick={() => inspectJob(x.id)}
            >
              <div className="grow">
                <strong>{x.title}</strong>
                <div className="tiny muted">{x.handle}</div>
              </div>
              <span className="tiny muted">
                <LocalTime value={x.scheduled_at} timezone={timezone} />
              </span>
              <Status value={x.state} />
            </button>
          ))
        ) : (
          <p className="work-empty">Nothing scheduled.</p>
        )}
      </section>
      <section className="work-section">
        <div className="work-heading">
          <h2>Recent results</h2>
          <button className="action-link" onClick={() => navigate("calendar")}>
            View posted content <ArrowRight size={13} />
          </button>
        </div>
        {data.recentResults.length ? (
          data.recentResults.map((x: any) => (
            <button
              key={x.id}
              className="work-row"
              onClick={() => inspectJob(x.id)}
            >
              <div className="grow">
                <strong>{x.handle}</strong>
                {x.error?.message && (
                  <div className="tiny muted">{x.error.message}</div>
                )}
              </div>
              <Status value={x.state} />
              <ArrowRight size={14} />
            </button>
          ))
        ) : (
          <p className="work-empty">Published content will appear here.</p>
        )}
      </section>
      <div className="quiet-links">
        {data.connectionProblems.length > 0 && (
          <button className="action-link" onClick={() => navigate("accounts")}>
            {data.connectionProblems.length} account
            {data.connectionProblems.length === 1 ? "" : "s"} need attention{" "}
            <ArrowRight size={13} />
          </button>
        )}
      </div>
    </>
  );
}
export function PackageEditor({
  id,
  onClose,
  onSaved,
}: {
  id?: string;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const { request } = useApp(),
    { data: assets } = useLoad("assets"),
    a = useFormAction();
  const [title, setTitle] = useState(""),
    [sourceNotes, setSourceNotes] = useState(""),
    [brief, setBrief] = useState(""),
    [tags, setTags] = useState(""),
    [selected, setSelected] = useState<string[]>([]);
  useEffect(() => {
    if (id)
      request("packages/" + id).then((p) => {
        setTitle(p.title);
        setSourceNotes(p.source_notes);
        setBrief(p.brief);
        setTags(p.tags.join(", "));
        setSelected(p.assets.map((x: any) => x.id));
      });
  }, [id, request]);
  return (
    <Modal
      title={id ? "Edit source and brief" : "Create content"}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={a.busy || !title.trim()}
            onClick={() =>
              a.submit(
                () =>
                  request(
                    id ? "packages/" + id : "packages",
                    id ? "PATCH" : "POST",
                    {
                      title,
                      sourceNotes,
                      brief,
                      tags: tags
                        .split(",")
                        .map((x) => x.trim())
                        .filter(Boolean),
                      assetIds: selected,
                    },
                  ),
                (p) => onSaved(p.id),
                "Content saved.",
              )
            }
          >
            {a.busy ? "Saving…" : "Save content"}
            <ArrowRight size={12} />
          </button>
        </>
      }
    >
      <div className="stack">
        {a.error && <ErrorNote message={a.error} />}
        <Field label="Title">
          <input
            aria-label="Content title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Give this content a name"
            maxLength={200}
          />
        </Field>
        <Field
          label="Source notes"
          help="Add the material and facts each version should use."
        >
          <textarea
            aria-label="Source notes"
            value={sourceNotes}
            onChange={(e) => setSourceNotes(e.target.value)}
            placeholder="Paste an idea, script, article excerpt or source notes…"
          />
        </Field>
        <Field label="Creative brief">
          <textarea
            aria-label="Creative brief"
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            placeholder="What should this content communicate? Who should it help?"
          />
        </Field>
        <details className="advanced">
          <summary>Tags</summary>{" "}
          <Field label="Tags">
            <input
              aria-label="Content tags"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="process, campaign, product"
            />
          </Field>
        </details>
        <Field label="Source media">
          <div className="choices">
            {assets?.map((asset: any) => (
              <label key={asset.id} className="check-row">
                <input
                  type="checkbox"
                  checked={selected.includes(asset.id)}
                  onChange={(e) =>
                    setSelected(
                      e.target.checked
                        ? [...selected, asset.id]
                        : selected.filter((x) => x !== asset.id),
                    )
                  }
                />
                <span>{asset.filename}</span>
                <span className="tiny muted">
                  {asset.width}×{asset.height}
                </span>
              </label>
            ))}
            {!assets?.length && (
              <div className="small muted" style={{ padding: 15 }}>
                Upload media in Library, or create content with text only.
              </div>
            )}
          </div>
        </Field>
        <div className="note">
          Your edits are saved. Each platform version has its own revision
          history.
        </div>
      </div>
    </Modal>
  );
}
export function Library() {
  const { newContent, selectPackage } = useApp(),
    [tab, setTab] = useState("content"),
    [search, setSearch] = useState(""),
    [upload, setUpload] = useState(false),
    [process, setProcess] = useState<any>(null),
    [editAsset, setEditAsset] = useState<any>(null);
  const { data: packages, error: packageError } = useLoad("packages"),
    { data: assets, error: assetError } = useLoad("assets");
  const filtered = (tab === "content" ? packages : assets)?.filter(
    (x: any) =>
      (x.title || x.filename).toLowerCase().includes(search.toLowerCase()) ||
      x.tags.some((tag: string) =>
        tag.toLowerCase().includes(search.toLowerCase()),
      ),
  );
  if ((tab === "content" ? packages : assets) === null)
    return <Loading error={tab === "content" ? packageError : assetError} />;
  return (
    <>
      <Header
        title="Library"
        description="Your original media, source notes and saved content."
        actions={
          <>
            <button className="btn" onClick={() => setUpload(true)}>
              <Upload size={13} />
              Upload media
            </button>
            <SilverFrame>
              <button className="btn primary" onClick={newContent}>
                <Plus size={13} />
                New content
              </button>
            </SilverFrame>
          </>
        }
      />
      <div style={{ marginBottom: 24 }}>
        <LiquidTabs
          label="Library view"
          options={[
            { value: "content", label: "Content" },
            { value: "assets", label: "Media" },
          ]}
          value={tab}
          onChange={setTab}
        />
      </div>
      <div className="toolbar">
        <div className="search-input">
          <Search size={13} />
          <input
            aria-label="Search library"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search names or tags…"
          />
        </div>
        <span className="tiny muted">
          {filtered?.length || 0}{" "}
          {tab === "content" ? "content items" : "media files"}
        </span>
      </div>
      {(packageError || assetError) && (
        <ErrorNote message={packageError || assetError} />
      )}
      <div className={tab === "content" ? "content-grid" : "asset-grid"}>
        {filtered?.map((item: any) =>
          tab === "content" ? (
            <article className="content-card" key={item.id}>
              <div className="row spread">
                <FileText size={17} />
                <span className="pill">{item.variant_count} versions</span>
              </div>
              <h2>{item.title}</h2>
              <p className="small muted">
                {item.brief ||
                  item.source_notes.slice(0, 130) ||
                  "No brief yet."}
              </p>
              <div className="tags">
                {item.tags.map((tag: string) => (
                  <span key={tag} className="tag">
                    {tag}
                  </span>
                ))}
              </div>
              <div className="row spread" style={{ marginTop: "auto" }}>
                <span className="tiny muted">
                  <LocalTime value={item.updated_at} dateOnly />
                </span>
                <button
                  className="btn compact"
                  onClick={() => selectPackage(item.id)}
                >
                  Open in Studio <ArrowUpRight size={12} />
                </button>
              </div>
            </article>
          ) : (
            <article className="asset-card" key={item.id}>
              <div className="asset-preview">
                {item.mime_type.startsWith("video") ? (
                  <video
                    src={"/api/v1/assets/" + item.id + "/file"}
                    controls
                    preload="metadata"
                    aria-label={item.filename}
                  />
                ) : (
                  <img
                    src={"/api/v1/assets/" + item.id + "/file"}
                    alt={item.filename}
                  />
                )}
              </div>
              <div className="asset-meta">
                <div className="row spread">
                  <h3 className="truncate">{item.filename}</h3>
                  <span className="pill">Original</span>
                </div>
                <div className="tiny muted" style={{ marginTop: 6 }}>
                  {item.width}×{item.height} ·{" "}
                  {(Number(item.bytes) / 1024 / 1024).toFixed(2)} MiB
                  {item.duration
                    ? ` · ${Number(item.duration).toFixed(1)}s`
                    : ""}
                </div>
                <div className="tags">
                  {item.tags.map((tag: string) => (
                    <span key={tag} className="tag">
                      {tag}
                    </span>
                  ))}
                </div>
                <div className="mono" title={item.checksum}>
                  SHA-256 {item.checksum.slice(0, 24)}…
                </div>
                <div className="row wrap section-space">
                  <button
                    className="btn compact"
                    onClick={() => setProcess(item)}
                  >
                    <SlidersHorizontal size={11} />
                    Process
                  </button>
                  <button
                    className="btn compact"
                    onClick={() => setEditAsset(item)}
                  >
                    Tags & notes
                  </button>
                  <a
                    className="btn icon compact"
                    aria-label={"Download original " + item.filename}
                    href={"/api/v1/assets/" + item.id + "/file"}
                    download={item.filename}
                  >
                    <Download size={12} />
                  </a>
                </div>
                {item.derivatives?.map((d: any) => (
                  <div
                    key={d.id}
                    className="row spread"
                    style={{ marginTop: 12 }}
                  >
                    <Status value={d.status} />
                    {d.status === "ready" ? (
                      <a
                        className="action-link"
                        href={
                          "/api/v1/assets/" + d.id + "/file?derivative=true"
                        }
                        download
                      >
                        Media version →
                      </a>
                    ) : (
                      <span className="tiny muted truncate" title={d.error}>
                        {d.error || "Waiting to process"}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </article>
          ),
        )}
      </div>
      {filtered?.length === 0 && (
        <Empty
          title="No matching content"
          description="Try another search, upload media, or create content."
        />
      )}
      {upload && <UploadModal onClose={() => setUpload(false)} />}{" "}
      {process && (
        <ProcessModal asset={process} onClose={() => setProcess(null)} />
      )}{" "}
      {editAsset && (
        <AssetMetadataModal
          asset={editAsset}
          onClose={() => setEditAsset(null)}
        />
      )}
    </>
  );
}
function UploadModal({ onClose }: { onClose: () => void }) {
  const { request } = useApp(),
    a = useFormAction(),
    [file, setFile] = useState<File | null>(null),
    [tags, setTags] = useState(""),
    [notes, setNotes] = useState("");
  return (
    <Modal
      title="Upload original media"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={a.busy || !file}
            onClick={() =>
              a.submit(
                () =>
                  uploadOriginal(request, file!, {
                    tags: tags
                      .split(",")
                      .map((x) => x.trim())
                      .filter(Boolean),
                    notes,
                  }),
                onClose,
                "Media uploaded.",
              )
            }
          >
            {a.busy && <OperationOrb state="working" dark />}
            {a.busy ? "Uploading and checking…" : "Upload media"}
          </button>
        </>
      }
    >
      <div className="stack">
        {a.error && <ErrorNote message={a.error} />}
        <div className="upload-zone">
          <Upload size={23} className="mx-auto" />
          <p>PNG, JPEG, WebP, MP4 or QuickTime · up to 50 MiB</p>
          <input
            aria-label="Select media file"
            type="file"
            accept="image/png,image/jpeg,image/webp,video/mp4,video/quicktime"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
        </div>
        <Field label="Tags">
          <input
            aria-label="Asset tags"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="source, campaign"
          />
        </Field>
        <Field label="Source notes">
          <textarea
            aria-label="Asset notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>
        <div className="note">
          We check each file before you can add it to a post. Originals stay
          unchanged in private storage.
        </div>
      </div>
    </Modal>
  );
}
function AssetMetadataModal({
  asset,
  onClose,
}: {
  asset: any;
  onClose: () => void;
}) {
  const { request } = useApp(),
    a = useFormAction(),
    [tags, setTags] = useState(asset.tags.join(", ")),
    [notes, setNotes] = useState(asset.notes);
  return (
    <Modal
      title="Media tags and notes"
      onClose={onClose}
      footer={
        <button
          className="btn primary"
          disabled={a.busy}
          onClick={() =>
            a.submit(
              () =>
                request("assets/" + asset.id, "PATCH", {
                  tags: tags
                    .split(",")
                    .map((x: string) => x.trim())
                    .filter(Boolean),
                  notes,
                }),
              onClose,
              "Tags and notes saved.",
            )
          }
        >
          Save tags and notes
        </button>
      }
    >
      <div className="stack">
        {a.error && <ErrorNote message={a.error} />}
        <Field label="Tags">
          <input
            aria-label="Edit asset tags"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
          />
        </Field>
        <Field label="Notes">
          <textarea
            aria-label="Edit asset notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>
      </div>
    </Modal>
  );
}
function ProcessModal({ asset, onClose }: { asset: any; onClose: () => void }) {
  const { request } = useApp(),
    a = useFormAction(),
    [width, setWidth] = useState(1080),
    [height, setHeight] = useState(1920),
    [fit, setFit] = useState("letterbox"),
    [start, setStart] = useState(0),
    [end, setEnd] = useState(asset.duration ? Number(asset.duration) : 0),
    [output, setOutput] = useState(
      asset.mime_type.startsWith("image") ? "png" : "mp4",
    ),
    [thumbnail, setThumbnail] = useState(""),
    [subtitles, setSubtitles] = useState(""),
    [cropX, setCropX] = useState(0.5),
    [cropY, setCropY] = useState(0.5);
  return (
    <Modal
      title="Create a media version"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={a.busy}
            onClick={() =>
              a.submit(
                () =>
                  request("assets/" + asset.id + "/process", "POST", {
                    width,
                    height,
                    fit,
                    output,
                    cropX,
                    cropY,
                    ...(asset.duration && output === "mp4"
                      ? { trimStart: start, trimEnd: end }
                      : {}),
                    ...(thumbnail ? { thumbnailAt: Number(thumbnail) } : {}),
                    ...(subtitles ? { subtitles } : {}),
                  }),
                onClose,
                "Media version queued. Check Library when it is ready.",
              )
            }
          >
            Create version
          </button>
        </>
      }
    >
      <div className="stack">
        {a.error && <ErrorNote message={a.error} />}
        <div className="note">
          Original: {asset.filename} · {asset.width}×{asset.height}. This
          operation creates a separate file.
        </div>
        <div className="fields-2">
          <Field label="Width">
            <input
              aria-label="Media version width"
              type="number"
              min={64}
              max={1920}
              step={2}
              value={width}
              onChange={(e) => setWidth(Number(e.target.value))}
            />
          </Field>
          <Field label="Height">
            <input
              aria-label="Media version height"
              type="number"
              min={64}
              max={1920}
              step={2}
              value={height}
              onChange={(e) => setHeight(Number(e.target.value))}
            />
          </Field>
          <Field label="Fit">
            <select
              aria-label="Media fit"
              value={fit}
              onChange={(e) => setFit(e.target.value)}
            >
              <option value="letterbox">Keep the full frame (letterbox)</option>
              <option value="crop">Crop to fit</option>
              <option value="stretch">Resize to exact dimensions</option>
            </select>
          </Field>
          <Field label="Output">
            <select
              aria-label="Output format"
              value={output}
              onChange={(e) => setOutput(e.target.value)}
            >
              {!asset.mime_type.startsWith("image") && (
                <option value="mp4">MP4 video</option>
              )}
              <option value="png">PNG thumbnail/image</option>
              <option value="jpeg">JPEG thumbnail/image</option>
            </select>
          </Field>
          {asset.duration && output === "mp4" ? (
            <>
              <Field label="Trim start (seconds)">
                <input
                  aria-label="Trim start"
                  type="number"
                  min={0}
                  max={end}
                  step="0.1"
                  value={start}
                  onChange={(e) => setStart(Number(e.target.value))}
                />
              </Field>
              <Field label="Trim end (seconds)">
                <input
                  aria-label="Trim end"
                  type="number"
                  min={start}
                  max={Number(asset.duration)}
                  step="0.1"
                  value={end}
                  onChange={(e) => setEnd(Number(e.target.value))}
                />
              </Field>
            </>
          ) : null}
          {asset.duration && output !== "mp4" && (
            <Field label="Thumbnail timestamp (seconds)">
              <input
                aria-label="Thumbnail timestamp"
                type="number"
                min={0}
                max={asset.duration}
                step="0.1"
                value={thumbnail}
                onChange={(e) => setThumbnail(e.target.value)}
              />
            </Field>
          )}
          {fit === "crop" && (
            <>
              <Field label="Horizontal crop position (0–1)">
                <input
                  aria-label="Crop horizontal position"
                  type="number"
                  min={0}
                  max={1}
                  step="0.1"
                  value={cropX}
                  onChange={(e) => setCropX(Number(e.target.value))}
                />
              </Field>
              <Field label="Vertical crop position (0–1)">
                <input
                  aria-label="Crop vertical position"
                  type="number"
                  min={0}
                  max={1}
                  step="0.1"
                  value={cropY}
                  onChange={(e) => setCropY(Number(e.target.value))}
                />
              </Field>
            </>
          )}
        </div>
        {output === "mp4" && (
          <Field label="Subtitles (SRT, optional)">
            <textarea
              aria-label="SRT subtitles"
              value={subtitles}
              onChange={(e) => setSubtitles(e.target.value)}
              placeholder={
                "1\n00:00:00,000 --> 00:00:02,000\nYour caption here"
              }
            />
          </Field>
        )}
        <div className="note">
          Processing creates a separate file. Your original stays unchanged.
        </div>
      </div>
    </Modal>
  );
}
export function Studio({
  packageId,
  onChoose,
}: {
  packageId: string | null;
  onChoose: (id: string) => void;
}) {
  const { data: packages, error } = useLoad("packages"),
    { newContent } = useApp();
  if (!packageId && packages === null) return <Loading error={error} />;
  return (
    <>
      {!packageId ? (
        <>
          <Header
            title="Content"
            description="Create a version of your content for each account."
            actions={
              <button className="btn primary" onClick={newContent}>
                <Plus size={13} />
                New content
              </button>
            }
          />
          {error && <ErrorNote message={error} />}
          <Panel title="Choose your content">
            {packages?.map((p: any) => (
              <button
                key={p.id}
                className="palette-option"
                style={{
                  padding: "18px 20px",
                  borderBottom: "1px solid #eee",
                  borderRadius: 0,
                }}
                onClick={() => onChoose(p.id)}
              >
                <FileText size={17} />
                <span className="grow">
                  {p.title}
                  <span
                    className="small muted"
                    style={{ display: "block", marginTop: 4 }}
                  >
                    {p.variant_count} versions · {p.tags.join(", ")}
                  </span>
                </span>
                <ArrowRight size={13} />
              </button>
            ))}
            {!packages?.length && (
              <Empty
                title="Start with source material"
                description="Start with an idea, text or media, then create versions for your accounts."
                action={
                  <button className="btn" onClick={newContent}>
                    Create content
                  </button>
                }
              />
            )}
          </Panel>
        </>
      ) : (
        <PackageDetail id={packageId} />
      )}
    </>
  );
}
function PackageDetail({ id }: { id: string }) {
  const { data: pkg, error } = useLoad("packages/" + id),
    { mode } = useApp(),
    [edit, setEdit] = useState(false),
    [generate, setGenerate] = useState(false),
    [manual, setManual] = useState(false),
    [variant, setVariant] = useState<any>(null),
    [approval, setApproval] = useState<any>(null),
    [history, setHistory] = useState<any>(null);
  if (!pkg) return <Loading error={error} />;
  return (
    <>
      <Header
        title={pkg.title}
        description="Each account has its own version and edit history."
        actions={
          <>
            <button className="btn" onClick={() => setEdit(true)}>
              Edit brief
            </button>
            <button className="btn" onClick={() => setManual(true)}>
              <SquarePen size={12} />
              Write a draft
            </button>
            <button className="btn primary" onClick={() => setGenerate(true)}>
              <Layers size={13} />
              {mode === "demo" ? "Generate versions" : "Generate versions"}
            </button>
          </>
        }
      />
      {error && <ErrorNote message={error} />}
      <div className="grid-2" style={{ marginBottom: 25 }}>
        <Panel title="Creative brief">
          <div className="panel-body">
            <p className="small" style={{ whiteSpace: "pre-wrap" }}>
              {pkg.brief || "Add a brief to guide your drafts."}
            </p>
            <div className="divider" />
            <div className="eyebrow" style={{ marginBottom: 9 }}>
              Source notes
            </div>
            <p className="small muted" style={{ whiteSpace: "pre-wrap" }}>
              {pkg.source_notes || "No source notes."}
            </p>
            <div className="tags">
              {pkg.tags.map((x: string) => (
                <span key={x} className="tag">
                  {x}
                </span>
              ))}
            </div>
          </div>
        </Panel>
        <Panel title="Original media">
          <div className="panel-body">
            {pkg.assets.length ? (
              <div className="approval-media">
                {pkg.assets.map((x: any) =>
                  x.mime_type.startsWith("video") ? (
                    <video
                      key={x.id}
                      src={"/api/v1/assets/" + x.id + "/file"}
                      controls
                      preload="metadata"
                      aria-label={x.filename}
                    />
                  ) : (
                    <img
                      key={x.id}
                      src={"/api/v1/assets/" + x.id + "/file"}
                      alt={x.filename}
                    />
                  ),
                )}
              </div>
            ) : (
              <p className="small muted">Text-only content.</p>
            )}
            <div className="tiny muted">Original files stay unchanged.</div>
          </div>
        </Panel>
      </div>
      <div className="row spread" style={{ marginBottom: 16 }}>
        <h2>Platform versions</h2>
        <span className="tiny muted">
          Posts may look different when they appear on each platform.
        </span>
      </div>
      <div className="content-grid">
        {pkg.variants.map((v: any) => (
          <article className="variant-card" key={v.id}>
            <div className="variant-header">
              <div className="account-mini">
                <Platform platform={v.platform} />
                <div>
                  <div className="small">{v.handle}</div>
                  <div className="tiny muted">
                    {platformNames[v.platform]} ·{" "}
                    {v.format === "short" ? "YouTube Shorts" : v.format}
                  </div>
                </div>
              </div>
              <span className="pill">Revision {v.revision}</span>
            </div>
            <div className="variant-preview">
              <div className="preview-label" style={{ marginBottom: 10 }}>
                Platform preview
              </div>
              <h3>{v.payload.hook || v.payload.title || "Add a hook"}</h3>
              <p>{v.payload.caption || "No caption yet."}</p>
              {v.payload.cta && (
                <p style={{ marginTop: 12, fontWeight: 550, color: "#333" }}>
                  {v.payload.cta}
                </p>
              )}
            </div>
            <div className="variant-footer">
              <div>
                <div className="tiny muted">
                  {v.provenance === "demo_ai"
                    ? "Demo AI example"
                    : v.provenance === "fixture"
                      ? "Demo example"
                      : v.provenance === "openai"
                        ? "AI draft"
                        : "Written manually"}
                </div>
                <button className="action-link" onClick={() => setHistory(v)}>
                  Revision history
                </button>
              </div>
              <div className="row">
                <button className="btn compact" onClick={() => setVariant(v)}>
                  Edit
                </button>
                <button
                  className="btn primary compact"
                  onClick={() => setApproval(v)}
                >
                  Request approval
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>
      {pkg.variants.length === 0 && (
        <Empty
          title="No versions yet"
          description="Choose accounts and formats, then generate versions or write a draft."
        />
      )}
      {edit && (
        <PackageEditor
          id={id}
          onClose={() => setEdit(false)}
          onSaved={() => setEdit(false)}
        />
      )}{" "}
      {generate && (
        <GenerateModal pkg={pkg} onClose={() => setGenerate(false)} />
      )}{" "}
      {(variant || manual) && (
        <VariantEditor
          variant={variant}
          pkg={pkg}
          onClose={() => {
            setVariant(null);
            setManual(false);
          }}
        />
      )}{" "}
      {approval && (
        <RequestApprovalModal
          variant={approval}
          onClose={() => setApproval(null)}
        />
      )}{" "}
      {history && (
        <HistoryModal variant={history} onClose={() => setHistory(null)} />
      )}
    </>
  );
}
function GenerateModal({ pkg, onClose }: { pkg: any; onClose: () => void }) {
  const { data: accounts } = useLoad("accounts"),
    { request, mode } = useApp(),
    a = useFormAction(),
    [selections, setSelections] = useState<
      { accountId: string; format: string }[]
    >([]);
  return (
    <Modal
      title={
        mode === "demo"
          ? "Generate versions"
          : "Generate versions for each account"
      }
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={a.busy || !selections.length}
            onClick={() =>
              a.submit(
                () =>
                  request("packages/" + pkg.id + "/generate", "POST", {
                    selections,
                  }),
                onClose,
                mode === "demo"
                  ? "Demo drafts created. Edit and review each version."
                  : "AI drafts ready. Review them before requesting approval.",
              )
            }
          >
            {a.busy && <OperationOrb state="composing" dark />}
            {a.busy
              ? "Preparing drafts…"
              : "Generate " + selections.length + " versions"}
          </button>
        </>
      }
    >
      <div className="stack">
        {a.error && <ErrorNote message={a.error} />}
        <p className="small muted">
          Choose your accounts. Each draft uses only that account’s writing
          rules and findings you accepted.
        </p>
        <FocusBeam active={a.busy}>
          <div className="choices">
            {accounts?.map((account: any) => {
              const selected = selections.find(
                  (x) => x.accountId === account.id,
                ),
                formats = Object.keys(account.capabilities.formats).filter(
                  (x) => account.capabilities.formats[x] === "supported",
                );
              return (
                <div className="choice" key={account.id}>
                  <input
                    type="checkbox"
                    aria-label={"Select " + account.handle}
                    checked={!!selected}
                    onChange={(e) =>
                      setSelections(
                        e.target.checked
                          ? [
                              ...selections,
                              {
                                accountId: account.id,
                                format: formats[0] || "text",
                              },
                            ]
                          : selections.filter(
                              (x) => x.accountId !== account.id,
                            ),
                      )
                    }
                  />
                  <Platform platform={account.platform} small />
                  <div className="grow">
                    <div className="small">{account.handle}</div>
                    <div className="tiny muted">
                      {platformNames[account.platform]} · {account.account_type}
                    </div>
                  </div>
                  {selected && (
                    <select
                      aria-label={"Format for " + account.handle}
                      value={selected.format}
                      onChange={(e) =>
                        setSelections(
                          selections.map((x) =>
                            x.accountId === account.id
                              ? { ...x, format: e.target.value }
                              : x,
                          ),
                        )
                      }
                    >
                      {formats.map((x) => (
                        <option key={x} value={x}>
                          {x === "short" ? "Shorts" : x}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              );
            })}
          </div>
        </FocusBeam>
        <div className="note">
          {mode === "demo"
            ? "Demo drafts are preset examples. No AI service is called."
            : "Connect your ChatGPT subscription and choose a model in Connections on this Mac. You can also write drafts yourself."}
        </div>
      </div>
    </Modal>
  );
}
function VariantEditor({
  variant,
  pkg,
  onClose,
}: {
  variant: any;
  pkg: any;
  onClose: () => void;
}) {
  const { data: accounts } = useLoad("accounts"),
    { data: assets } = useLoad("assets"),
    { request } = useApp(),
    a = useFormAction(),
    [accountId, setAccountId] = useState(variant?.account_id || ""),
    [format, setFormat] = useState(variant?.format || "text"),
    [payload, setPayload] = useState<any>(
      variant?.payload || {
        ...blankPayload,
        media: pkg.assets.map((x: any) => ({
          assetId: x.id,
          derivativeId: null,
        })),
      },
    ),
    [settingsText, setSettingsText] = useState(
      JSON.stringify(variant?.payload.settings || {}, null, 2),
    ),
    [hooks, setHooks] = useState<any>(null),
    [utm, setUtm] = useState(false);
  const account = accounts?.find((x: any) => x.id === accountId),
    formats = account
      ? Object.keys(account.capabilities.formats).filter(
          (x) => account.capabilities.formats[x] !== "unsupported",
        )
      : ["text"];
  const change = (key: string, value: any) =>
    setPayload({ ...payload, [key]: value });
  return (
    <Modal
      title={
        variant
          ? "Edit version · revision " + variant.revision
          : "Write a draft"
      }
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={a.busy || !accountId}
            onClick={() =>
              a.submit(
                () => {
                  let settings;
                  try {
                    settings = JSON.parse(settingsText);
                  } catch {
                    throw new Error("Platform settings must be valid JSON.");
                  }
                  return request(
                    variant ? "variants/" + variant.id : "variants",
                    variant ? "PATCH" : "POST",
                    variant
                      ? {
                          expectedRevisionId: variant.current_revision_id,
                          payload: { ...payload, settings },
                        }
                      : {
                          packageId: pkg.id,
                          accountId,
                          format,
                          payload: { ...payload, settings },
                        },
                  );
                },
                onClose,
                "Revision saved. Request approval again before publishing.",
              )
            }
          >
            {a.busy ? "Saving…" : "Save draft"}
          </button>
        </>
      }
    >
      <div className="stack">
        {a.error && <ErrorNote message={a.error} />}
        <div className="fields-2">
          <Field label="Destination account">
            <select
              aria-label="Version account"
              disabled={!!variant}
              value={accountId}
              onChange={(e) => {
                setAccountId(e.target.value);
                const account = accounts.find(
                  (x: any) => x.id === e.target.value,
                );
                setFormat(
                  Object.keys(account.capabilities.formats).find(
                    (x) => account.capabilities.formats[x] === "supported",
                  ) || "text",
                );
              }}
            >
              <option value="">Choose an account</option>
              {accounts?.map((x: any) => (
                <option key={x.id} value={x.id}>
                  {platformNames[x.platform]} · {x.handle}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Format">
            <select
              aria-label="Version format"
              disabled={!!variant}
              value={format}
              onChange={(e) => setFormat(e.target.value)}
            >
              {formats.map((x) => (
                <option key={x} value={x}>
                  {x === "short" ? "YouTube Shorts" : x}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="grid-equal">
          <div className="stack">
            <Field label="Hook">
              <input
                aria-label="Version hook"
                value={payload.hook}
                onChange={(e) => change("hook", e.target.value)}
                maxLength={300}
              />
            </Field>
            <Field label="Caption">
              <textarea
                aria-label="Version caption"
                value={payload.caption}
                onChange={(e) => change("caption", e.target.value)}
                style={{ minHeight: 150 }}
              />
            </Field>
            <Field label="Call to action">
              <input
                aria-label="Version call to action"
                value={payload.cta}
                onChange={(e) => change("cta", e.target.value)}
                maxLength={500}
              />
            </Field>
            <button
              className="btn"
              disabled={!accountId || a.busy}
              onClick={() =>
                void a
                  .run(() =>
                    request("ai", "POST", {
                      operation: "hooks",
                      accountId,
                      brief: pkg.brief,
                    }),
                  )
                  .then(setHooks)
                  .catch(() => {})
              }
            >
              Suggest hooks
            </button>
            {hooks && (
              <div className="note">
                <strong>{hooks.label}</strong>
                {hooks.output.hooks.map((hook: string) => (
                  <button
                    key={hook}
                    className="palette-option"
                    onClick={() => change("hook", hook)}
                  >
                    {hook}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="stack">
            {account?.platform === "youtube" && (
              <>
                <Field label="YouTube title">
                  <input
                    aria-label="Version title"
                    value={payload.title}
                    onChange={(e) => change("title", e.target.value)}
                    maxLength={120}
                  />
                </Field>
                <Field label="YouTube description">
                  <textarea
                    aria-label="Version description"
                    value={payload.description}
                    onChange={(e) => change("description", e.target.value)}
                  />
                </Field>
              </>
            )}
            <Field label="Visibility">
              <select
                aria-label="Version visibility"
                value={payload.visibility}
                onChange={(e) => change("visibility", e.target.value)}
              >
                <option value="public">Public</option>
                {account?.platform === "youtube" && (
                  <>
                    <option value="private">Private</option>
                    <option value="unlisted">Unlisted</option>
                  </>
                )}
              </select>
            </Field>
            <Field
              label="Platform settings (JSON)"
              help="Use settings supported by your publishing service. These settings are included when you request approval."
            >
              <textarea
                aria-label="Platform settings JSON"
                className="mono"
                value={settingsText}
                onChange={(e) => setSettingsText(e.target.value)}
              />
            </Field>
            <Field label="Media order">
              <div className="choices">
                {assets?.map((asset: any) => {
                  const selected = payload.media.find(
                    (m: any) => m.assetId === asset.id,
                  );
                  return (
                    <div key={asset.id} className="choice">
                      <input
                        type="checkbox"
                        aria-label={"Version media " + asset.filename}
                        checked={!!selected}
                        onChange={(e) =>
                          change(
                            "media",
                            e.target.checked
                              ? [
                                  ...payload.media,
                                  { assetId: asset.id, derivativeId: null },
                                ]
                              : payload.media.filter(
                                  (m: any) => m.assetId !== asset.id,
                                ),
                          )
                        }
                      />
                      <span className="tiny grow">{asset.filename}</span>
                      {selected && (
                        <select
                          aria-label={"Media version for " + asset.filename}
                          value={selected.derivativeId || ""}
                          onChange={(e) =>
                            change(
                              "media",
                              payload.media.map((m: any) =>
                                m.assetId === asset.id
                                  ? {
                                      ...m,
                                      derivativeId: e.target.value || null,
                                    }
                                  : m,
                              ),
                            )
                          }
                        >
                          <option value="">Original</option>
                          {asset.derivatives
                            ?.filter((d: any) => d.status === "ready")
                            .map((d: any) => (
                              <option key={d.id} value={d.id}>
                                {d.recipe.output} · {d.metadata.width}×
                                {d.metadata.height}
                              </option>
                            ))}
                        </select>
                      )}
                    </div>
                  );
                })}
              </div>
            </Field>
            <button className="btn" onClick={() => setUtm(!utm)}>
              UTM builder {utm ? "↑" : "↓"}
            </button>
            {utm && (
              <UTMBuilder
                value={payload.utm}
                onChange={(url) => change("utm", url)}
              />
            )}
          </div>
        </div>
        <div className="note">
          Saving creates a new revision. Request approval again after edits.
          Cancel active deliveries and wait for confirmation before editing.
        </div>
      </div>
    </Modal>
  );
}
function UTMBuilder({
  value,
  onChange,
}: {
  value: string;
  onChange: (url: string) => void;
}) {
  const [base, setBase] = useState(value || ""),
    [source, setSource] = useState(""),
    [medium, setMedium] = useState("social"),
    [campaign, setCampaign] = useState(""),
    [error, setError] = useState("");
  return (
    <div className="stack">
      <Field label="Destination URL">
        <input
          aria-label="UTM destination URL"
          value={base}
          onChange={(e) => setBase(e.target.value)}
          placeholder="https://example.com/page"
        />
      </Field>
      <Field label="Source">
        <input
          aria-label="UTM source"
          value={source}
          onChange={(e) => setSource(e.target.value)}
        />
      </Field>
      <Field label="Medium">
        <input
          aria-label="UTM medium"
          value={medium}
          onChange={(e) => setMedium(e.target.value)}
        />
      </Field>
      <Field label="Campaign">
        <input
          aria-label="UTM campaign"
          value={campaign}
          onChange={(e) => setCampaign(e.target.value)}
        />
      </Field>
      <button
        className="btn compact"
        onClick={() => {
          try {
            const u = new URL(base);
            if (u.protocol !== "https:" && u.protocol !== "http:")
              throw new Error();
            u.searchParams.set("utm_source", source);
            u.searchParams.set("utm_medium", medium);
            u.searchParams.set("utm_campaign", campaign);
            onChange(u.toString());
            setError("");
          } catch {
            setError("Enter a valid HTTP or HTTPS URL.");
          }
        }}
      >
        Build tagged URL
      </button>
      {value && <div className="mono">{value}</div>}
      {error && <ErrorNote message={error} />}
      <p className="tiny muted">
        UTM tags identify traffic from this link. They do not measure
        conversions on their own.
      </p>
    </div>
  );
}
function localDefault(timezone: string, minutes = 60) {
  const d = new Date(Date.now() + minutes * 60000);
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const value = (key: string) => p.find((x) => x.type === key)?.value;
  return `${value("year")}-${value("month")}-${value("day")}T${value("hour")}:${value("minute")}`;
}
function RequestApprovalModal({
  variant,
  onClose,
  job,
}: {
  variant: any;
  onClose: () => void;
  job?: any;
}) {
  const { request, timezone } = useApp(),
    a = useFormAction(),
    [local, setLocal] = useState(localDefault(timezone)),
    [disambiguation, setDisambiguation] = useState("reject");
  return (
    <Modal
      title={job ? "Request a new schedule" : "Request approval"}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={a.busy}
            onClick={() =>
              a.submit(
                async () => {
                  const time = await request("time", "POST", {
                    local,
                    timezone,
                    disambiguation,
                  });
                  return request(
                    job
                      ? "publications/" + job.id + "/reschedule"
                      : "variants/" + variant.id + "/request-approval",
                    "POST",
                    job
                      ? { scheduledAt: time.utc }
                      : {
                          revisionId: variant.current_revision_id,
                          scheduledAt: time.utc,
                        },
                  );
                },
                onClose,
                "Approval requested for this post and publishing time.",
              )
            }
          >
            {a.busy ? "Requesting…" : "Request approval"}
          </button>
        </>
      }
    >
      <div className="stack">
        {a.error && <ErrorNote message={a.error} />}
        <div className="row">
          <Platform platform={variant.platform} />
          <div>
            <strong>{variant.handle}</strong>
            <div className="tiny muted">
              {variant.format} · revision{" "}
              {variant.revision || variant.current_revision_id?.slice(0, 8)}
            </div>
          </div>
        </div>
        <div className="note">
          <strong>{variant.payload?.hook || variant.payload?.title}</strong>
          <br />
          {variant.payload?.caption}
          <br />
          Visibility: {variant.payload?.visibility || "public"}
        </div>
        <Field label={"Publishing time · " + timezone}>
          <input
            aria-label="Approval scheduled time"
            type="datetime-local"
            value={local}
            onChange={(e) => setLocal(e.target.value)}
            required
          />
        </Field>
        <Field label="Daylight saving time">
          <select
            aria-label="Daylight saving choice"
            value={disambiguation}
            onChange={(e) => setDisambiguation(e.target.value)}
          >
            <option value="reject">
              Reject times that do not exist or occur twice
            </option>
            <option value="earlier">Earlier occurrence</option>
            <option value="later">Later occurrence</option>
          </select>
        </Field>
        <div className="note">
          Review the account, content, media, settings, visibility and time. Any
          change requires a new approval.
        </div>
      </div>
    </Modal>
  );
}
function HistoryModal({
  variant,
  onClose,
}: {
  variant: any;
  onClose: () => void;
}) {
  const { data, error } = useLoad("variants/" + variant.id + "/revisions");
  return (
    <Modal title="Revision history" onClose={onClose}>
      <div className="stack">
        {error && <ErrorNote message={error} />}
        <div className="small">{variant.handle}</div>
        {data?.map((r: any) => (
          <div key={r.id} className="note">
            <div className="row spread">
              <strong>Revision {r.revision}</strong>
              <LocalTime value={r.created_at} />
            </div>
            <div style={{ marginTop: 10 }}>{r.payload.hook}</div>
            <p style={{ whiteSpace: "pre-wrap" }}>{r.payload.caption}</p>
            <div className="mono section-space">
              {r.id}
              <br />
              {r.content_hash}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}
export function Approvals() {
  const { data, error } = useLoad("approvals"),
    { timezone } = useApp(),
    [filter, setFilter] = useState("pending"),
    [review, setReview] = useState<any>(null);
  if (data === null) return <Loading error={error} />;
  const visible = data?.filter(
    (x: any) => filter === "all" || x.status === filter,
  );
  return (
    <>
      <Header
        title="Approvals"
        description="Check the content, account, media and time before approving a post."
      />
      <div className="tabs">
        {[
          ["pending", "Pending review"],
          ["approved", "Approved"],
          ["all", "All requests"],
        ].map(([id, label]) => (
          <button
            key={id}
            className={filter === id ? "active" : ""}
            onClick={() => setFilter(id)}
          >
            {label}{" "}
            <span className="muted">
              {data?.filter((x: any) => id === "all" || x.status === id)
                .length || 0}
            </span>
          </button>
        ))}
      </div>
      {error && <ErrorNote message={error} />}
      <div className="stack">
        {visible?.map((ap: any) => (
          <article className="panel" key={ap.id}>
            <div className="panel-body">
              <div className="row spread wrap">
                <div className="row">
                  <Platform platform={ap.platform} />
                  <div>
                    <h3>{ap.title}</h3>
                    <div className="tiny muted">
                      {ap.handle} · revision {ap.revision}
                    </div>
                  </div>
                </div>
                <Status value={ap.status} />
              </div>
              <div className="grid-equal section-space">
                <div>
                  <h3>
                    {ap.snapshot.payload.hook || ap.snapshot.payload.title}
                  </h3>
                  <p
                    className="small muted"
                    style={{ whiteSpace: "pre-wrap", marginTop: 8 }}
                  >
                    {ap.snapshot.payload.caption}
                  </p>
                </div>
                <div className="stack" style={{ gap: 8 }}>
                  <div className="tiny">
                    <Clock
                      size={11}
                      style={{ display: "inline", marginRight: 5 }}
                    />
                    <LocalTime value={ap.scheduled_at} timezone={timezone} />
                  </div>
                  <div className="tiny muted">
                    {ap.snapshot.format} · {ap.snapshot.visibility} ·{" "}
                    {ap.snapshot.media.length} media asset
                    {ap.snapshot.media.length === 1 ? "" : "s"}
                  </div>
                </div>
              </div>
              <div className="row spread section-space">
                <span className="tiny muted">
                  {ap.current_revision_id === ap.revision_id
                    ? "Current revision"
                    : "A newer revision exists"}{" "}
                  · {ap.snapshot.provenance}
                </span>
                <button
                  className="btn primary compact"
                  onClick={() => setReview(ap)}
                >
                  {ap.status === "pending" ? "Review post" : "View decision"}
                  <ArrowRight size={12} />
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>
      {visible?.length === 0 && (
        <Empty
          title="No requests in this view"
          description="Open a draft in Content to request approval of its content and publishing time."
        />
      )}
      {review && (
        <ApprovalReview approval={review} onClose={() => setReview(null)} />
      )}
    </>
  );
}
function ApprovalReview({
  approval: ap,
  onClose,
}: {
  approval: any;
  onClose: () => void;
}) {
  const { request, timezone, session } = useApp(),
    a = useFormAction(),
    [reason, setReason] = useState("");
  const canApprove = ["owner", "reviewer"].includes(session.role);
  const s = ap.snapshot;
  return (
    <Modal
      title="Review this post"
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Close
          </button>
          {ap.status === "pending" ? (
            <>
              <button
                className="btn"
                disabled={a.busy || !canApprove}
                onClick={() =>
                  a.submit(
                    () =>
                      request("approvals/" + ap.id + "/reject", "POST", {
                        reason,
                      }),
                    onClose,
                    "Approval rejected.",
                  )
                }
              >
                Reject
              </button>
              <button
                className="btn primary"
                disabled={
                  a.busy ||
                  !canApprove ||
                  ap.current_revision_id !== ap.revision_id
                }
                onClick={() =>
                  a.submit(
                    () =>
                      request("approvals/" + ap.id + "/approve", "POST", {}),
                    onClose,
                    "Post approved.",
                  )
                }
              >
                <Check size={13} />
                Approve this post
              </button>
            </>
          ) : ap.status === "approved" ? (
            <>
              <button
                className="btn"
                disabled={a.busy || !canApprove}
                onClick={() =>
                  a.submit(
                    () =>
                      request("approvals/" + ap.id + "/revoke", "POST", {
                        reason: reason || "Revoked by reviewer",
                      }),
                    onClose,
                    "Approval withdrawn. Cancel any scheduled delivery and wait for confirmation.",
                  )
                }
              >
                Withdraw approval
              </button>
              <button
                className="btn primary"
                disabled={a.busy}
                onClick={() =>
                  a.submit(
                    () =>
                      request("approvals/" + ap.id + "/schedule", "POST", {}),
                    onClose,
                    "Post queued. Check its delivery status in Calendar.",
                  )
                }
              >
                <CalendarDaysIcon />
                Schedule approved post
              </button>
            </>
          ) : null}
        </>
      }
    >
      <div className="stack">
        {a.error && <ErrorNote message={a.error} />}
        <div className="row spread">
          <div className="row">
            <Platform platform={ap.platform} />
            <div>
              <h2>{ap.handle}</h2>
              <div className="tiny muted">
                {ap.display_name} · {s.accountType} · {s.format}
              </div>
            </div>
          </div>
          <Status value={ap.status} />
        </div>
        <div className="note">
          <strong>Scheduled:</strong>{" "}
          <LocalTime value={s.scheduledAt} timezone={timezone} /> ({timezone})
          <br />
          <strong>Visibility:</strong> {s.visibility}
          <br />
          <strong>Account:</strong> <span className="mono">{s.accountId}</span>
          <br />
          <strong>Provider account:</strong>{" "}
          <span className="mono">{s.providerAccountId}</span>
        </div>
        <div className="grid-equal">
          <div className="stack">
            <div>
              <div className="eyebrow" style={{ marginBottom: 7 }}>
                Approved content
              </div>
              <h3>{s.payload.hook}</h3>
              <p
                className="small"
                style={{ whiteSpace: "pre-wrap", marginTop: 10 }}
              >
                {s.payload.caption}
              </p>
              {s.payload.cta && (
                <p className="small" style={{ marginTop: 10 }}>
                  {s.payload.cta}
                </p>
              )}
              {s.payload.title && (
                <p className="small" style={{ marginTop: 10 }}>
                  Title: {s.payload.title}
                </p>
              )}
              {s.payload.description && (
                <p
                  className="small muted"
                  style={{ marginTop: 10, whiteSpace: "pre-wrap" }}
                >
                  Description: {s.payload.description}
                </p>
              )}
            </div>
            <div>
              <div className="eyebrow">Media order</div>
              <div className="approval-media">
                {s.media.map((m: any, i: number) =>
                  m.mimeType.startsWith("video") ? (
                    <video
                      key={m.assetId}
                      controls
                      preload="metadata"
                      src={
                        "/api/v1/assets/" +
                        (m.derivativeId || m.assetId) +
                        "/file" +
                        (m.derivativeId ? "?derivative=true" : "")
                      }
                      aria-label={"Approval media " + (i + 1)}
                    />
                  ) : (
                    <img
                      key={m.assetId}
                      alt={"Approval media " + (i + 1)}
                      src={
                        "/api/v1/assets/" +
                        (m.derivativeId || m.assetId) +
                        "/file" +
                        (m.derivativeId ? "?derivative=true" : "")
                      }
                    />
                  ),
                )}
              </div>
              {!s.media.length && <p className="tiny muted">Text-only post.</p>}
              {s.media.map((m: any, i: number) => (
                <div key={m.assetId} className="mono muted">
                  {i + 1}. {m.derivativeChecksum || m.checksum}
                </div>
              ))}
            </div>
          </div>
          <div className="stack">
            <Field label="Platform settings">
              <pre className="log">
                {JSON.stringify(s.payload.settings, null, 2)}
              </pre>
            </Field>
            {ap.previous_payload && (
              <div className="note">
                <strong>Changed since the previous revision</strong>
                <div className="tiny" style={{ marginTop: 9 }}>
                  {[
                    "hook",
                    "caption",
                    "title",
                    "description",
                    "cta",
                    "visibility",
                    "settings",
                    "media",
                    "utm",
                  ].map((k) =>
                    JSON.stringify(ap.previous_payload[k]) !==
                    JSON.stringify(s.payload[k]) ? (
                      <div key={k}>• {k} changed</div>
                    ) : null,
                  )}
                </div>
              </div>
            )}
            <Field label="Decision note (optional)">
              <textarea
                aria-label="Approval decision note"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
            <div className="mono muted">
              Revision {s.revisionId}
              <br />
              Snapshot {ap.snapshot_hash}
            </div>
            <div className="note">
              {canApprove
                ? "Approve only after you check the content, account, media and time."
                : "An owner or reviewer must approve this post."}{" "}
              Schedule the post separately after approval.
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
function CalendarDaysIcon() {
  return <Clock size={12} />;
}
export function JobInspector({
  id,
  onClose,
}: {
  id: string;
  onClose: () => void;
}) {
  const { data: job, error, reload } = useLoad("publications/" + id),
    { request, timezone, mode } = useApp(),
    a = useAction(),
    [summary, setSummary] = useState<any>(null);
  return (
    <Modal
      title="Post delivery details"
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn" onClick={reload}>
            <RefreshCw size={12} />
            Refresh status
          </button>
          {job && mode === "demo" && job.state === "published" && (
            <button
              className="btn"
              disabled={a.busy}
              onClick={() =>
                void a
                  .run(
                    () =>
                      request(
                        "publications/" + id + "/collect-demo",
                        "POST",
                        {},
                      ),
                    "Demo metrics queued. Process the demo queue to collect them.",
                  )
                  .catch(() => {})
              }
            >
              Collect demo metrics
            </button>
          )}
          {job && job.state === "needs_reconciliation" && (
            <button
              className="btn"
              disabled={a.busy}
              onClick={() =>
                void a
                  .run(
                    () =>
                      request("publications/" + id + "/reconcile", "POST", {}),
                    "Delivery check queued.",
                  )
                  .then(reload)
                  .catch(() => {})
              }
            >
              Check delivery
            </button>
          )}
          {job && !["published", "cancelled", "failed"].includes(job.state) && (
            <button
              className="btn"
              disabled={a.busy}
              onClick={() =>
                void a
                  .run(
                    () => request("publications/" + id + "/cancel", "POST", {}),
                    "Cancellation requested. Check delivery status for confirmation.",
                  )
                  .then(reload)
                  .catch(() => {})
              }
            >
              Request cancellation
            </button>
          )}
          <button className="btn primary" onClick={onClose}>
            Done
          </button>
        </>
      }
    >
      <div className="stack">
        {(error || a.error) && <ErrorNote message={error || a.error} />}{" "}
        {!job ? (
          <Loading />
        ) : (
          <>
            <div className="row spread">
              <div className="row">
                <Platform platform={job.platform} />
                <div>
                  <h2>{job.handle}</h2>
                  <div className="mono muted">{job.id}</div>
                </div>
              </div>
              <Status value={job.state} />
            </div>
            {job.error && <ErrorNote message={job.error.message} />}
            <div className="grid-equal">
              <div className="stack">
                <div className="note">
                  <strong>Intended time:</strong>{" "}
                  <LocalTime value={job.scheduled_at} timezone={timezone} />
                  <br />
                  <strong>Scheduling owner:</strong> {job.scheduling_owner}
                  <br />
                  <strong>Provider job:</strong>{" "}
                  <span className="mono">
                    {job.provider_job_id || "Not accepted"}
                  </span>
                  <br />
                  <strong>Platform post:</strong>{" "}
                  <span className="mono">
                    {job.platform_post_id || "Not confirmed"}
                  </span>
                  {job.cancel_requested && (
                    <>
                      <br />
                      <strong>Cancellation requested</strong> — current status
                      remains {job.state}.
                    </>
                  )}
                </div>
                <h3>Attempts</h3>
                <div className="timeline">
                  {job.attempts.length ? (
                    job.attempts.map((t: any) => (
                      <div className="timeline-event" key={t.id}>
                        <div className="row spread">
                          <strong className="small">{t.operation}</strong>
                          <span className="pill">{t.outcome}</span>
                        </div>
                        <div className="tiny muted">
                          <LocalTime value={t.started_at} timezone={timezone} />
                        </div>
                        {t.error && (
                          <p className="tiny" style={{ marginTop: 6 }}>
                            {t.error.message}
                          </p>
                        )}
                        <div className="mono muted">{t.id}</div>
                      </div>
                    ))
                  ) : (
                    <p className="small muted">
                      No delivery attempt is recorded for this post.
                    </p>
                  )}
                </div>
                <button
                  className="btn"
                  disabled={a.busy || job.state !== "published"}
                  onClick={() =>
                    void a
                      .run(() =>
                        request("ai", "POST", {
                          operation: "summarize",
                          jobId: id,
                        }),
                      )
                      .then(setSummary)
                      .catch(() => {})
                  }
                >
                  Summarize post metrics
                </button>
                {summary && (
                  <div className="note">
                    <strong>{summary.label}</strong>
                    <br />
                    {summary.output.summary}
                    <br />
                    {summary.output.limitations}
                  </div>
                )}
              </div>
              <div className="stack">
                <h3>Receipt</h3>
                <pre className="log">
                  {JSON.stringify(
                    job.receipt || { status: "No confirmed receipt yet." },
                    null,
                    2,
                  )}
                </pre>
                <h3>Approved post details</h3>
                <pre className="log">
                  {JSON.stringify(job.snapshot, null, 2)}
                </pre>
                <div className="note">
                  Service acceptance does not confirm publication. We check
                  uncertain results and do not automatically resend them.
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
export function Calendar() {
  const { data: jobs, error } = useLoad("publications"),
    { data: accounts } = useLoad("accounts"),
    { timezone, inspectJob, mode } = useApp(),
    [view, setView] = useState("week"),
    [week, setWeek] = useState(0),
    [account, setAccount] = useState("all"),
    [state, setState] = useState("active"),
    [reschedule, setReschedule] = useState<any>(null);
  const today = localDefault(timezone).slice(0, 10),
    base = new Date(today + "T12:00:00Z");
  base.setUTCDate(base.getUTCDate() - ((base.getUTCDay() + 6) % 7) + week * 7);
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(base);
    d.setUTCDate(base.getUTCDate() + i);
    return { key: d.toISOString().slice(0, 10), date: d };
  });
  const filtered = jobs?.filter(
    (j: any) =>
      (account === "all" || j.account_id === account) &&
      (state === "all" || state === "active"
        ? state === "all" ||
          [
            "queued",
            "scheduled",
            "processing",
            "submitting",
            "needs_reconciliation",
          ].includes(j.state)
        : j.state === state),
  );
  const localDay = (date: string) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(date));
  if (jobs === null) return <Loading error={error} />;
  return (
    <>
      <Header
        title="Calendar"
        description={"Scheduled posts and delivery status · " + timezone}
        actions={
          <>
            {mode === "demo" && <WorkerButton />}
            <button className="btn" onClick={() => setWeek(0)}>
              Today
            </button>
          </>
        }
      />
      <div className="toolbar">
        <div className="row wrap">
          <button
            className="btn icon"
            onClick={() => setWeek(week - 1)}
            aria-label="Previous week"
          >
            <ChevronLeft size={14} />
          </button>
          <button
            className="btn icon"
            onClick={() => setWeek(week + 1)}
            aria-label="Next week"
          >
            <ChevronRight size={14} />
          </button>
          <span className="small">
            {new Intl.DateTimeFormat("en-US", {
              month: "short",
              day: "numeric",
            }).format(days[0].date)}{" "}
            –{" "}
            {new Intl.DateTimeFormat("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            }).format(days[6].date)}
          </span>
        </div>
        <div className="row wrap">
          <select
            className="select"
            aria-label="Calendar account filter"
            value={account}
            onChange={(e) => setAccount(e.target.value)}
          >
            <option value="all">All accounts</option>
            {accounts?.map((x: any) => (
              <option key={x.id} value={x.id}>
                {x.handle}
              </option>
            ))}
          </select>
          <select
            className="select"
            aria-label="Calendar status filter"
            value={state}
            onChange={(e) => setState(e.target.value)}
          >
            <option value="active">Active posts</option>
            <option value="all">All statuses</option>
            <option value="published">Published</option>
            <option value="cancelled">Cancelled</option>
            <option value="failed">Failed</option>
          </select>
          <LiquidTabs
            label="Calendar view"
            options={[
              { value: "week", label: "Week" },
              { value: "list", label: "List" },
            ]}
            value={view}
            onChange={setView}
          />
        </div>
      </div>
      {error && <ErrorNote message={error} />}{" "}
      {view === "week" ? (
        <div className="calendar-grid">
          {days.map((day) => (
            <section key={day.key} className="calendar-day">
              <div className="calendar-day-label">
                {new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(
                  day.date,
                )}
                <strong>{day.date.getUTCDate()}</strong>
              </div>
              {filtered
                ?.filter((j: any) => localDay(j.scheduled_at) === day.key)
                .map((j: any) => (
                  <button
                    key={j.id}
                    className="calendar-entry"
                    onClick={() => inspectJob(j.id)}
                  >
                    <div className="row" style={{ gap: 5 }}>
                      <Platform platform={j.platform} small />
                      <span className="truncate">{j.handle}</span>
                    </div>
                    <strong style={{ marginTop: 6 }}>{j.title}</strong>
                    <span>
                      {new Intl.DateTimeFormat("en-US", {
                        timeZone: timezone,
                        hour: "numeric",
                        minute: "2-digit",
                      }).format(new Date(j.scheduled_at))}
                    </span>
                    <div style={{ marginTop: 5 }}>
                      {j.state.replace(/_/g, " ")}
                    </div>
                  </button>
                ))}
            </section>
          ))}
        </div>
      ) : (
        <div className="panel table-scroll">
          <table>
            <thead>
              <tr>
                <th>Content & account</th>
                <th>Intended time</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered?.map((j: any) => (
                <tr key={j.id}>
                  <td>
                    <div className="account-mini">
                      <Platform platform={j.platform} />
                      <div>
                        <div>{j.title}</div>
                        <div className="tiny muted">{j.handle}</div>
                      </div>
                    </div>
                  </td>
                  <td className="tiny">
                    <LocalTime value={j.scheduled_at} timezone={timezone} />
                  </td>
                  <td>
                    <Status value={j.state} />
                    {j.cancel_requested && (
                      <div className="tiny muted">Cancellation requested</div>
                    )}
                  </td>
                  <td>
                    <div className="row">
                      <button
                        className="btn compact"
                        onClick={() => inspectJob(j.id)}
                      >
                        Inspect
                      </button>
                      {j.state === "cancelled" && (
                        <button
                          className="btn compact"
                          onClick={() => setReschedule(j)}
                        >
                          New schedule
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered?.length === 0 && (
            <Empty
              title="No posts in this view"
              description="Schedule approved posts from Approvals, or change the filters."
            />
          )}
        </div>
      )}
      <div className="note section-space">
        Changing the time requires a new approval. Cancel the old delivery and
        wait for confirmation before requesting a new schedule. MediaFlock does
        not resend posts already managed by your publishing service.
      </div>
      {reschedule && (
        <RequestApprovalModal
          job={reschedule}
          variant={{
            ...reschedule.snapshot,
            payload: reschedule.snapshot.payload,
            handle: reschedule.handle,
            platform: reschedule.platform,
            current_revision_id: reschedule.snapshot.revisionId,
          }}
          onClose={() => setReschedule(null)}
        />
      )}
    </>
  );
}
export function Analytics() {
  const [account, setAccount] = useState("all"),
    [periodView, setPeriodView] = useState("posts"),
    [periodStart, setPeriodStart] = useState(() =>
      new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10),
    ),
    [periodEnd, setPeriodEnd] = useState(() =>
      new Date().toISOString().slice(0, 10),
    ),
    [detail, setDetail] = useState<any>(null),
    { data: accounts } = useLoad("accounts"),
    { data, error } = useLoad(
      "analytics?start=" +
        periodStart +
        "T00:00:00Z&end=" +
        periodEnd +
        "T23:59:59Z" +
        (account === "all" ? "" : "&accountId=" + account),
    ),
    { timezone, inspectJob } = useApp();
  const observations = data?.observations || [];
  const chartRows = observations
    .filter(
      (x: any) =>
        x.metric === "views" &&
        x.horizon_hours === 24 &&
        x.availability === "available",
    )
    .slice()
    .sort(
      (a: any, b: any) => +new Date(a.observed_at) - +new Date(b.observed_at),
    );
  if (data === null) return <Loading error={error} />;
  return (
    <>
      <Header
        title="Analytics"
        description="Post performance, comparisons and recent updates."
        actions={
          <select
            className="select"
            aria-label="Analytics account filter"
            value={account}
            onChange={(e) => setAccount(e.target.value)}
          >
            <option value="all">All accounts</option>
            {accounts?.map((x: any) => (
              <option key={x.id} value={x.id}>
                {x.handle}
              </option>
            ))}
          </select>
        }
      />
      {error && <ErrorNote message={error} />}
      <Panel
        title="Views after 24 hours"
        action={<span className="pill">{chartRows.length} measurements</span>}
      >
        <div className="panel-body">
          {chartRows.length ? (
            <ObservationChart observations={chartRows} onInspect={setDetail} />
          ) : (
            <Empty
              title="No view metrics yet"
              description="Metrics appear after your approved posts publish and account access permits them."
            />
          )}
          <div className="tiny muted">
            {account === "all"
              ? "Accounts appear together here. Metrics from different platforms may use different definitions."
              : "Compare posts from the same account and format, measured after the same time."}{" "}
            Lifetime totals are never added together.
          </div>
        </div>
      </Panel>
      <Panel title="Date range (UTC)">
        <div className="panel-body stack">
          <div className="row wrap">
            <Field label="From">
              <input
                aria-label="Analytics period start"
                type="date"
                value={periodStart}
                onChange={(e) => setPeriodStart(e.target.value)}
              />
            </Field>
            <Field label="Through">
              <input
                aria-label="Analytics period end"
                type="date"
                value={periodEnd}
                onChange={(e) => setPeriodEnd(e.target.value)}
              />
            </Field>
            <Field label="Measurement view">
              <select
                aria-label="Analytics measurement view"
                value={periodView}
                onChange={(e) => setPeriodView(e.target.value)}
              >
                <option value="posts">Posts published during period</option>
                <option value="changes">
                  Changes measured during this period
                </option>
              </select>
            </Field>
          </div>
          <p className="tiny muted">{data?.period?.note}</p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Post</th>
                  <th>Account</th>
                  <th>
                    {periodView === "posts"
                      ? "Latest lifetime views"
                      : "Change in views"}
                  </th>
                  <th>Availability</th>
                </tr>
              </thead>
              <tbody>
                {(periodView === "posts"
                  ? data?.period?.postPerformance
                  : data?.period?.metricChanges
                )?.map((x: any) => (
                  <tr key={x.job_id || x.jobId}>
                    <td>
                      <button
                        className="action-link"
                        onClick={() => inspectJob(x.job_id || x.jobId)}
                      >
                        {x.title}
                      </button>
                    </td>
                    <td>{x.handle}</td>
                    <td>
                      {periodView === "posts"
                        ? x.value === null
                          ? "—"
                          : num(Number(x.value))
                        : x.change === null
                          ? "—"
                          : num(x.change)}
                    </td>
                    <td className="tiny muted">
                      {x.availability.replace(/_/g, " ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Panel>
      <div className="section-space panel">
        <div className="panel-head">
          <h2>Post metrics</h2>
          <span className="tiny muted">Sources and measurement details</span>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Post</th>
                <th>Account</th>
                <th>Metric</th>
                <th>Value</th>
                <th>Measured after</th>
                <th>Comparison baseline</th>
                <th>Source & update time</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {observations.slice(0, 60).map((x: any) => (
                <tr key={x.id}>
                  <td>
                    <button
                      className="action-link"
                      onClick={() => inspectJob(x.job_id)}
                    >
                      {x.title}
                    </button>
                  </td>
                  <td>
                    <div className="account-mini">
                      <Platform platform={x.platform} small />
                      <span className="tiny">{x.handle}</span>
                    </div>
                  </td>
                  <td>{x.metric}</td>
                  <td>
                    {x.availability === "available" ? (
                      num(Number(x.value))
                    ) : (
                      <span className="muted tiny">
                        {x.availability.replace(/_/g, " ")}
                      </span>
                    )}
                  </td>
                  <td className="tiny">
                    {x.horizon_hours}h · {x.scope}
                  </td>
                  <td className="tiny muted">
                    {x.baseline?.median === null
                      ? "Not enough data"
                      : `${num(x.baseline?.median)} median · ${x.baseline?.count} other posts`}
                  </td>
                  <td className="tiny muted">
                    {x.provenance}
                    <br />
                    <LocalTime value={x.observed_at} timezone={timezone} />
                  </td>
                  <td>
                    <button
                      className="btn compact"
                      onClick={() => setDetail(x)}
                    >
                      Evidence
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="note section-space">
        Missing or blocked metrics are not zero. Totals across platforms may
        include the same person more than once. Comparisons use matching posts
        and show sample sizes. Period changes require measurements at both
        boundaries.
      </div>
      {data?.collections?.some((x: any) =>
        ["failed", "missed"].includes(x.state),
      ) && (
        <Panel title="Metrics that need attention">
          {data.collections
            .filter((x: any) => ["failed", "missed"].includes(x.state))
            .map((x: any) => (
              <div className="list-row" key={x.id}>
                <Status value={x.state} />
                <div>
                  <div className="small">
                    {x.handle} · {x.horizon_hours}h
                  </div>
                  <p className="tiny muted">{x.error}</p>
                </div>
              </div>
            ))}
        </Panel>
      )}
      {detail && (
        <Modal title="Metric details" onClose={() => setDetail(null)}>
          <div className="stack">
            <div className="row">
              <Platform platform={detail.platform} />
              <strong>{detail.handle}</strong>
            </div>
            <div className="note">
              <strong>{detail.metric}:</strong>{" "}
              {detail.value === null
                ? "Unavailable"
                : num(Number(detail.value))}{" "}
              {detail.unit}
              <br />
              {detail.definition}
              <br />
              Availability: {detail.availability}
              <br />
              Scope: {detail.scope} · horizon {detail.horizon_hours}h<br />
              Observed{" "}
              <LocalTime value={detail.observed_at} timezone={timezone} />
              <br />
              Provenance: {detail.provenance}
            </div>
            {detail.baseline && (
              <div className="note">
                <strong>Comparison baseline:</strong>{" "}
                {detail.baseline.median === null
                  ? "Not enough data"
                  : `${num(detail.baseline.median)} median from ${detail.baseline.count} other posts; difference ${num(detail.baseline.difference)}`}
                <br />
                {detail.baseline.method}
                <br />
                Evidence:{" "}
                <span className="mono">
                  {detail.baseline.evidenceIds.join(", ") || "None"}
                </span>
              </div>
            )}
            <pre className="log">{JSON.stringify(detail.raw, null, 2)}</pre>
            <div className="mono">
              Snapshot {detail.id}
              <br />
              Post {detail.platform_post_id}
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
export function Experiments() {
  const { data: experiments, error } = useLoad("experiments"),
    [selected, setSelected] = useState<string | null>(null),
    [create, setCreate] = useState(false);
  return (
    <>
      <Header
        title="Experiments"
        description="Compare posts with one planned difference."
        actions={
          <button className="btn primary" onClick={() => setCreate(true)}>
            <Plus size={13} />
            New experiment
          </button>
        }
      />
      {error && <ErrorNote message={error} />}
      <div className="content-grid">
        {experiments?.map((e: any) => (
          <article key={e.id} className="experiment-card">
            <div className="row spread">
              <FlaskConical size={18} strokeWidth={1.4} />
              <span className="pill">{e.status}</span>
            </div>
            <h2 style={{ marginTop: 20 }}>{e.name}</h2>
            <p className="small muted" style={{ marginTop: 10, minHeight: 50 }}>
              {e.hypothesis}
            </p>
            <div className="row wrap" style={{ marginTop: 18 }}>
              <span className="pill">
                {e.changed_variable.replace("_", " ")}
              </span>
              <span className="pill">
                {e.primary_metric} · {e.horizon_hours}h
              </span>
              <span className="pill">{e.assignment_count} assignments</span>
            </div>
            <div className="divider" />
            <div className="row spread">
              <span className="tiny muted">
                Planned: {e.planned_samples} posts per group
              </span>
              <button className="btn compact" onClick={() => setSelected(e.id)}>
                View results <ArrowRight size={12} />
              </button>
            </div>
          </article>
        ))}
      </div>
      {experiments?.length === 0 && (
        <Empty
          title="Plan your first experiment"
          description="Choose accounts, formats, one change, a main metric and when to measure it."
        />
      )}
      <div className="note section-space">
        These posts may reach different audiences. Results show associations,
        not proof of cause. One post cannot establish a winner.
      </div>
      {create && (
        <ExperimentEditor
          onClose={() => setCreate(false)}
          onCreated={(id) => {
            setCreate(false);
            setSelected(id);
          }}
        />
      )}
      {selected && (
        <ExperimentInspector id={selected} onClose={() => setSelected(null)} />
      )}
    </>
  );
}
function ExperimentEditor({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { data: accounts } = useLoad("accounts"),
    { request } = useApp(),
    a = useFormAction(),
    [name, setName] = useState(""),
    [hypothesis, setHypothesis] = useState(""),
    [variable, setVariable] = useState("hook"),
    [metric, setMetric] = useState("views"),
    [denominator, setDenominator] = useState("views"),
    [horizon, setHorizon] = useState(24),
    [samples, setSamples] = useState(3),
    [selected, setSelected] = useState<string[]>([]),
    [endCondition, setEndCondition] = useState(
      "Planned posts measured after the chosen time",
    );
  return (
    <Modal
      title="Create an experiment"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={
              a.busy || !name || hypothesis.length < 10 || !selected.length
            }
            onClick={() =>
              a.submit(
                () =>
                  request("experiments", "POST", {
                    name,
                    hypothesis,
                    changedVariable: variable,
                    primaryMetric: metric,
                    denominator:
                      metric === "engagement_rate" ? denominator : null,
                    horizonHours: horizon,
                    plannedSamples: samples,
                    endCondition,
                    accounts: selected.map((accountId) => ({
                      accountId,
                      formats: Object.keys(
                        accounts.find((x: any) => x.id === accountId)
                          .capabilities.formats,
                      ).filter(
                        (key) =>
                          accounts.find((x: any) => x.id === accountId)
                            .capabilities.formats[key] === "supported",
                      ),
                    })),
                  }),
                (result) => onCreated(result.id),
                "Experiment created.",
              )
            }
          >
            Create experiment
          </button>
        </>
      }
    >
      <div className="stack">
        {a.error && <ErrorNote message={a.error} />}
        <Field label="Name">
          <input
            aria-label="Experiment name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="Hypothesis">
          <textarea
            aria-label="Experiment hypothesis"
            value={hypothesis}
            onChange={(e) => setHypothesis(e.target.value)}
            placeholder="Posts with a specific opening may receive more views after 24 hours…"
          />
        </Field>
        <div className="fields-2">
          <Field label="Change to compare">
            <select
              aria-label="Change to compare"
              value={variable}
              onChange={(e) => setVariable(e.target.value)}
            >
              <option value="hook">Hook</option>
              <option value="format">Format</option>
              <option value="cta">Call to action</option>
              <option value="publishing_window">Publishing window</option>
            </select>
          </Field>
          <Field label="Main metric">
            <select
              aria-label="Main metric"
              value={metric}
              onChange={(e) => setMetric(e.target.value)}
            >
              {["views", "likes", "comments", "shares", "engagement_rate"].map(
                (x) => (
                  <option key={x}>{x}</option>
                ),
              )}
            </select>
          </Field>
          <Field label="Measure after (hours)">
            <input
              aria-label="Measurement time"
              type="number"
              min={1}
              max={720}
              value={horizon}
              onChange={(e) => setHorizon(Number(e.target.value))}
            />
          </Field>
          <Field label="Planned posts per group">
            <input
              aria-label="Planned samples"
              type="number"
              min={3}
              max={1000}
              value={samples}
              onChange={(e) => setSamples(Number(e.target.value))}
            />
          </Field>
          {metric === "engagement_rate" && (
            <Field label="Engagement denominator">
              <select
                aria-label="Engagement denominator"
                value={denominator}
                onChange={(e) => setDenominator(e.target.value)}
              >
                <option value="views">Views</option>
                <option value="impressions">Impressions</option>
              </select>
            </Field>
          )}
        </div>
        <Field label="Accounts and formats">
          <div className="choices">
            {accounts?.map((x: any) => (
              <label key={x.id} className="check-row">
                <input
                  type="checkbox"
                  checked={selected.includes(x.id)}
                  onChange={(e) =>
                    setSelected(
                      e.target.checked
                        ? [...selected, x.id]
                        : selected.filter((id) => id !== x.id),
                    )
                  }
                />
                <Platform platform={x.platform} small />
                <span>{x.handle}</span>
              </label>
            ))}
          </div>
          <span className="help">
            Use supported formats on each account. Results are grouped by
            account and format.
          </span>
        </Field>
        <Field label="When to finish">
          <input
            aria-label="Experiment end condition"
            value={endCondition}
            onChange={(e) => setEndCondition(e.target.value)}
          />
        </Field>
        <div className="note">
          Use at least three posts in each group. Compare the same account and
          format at the same measurement time.
        </div>
      </div>
    </Modal>
  );
}
function ExperimentInspector({
  id,
  onClose,
}: {
  id: string;
  onClose: () => void;
}) {
  const { data, error } = useLoad("experiments/" + id),
    { request } = useApp(),
    a = useAction(),
    [assign, setAssign] = useState(false),
    [suggestion, setSuggestion] = useState<any>(null),
    [observation, setObservation] = useState<any>(null);
  return (
    <Modal
      title={data?.experiment.name || "Experiment results"}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn" onClick={() => setAssign(!assign)}>
            Assign version
          </button>
          <button
            className="btn"
            disabled={a.busy}
            onClick={() =>
              void a
                .run(
                  () => request("experiments/" + id + "/evaluate", "POST", {}),
                  "Comparison and supporting measurements saved.",
                )
                .catch(() => {})
            }
          >
            Save evaluation
          </button>
          <button
            className="btn primary"
            disabled={a.busy}
            onClick={() =>
              void a
                .run(() =>
                  request("experiments/" + id + "/suggest", "POST", {}),
                )
                .then(setSuggestion)
                .catch(() => {})
            }
          >
            Propose next experiment
          </button>
        </>
      }
    >
      <div className="stack">
        {(error || a.error) && <ErrorNote message={error || a.error} />}{" "}
        {!data ? (
          <Loading />
        ) : (
          <>
            <div className="note">
              <strong>Hypothesis:</strong> {data.experiment.hypothesis}
              <br />
              <strong>Change to compare:</strong>{" "}
              {data.experiment.changed_variable}
              <br />
              <strong>Main metric:</strong> {data.experiment.primary_metric}
              {data.experiment.denominator
                ? " / " + data.experiment.denominator
                : ""}{" "}
              at {data.experiment.horizon_hours}h<br />
              <strong>When to finish:</strong> {data.experiment.end_condition}
            </div>
            <div className="row spread">
              <h2>{data.comparison.status}</h2>
              <span className="pill">
                {data.comparison.availablePosts}/
                {data.comparison.totalAssignedPosts} posts with evidence
              </span>
            </div>
            {data.comparison.groups.map((g: any) => (
              <div className="panel" key={g.accountId + g.format}>
                <div className="panel-body">
                  <div className="small muted">
                    {
                      data.accounts.find(
                        (x: any) => x.account_id === g.accountId,
                      )?.handle
                    }{" "}
                    · {g.format} · {g.horizonHours}h
                  </div>
                  <div className="comparison-grid section-space">
                    <div>
                      <div className="eyebrow">Group A</div>
                      <div className="metric-value">{num(g.A.median)}</div>
                      <div className="tiny muted">{g.A.count} posts</div>
                      <div className="bar-track section-space">
                        <div
                          className="bar-fill"
                          style={{
                            width:
                              Math.max(
                                5,
                                ((g.A.median || 0) /
                                  Math.max(
                                    1,
                                    g.A.median || 0,
                                    g.B.median || 0,
                                  )) *
                                  100,
                              ) + "%",
                          }}
                        />
                      </div>
                    </div>
                    <div>
                      <div className="eyebrow">Group B</div>
                      <div className="metric-value">{num(g.B.median)}</div>
                      <div className="tiny muted">{g.B.count} posts</div>
                      <div className="bar-track section-space">
                        <div
                          className="bar-fill"
                          style={{
                            width:
                              Math.max(
                                5,
                                ((g.B.median || 0) /
                                  Math.max(
                                    1,
                                    g.A.median || 0,
                                    g.B.median || 0,
                                  )) *
                                  100,
                              ) + "%",
                            background: "#888",
                          }}
                        />
                      </div>
                    </div>
                  </div>
                  <div className="note section-space">
                    <strong>{g.status}.</strong> Median difference B − A:{" "}
                    {num(g.difference)}. {g.independentSources} distinct source
                    packages.
                    <br />
                    {g.limitations}
                  </div>
                </div>
              </div>
            ))}
            {!data.comparison.groups.length && (
              <Empty
                title="Not enough data"
                description="Assign versions and publish approved posts. Compare results after metrics arrive for the same measurement time."
              />
            )}
            <div className="note">
              <strong>Next action:</strong> {data.comparison.nextAction}
            </div>
            {assign && (
              <AssignmentForm
                experiment={data}
                onDone={() => setAssign(false)}
              />
            )}
            <Panel title="Assignments">
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Group</th>
                      <th>Account</th>
                      <th>Content</th>
                      <th>Revision</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.assignments.map((x: any) => (
                      <tr key={x.id}>
                        <td>{x.arm}</td>
                        <td>{x.handle}</td>
                        <td>{x.title}</td>
                        <td className="mono">
                          {x.revision_id.slice(0, 8)}
                          {x.current_revision_id !== x.revision_id &&
                            " · revised after assignment"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
            <Panel title="Supporting metrics">
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Group</th>
                      <th>Metric</th>
                      <th>Value</th>
                      <th>Measured after</th>
                      <th>Source</th>
                      <th>Snapshot ID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.evidence.map((x: any) => (
                      <tr key={x.id}>
                        <td>{x.arm}</td>
                        <td>{x.metric}</td>
                        <td>
                          {x.value === null
                            ? x.availability
                            : num(Number(x.value))}
                        </td>
                        <td>{x.horizon_hours}h</td>
                        <td>{x.provenance}</td>
                        <td className="mono">{x.id}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
            {suggestion && (
              <div className="note">
                <strong>{suggestion.label}</strong>
                <br />
                {suggestion.output.hypothesis}
                <br />
                {suggestion.output.nextAction}
                <br />
                {suggestion.output.limitations}
              </div>
            )}{" "}
            {data.insights.length > 0 && (
              <div className="row wrap">
                <button
                  className="btn"
                  disabled={a.busy}
                  onClick={() =>
                    void a
                      .run(() =>
                        request("ai", "POST", {
                          operation: "observation",
                          experimentId: id,
                          accountId: data.accounts[0].account_id,
                        }),
                      )
                      .then(setObservation)
                      .catch(() => {})
                  }
                >
                  Draft a finding for this account
                </button>
                {observation && (
                  <button
                    className="btn"
                    disabled={a.busy}
                    onClick={() =>
                      void a
                        .run(
                          () =>
                            request(
                              "experiments/" + id + "/observation",
                              "POST",
                              {
                                accountId: data.accounts[0].account_id,
                                insightId: data.insights[0].id,
                                text: observation.output.observation,
                              },
                            ),
                          "Finding saved. Accept it in Accounts to use it as a writing rule.",
                        )
                        .then(() => setObservation(null))
                        .catch(() => {})
                    }
                  >
                    Save proposed finding
                  </button>
                )}
              </div>
            )}
            {observation && (
              <div className="note">
                <strong>{observation.label}</strong>
                <br />
                {observation.output.observation}
                <br />
                {observation.output.limitations}
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
function AssignmentForm({
  experiment,
  onDone,
}: {
  experiment: any;
  onDone: () => void;
}) {
  const { data: packages } = useLoad("packages"),
    { request } = useApp(),
    a = useFormAction(),
    [packageId, setPackageId] = useState(""),
    [variants, setVariants] = useState<any[]>([]),
    [variantId, setVariantId] = useState(""),
    [arm, setArm] = useState("A");
  return (
    <div className="note">
      <div className="stack">
        {a.error && <ErrorNote message={a.error} />}
        <Field label="Source content">
          <select
            aria-label="Assignment content"
            value={packageId}
            onChange={async (e) => {
              setPackageId(e.target.value);
              setVariantId("");
              const p = await request("packages/" + e.target.value);
              setVariants(
                p.variants.filter((v: any) =>
                  experiment.accounts.some(
                    (x: any) =>
                      x.account_id === v.account_id &&
                      x.formats.includes(v.format),
                  ),
                ),
              );
            }}
          >
            <option value="">Choose content</option>
            {packages?.map((x: any) => (
              <option key={x.id} value={x.id}>
                {x.title}
              </option>
            ))}
          </select>
        </Field>
        <div className="fields-2">
          <Field label="Version">
            <select
              aria-label="Assignment version"
              value={variantId}
              onChange={(e) => setVariantId(e.target.value)}
            >
              <option value="">Choose a supported version</option>
              {variants.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.handle} · revision {x.revision}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Group">
            <select
              aria-label="Experiment group"
              value={arm}
              onChange={(e) => setArm(e.target.value)}
            >
              <option>A</option>
              <option>B</option>
            </select>
          </Field>
        </div>
        <button
          className="btn primary"
          disabled={!variantId || a.busy}
          onClick={() =>
            a.submit(
              () =>
                request(
                  "experiments/" + experiment.experiment.id + "/assign",
                  "POST",
                  {
                    variantId,
                    revisionId: variants.find((x) => x.id === variantId)
                      .current_revision_id,
                    arm,
                  },
                ),
              onDone,
              "Version assigned to experiment.",
            )
          }
        >
          Assign this revision
        </button>
      </div>
    </div>
  );
}
export function Accounts() {
  const { data, error } = useLoad("accounts"),
    {} = useApp(),
    [inspect, setInspect] = useState<string | null>(null),
    [connect, setConnect] = useState(false);
  if (data === null) return <Loading error={error} />;
  return (
    <>
      <Header
        title="Accounts"
        description="Connected accounts, permissions and writing preferences."
        actions={
          <button className="btn primary" onClick={() => setConnect(true)}>
            <Plus size={13} />
            Connect account
          </button>
        }
      />
      {error && <ErrorNote message={error} />}
      <div className="panel table-scroll">
        <table>
          <thead>
            <tr>
              <th>Account</th>
              <th>Type</th>
              <th>Connection</th>
              <th>Formats</th>
              <th>Last sync</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data?.map((account: any) => (
              <tr key={account.id}>
                <td>
                  <div className="account-mini">
                    <Platform platform={account.platform} />
                    <div>
                      <div>{account.handle}</div>
                      <div className="tiny muted">
                        {platformNames[account.platform]} · {account.provenance}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="tiny">{account.account_type}</td>
                <td>
                  <Status value={account.status} />
                </td>
                <td className="tiny muted">
                  {Object.entries(account.capabilities.formats)
                    .filter(([, v]) => v === "supported")
                    .map(([k]) => (k === "short" ? "Shorts" : k))
                    .join(", ") || "Unknown"}
                </td>
                <td className="tiny muted">
                  <LocalTime value={account.last_synced_at} />
                </td>
                <td>
                  <button
                    className="btn compact"
                    onClick={() => setInspect(account.id)}
                  >
                    Inspect
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="note section-space">
        YouTube videos and Shorts share one connected account. Features can be
        supported, unsupported, unknown or missing permission. Rules apply only
        to this account in this workspace.
      </div>
      {inspect && (
        <AccountInspector id={inspect} onClose={() => setInspect(null)} />
      )}{" "}
      {connect && <ConnectModal onClose={() => setConnect(false)} />}
    </>
  );
}
export function ConnectModal({ onClose }: { onClose: () => void }) {
  const { mode, request } = useApp(),
    a = useFormAction();
  const [platform, setPlatform] = useState("tiktok"),
    [connectionType, setConnectionType] = useState(""),
    [result, setResult] = useState<any>(null);
  const typeOptions =
    platform === "instagram"
      ? [
          ["instagram", "Instagram login"],
          ["facebook", "Facebook login"],
        ]
      : platform === "linkedin"
        ? [["organization", "Quickstart / organization"]]
        : platform === "x"
          ? [
              ["oauth2", "OAuth 2.0"],
              ["oauth1", "OAuth 1.0"],
            ]
          : [];
  return (
    <Modal
      title="Connect a social account"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Close
          </button>
          {mode === "live" && (
            <button
              className="btn primary"
              disabled={a.busy}
              onClick={() =>
                a.submit(
                  () =>
                    request("connections", "POST", {
                      platform,
                      ...(connectionType ? { connectionType } : {}),
                    }),
                  setResult,
                )
              }
            >
              Get connection link
            </button>
          )}
        </>
      }
    >
      <div className="stack">
        {a.error && <ErrorNote message={a.error} />}
        <Field label="Platform">
          <select
            aria-label="Connect platform"
            value={platform}
            onChange={(e) => {
              setPlatform(e.target.value);
              setConnectionType("");
            }}
          >
            {Object.entries(platformNames).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        {typeOptions.length > 0 && (
          <Field label="Connection type">
            <select
              aria-label="Connection type"
              value={connectionType || typeOptions[0][0]}
              onChange={(e) => setConnectionType(e.target.value)}
            >
              {typeOptions.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        )}
        <p className="small muted">
          {mode === "demo"
            ? "Account authorization is disabled in this test environment."
            : "Choose publishing and feed permissions on the platform. Review those permissions when you return."}
        </p>
        {result && (
          <a className="btn primary" href={result.url}>
            Continue to provider <ExternalLink size={12} />
          </a>
        )}
      </div>
    </Modal>
  );
}
function AccountInspector({
  id,
  onClose,
}: {
  id: string;
  onClose: () => void;
}) {
  const { data, error } = useLoad("accounts/" + id),
    { request, mode } = useApp(),
    a = useAction(),
    [rule, setRule] = useState(""),
    [audience, setAudience] = useState(""),
    [guidelines, setGuidelines] = useState(""),
    [tz, setTz] = useState("America/New_York"),
    [permissions, setPermissions] = useState(false);
  const [lastAccount, setLastAccount] = useState<any>(null);
  if (data && data !== lastAccount) {
    setLastAccount(data);
    setAudience(data.account.audience);
    setGuidelines(data.account.writing_guidelines);
    setTz(data.account.timezone);
  }
  return (
    <Modal
      title={data?.account.handle || "Account preferences"}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Close
          </button>
          {mode === "demo" && data?.account.status !== "connected" && (
            <button
              className="btn"
              disabled={a.busy}
              onClick={() =>
                void a
                  .run(
                    () =>
                      request(
                        "accounts/" + id + "/simulate-reconnect",
                        "POST",
                        {},
                      ),
                    "Simulated connection restored.",
                  )
                  .catch(() => {})
              }
            >
              Simulate reconnect
            </button>
          )}
          {data?.account.status === "connected" && (
            <button
              className="btn"
              disabled={a.busy}
              onClick={() =>
                void a
                  .run(
                    () => request("accounts/" + id + "/disconnect", "POST", {}),
                    "Account disconnected. Cancel pending deliveries and wait for confirmation.",
                  )
                  .catch(() => {})
              }
            >
              {mode === "demo" ? "Simulate disconnect" : "Disconnect account"}
            </button>
          )}
          <button
            className="btn primary"
            disabled={a.busy || !data}
            onClick={() =>
              void a
                .run(
                  () =>
                    request("accounts/" + id, "PATCH", {
                      audience,
                      writingGuidelines: guidelines,
                      timezone: tz,
                    }),
                  "Account preferences saved.",
                )
                .catch(() => {})
            }
          >
            Save preferences
          </button>
        </>
      }
    >
      <div className="stack">
        {(error || a.error) && <ErrorNote message={error || a.error} />}{" "}
        {!data ? (
          <Loading />
        ) : (
          <>
            <div className="row spread">
              <div className="row">
                <Platform platform={data.account.platform} />
                <div>
                  <h2>{data.account.display_name}</h2>
                  <div className="tiny muted">
                    {data.account.account_type} · {data.account.provenance}
                  </div>
                </div>
              </div>
              <Status value={data.account.status} />
            </div>
            <div className="grid-equal">
              <div className="stack">
                <Field label="Audience description">
                  <textarea
                    aria-label="Account audience"
                    value={audience}
                    onChange={(e) => setAudience(e.target.value)}
                  />
                </Field>
                <Field label="Writing guidelines">
                  <textarea
                    aria-label="Account writing guidelines"
                    value={guidelines}
                    onChange={(e) => setGuidelines(e.target.value)}
                  />
                </Field>
                <Field label="Timezone">
                  <input
                    aria-label="Account timezone"
                    value={tz}
                    onChange={(e) => setTz(e.target.value)}
                  />
                </Field>
                <h3>Your writing rules</h3>
                {data.rules.map((r: any) => (
                  <div className="note" key={r.id}>
                    {r.text}
                    <div className="tiny muted">{r.source}</div>
                  </div>
                ))}
                <Field label="Add a rule">
                  <textarea
                    aria-label="New account rule"
                    value={rule}
                    onChange={(e) => setRule(e.target.value)}
                  />
                </Field>
                <button
                  className="btn"
                  disabled={!rule.trim() || a.busy}
                  onClick={() =>
                    void a
                      .run(
                        () =>
                          request("accounts/" + id + "/rules", "POST", {
                            text: rule,
                          }),
                        "Account rule saved.",
                      )
                      .then(() => setRule(""))
                      .catch(() => {})
                  }
                >
                  Add rule
                </button>
              </div>
              <div className="stack">
                <h3>Permissions</h3>
                <p className="small muted">
                  {data.account.capabilities.operations?.publish === "supported"
                    ? "Publishing supported"
                    : "Review permissions before publishing"}
                </p>
                {mode === "live" && (
                  <button
                    className="btn compact"
                    onClick={() => setPermissions(true)}
                  >
                    Review permissions
                  </button>
                )}
                <details>
                  <summary className="tiny muted">Permission details</summary>
                  <pre className="log">
                    {JSON.stringify(data.account.capabilities, null, 2)}
                  </pre>
                </details>
                <h3>Findings from your posts</h3>
                {data.observations.length ? (
                  data.observations.map((o: any) => (
                    <div className="note" key={o.id}>
                      <strong>{o.status}</strong>
                      <br />
                      {o.text}
                      <div className="tiny muted" style={{ marginTop: 8 }}>
                        {o.method}
                        <br />
                        {o.limitations}
                      </div>
                      <div className="mono" style={{ marginTop: 8 }}>
                        Insight {o.insight_id}
                      </div>
                      {o.status === "proposed" && (
                        <button
                          className="btn compact section-space"
                          disabled={a.busy}
                          onClick={() =>
                            void a
                              .run(
                                () =>
                                  request(
                                    "observations/" + o.id + "/accept",
                                    "POST",
                                    {},
                                  ),
                                "Finding accepted as an account rule.",
                              )
                              .catch(() => {})
                          }
                        >
                          Use as a writing rule
                        </button>
                      )}
                    </div>
                  ))
                ) : (
                  <p className="small muted">
                    Saved findings from your posts will appear here.
                  </p>
                )}
                <div className="note">
                  Findings become writing rules only after you accept them.
                </div>
              </div>
            </div>
          </>
        )}
      </div>
      {permissions && data && (
        <AccountPermissionReview
          account={data.account}
          onClose={() => setPermissions(false)}
        />
      )}
    </Modal>
  );
}
export function ActivityPage() {
  const { data, error } = useLoad("activity"),
    { timezone, inspectJob } = useApp(),
    [search, setSearch] = useState(""),
    [event, setEvent] = useState<any>(null);
  const filtered = data?.filter(
    (x: any) =>
      x.action.toLowerCase().includes(search.toLowerCase()) ||
      x.resource_type.includes(search.toLowerCase()),
  );
  return (
    <>
      <Header
        title="Activity"
        description="A permanent record of approvals, publishing attempts and workspace changes."
      />
      <div className="toolbar">
        <div className="search-input">
          <Search size={13} />
          <input
            aria-label="Search activity"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search actions or items…"
          />
        </div>
        <span className="tiny muted">Latest {data?.length || 0} events</span>
      </div>
      {error && <ErrorNote message={error} />}
      <div className="panel table-scroll">
        <table>
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Action</th>
              <th>Actor</th>
              <th>Resource</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {filtered?.map((x: any) => (
              <tr key={x.id}>
                <td className="tiny">
                  <LocalTime value={x.created_at} timezone={timezone} />
                </td>
                <td>
                  <div className="small">
                    {x.action.replace(/\./g, " · ").replace(/_/g, " ")}
                  </div>
                  <div className="mono muted">{x.id.slice(0, 8)}</div>
                </td>
                <td className="tiny">{x.actor_kind}</td>
                <td className="tiny">{x.resource_type}</td>
                <td>
                  <button className="btn compact" onClick={() => setEvent(x)}>
                    Inspect
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {event && (
        <Modal
          title="Activity details"
          onClose={() => setEvent(null)}
          footer={
            <>
              {event.resource_type === "publish_job" && (
                <button
                  className="btn"
                  onClick={() => {
                    setEvent(null);
                    inspectJob(event.resource_id);
                  }}
                >
                  View publishing history
                </button>
              )}
              <button className="btn primary" onClick={() => setEvent(null)}>
                Done
              </button>
            </>
          }
        >
          <div className="stack">
            <div className="note">
              <strong>{event.action}</strong>
              <br />
              Actor: {event.actor_kind}
              <br />
              <LocalTime value={event.created_at} timezone={timezone} />
            </div>
            <pre className="log">{JSON.stringify(event, null, 2)}</pre>
          </div>
        </Modal>
      )}
    </>
  );
}
export function SettingsPage() {
  const { data, error } = useLoad("settings"),
    { request, session } = useApp(),
    a = useAction();
  const [timezone, setTimezone] = useState("America/New_York"),
    [token, setToken] = useState(false),
    [secret, setSecret] = useState<any>(null),
    [currentPassword, setCurrentPassword] = useState(""),
    [newPassword, setNewPassword] = useState("");
  const [lastSettings, setLastSettings] = useState<any>(null);
  const [recoveryEnabled, setRecoveryEnabled] = useState(false),
    [recoveryPassword, setRecoveryPassword] = useState(""),
    [recoveryCode, setRecoveryCode] = useState("");
  useEffect(() => {
    let cancelled = false;
    fetch("/api/config", { cache: "no-store" })
      .then((r) => r.json())
      .then((r) => {
        if (!cancelled) setRecoveryEnabled(!!r.data?.recoveryCodesEnabled);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  if (data && data !== lastSettings) {
    setLastSettings(data);
    setTimezone(data.workspace.timezone);
  }
  const worker = data?.worker?.[0];
  if (data === null) return <Loading error={error} />;
  return (
    <>
      <Header title="Settings" />
      {(error || a.error) && <ErrorNote message={error || a.error} />}
      <section className="settings-section stack">
        <h2>Preferences</h2>
        <Field label="Timezone">
          <select
            aria-label="Workspace timezone"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
          >
            {Array.from(new Set([timezone, ...workspaceTimezones]))
              .sort()
              .map((zone) => (
                <option key={zone} value={zone}>
                  {zone.replaceAll("_", " ").replaceAll("/", " / ")}
                </option>
              ))}
          </select>
        </Field>
        <button
          className="btn"
          disabled={a.busy || !data}
          onClick={() =>
            void a
              .run(
                () =>
                  request("settings", "PATCH", {
                    name: data.workspace.name,
                    timezone,
                  }),
                "Timezone saved. Refresh the page to apply it.",
              )
              .catch(() => {})
          }
        >
          Save preferences
        </button>
      </section>
      <section className="settings-section stack">
        <h2>Password</h2>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            void a
              .run(
                () =>
                  request("password", "POST", { currentPassword, newPassword }),
                "Password changed.",
              )
              .then(() => {
                setCurrentPassword("");
                setNewPassword("");
              })
              .catch(() => {});
          }}
        >
          <Field label="Current password">
            <input
              aria-label="Current password"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
            />
          </Field>
          <Field label="New password">
            <input
              aria-label="New password"
              type="password"
              autoComplete="new-password"
              minLength={12}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
            />
          </Field>
          <button
            className="btn"
            type="submit"
            disabled={a.busy || !currentPassword || newPassword.length < 12}
          >
            Change password
          </button>
        </form>
      </section>
      <section className="settings-section stack">
        <h2>Background processing</h2>
        <div className="row">
          <span className="dot" />
          <span>{worker?.healthy ? "Running" : "Offline"}</span>
        </div>
        {worker?.last_error && <ErrorNote message={worker.last_error} />}
      </section>
      {recoveryEnabled && (
        <section className="settings-section stack">
          <h2>Account recovery</h2>
          <p className="small muted">
            Save a recovery code in a password manager. Creating a new code
            replaces your previous code.
          </p>
          {recoveryCode ? (
            <div className="stack">
              <pre
                className="log auth-recovery-code"
                aria-label="Your recovery code"
              >
                {recoveryCode}
              </pre>
              <p className="small muted">
                This code appears only once. It can reset your password once.
              </p>
              <button
                className="btn"
                onClick={() =>
                  navigator.clipboard
                    .writeText(recoveryCode)
                    .catch(() => a.setError("Select and copy the code above."))
                }
              >
                Copy recovery code
              </button>
              <button
                className="btn primary"
                onClick={() => setRecoveryCode("")}
              >
                I saved my recovery code
              </button>
            </div>
          ) : (
            <form
              className="stack"
              onSubmit={(e) => {
                e.preventDefault();
                void a
                  .run(async () => {
                    const response = await fetch(
                      "/api/auth/recovery-code/generate",
                      {
                        method: "POST",
                        headers: {
                          "Content-Type": "application/json",
                          "x-mediaflock-csrf": session.csrf,
                          "x-workspace-id": session.workspaceId,
                        },
                        body: JSON.stringify({
                          currentPassword: recoveryPassword,
                        }),
                      },
                    );
                    const result = await response.json();
                    if (!response.ok)
                      throw new Error(
                        result.error?.message ||
                          "Could not create your recovery code.",
                      );
                    return result.recoveryCode;
                  })
                  .then((code) => {
                    setRecoveryCode(code);
                    setRecoveryPassword("");
                  })
                  .catch(() => {});
              }}
            >
              <Field label="Current password">
                <input
                  aria-label="Password for recovery code"
                  type="password"
                  autoComplete="current-password"
                  value={recoveryPassword}
                  onChange={(e) => setRecoveryPassword(e.target.value)}
                  required
                />
              </Field>
              <button
                className="btn"
                type="submit"
                disabled={a.busy || !recoveryPassword}
              >
                Create recovery code
              </button>
            </form>
          )}
        </section>
      )}
      <details className="settings-section settings-disclosure">
        <summary>
          <span>API access</span>
          <ChevronDown size={16} aria-hidden="true" />
        </summary>
        <div className="stack settings-api-content">
          <div className="row spread">
            <h2>Access tokens</h2>
            <button className="btn compact" onClick={() => setToken(true)}>
              Create token
            </button>
          </div>
          {!data.tokens.length && (
            <p className="small muted">No access tokens yet.</p>
          )}
          {data.tokens.map((t: any) => (
            <div className="row spread settings-token-row" key={t.id}>
              <div>
                <strong>{t.name}</strong>
                <p className="tiny muted">
                  {t.scopes.join(", ")} · expires{" "}
                  <LocalTime value={t.expires_at} />
                </p>
              </div>
              <span className="tiny muted">
                {t.revoked_at
                  ? "Revoked"
                  : new Date(t.expires_at) < new Date()
                    ? "Expired"
                    : "Active"}
              </span>
              {!t.revoked_at && (
                <button
                  className="btn compact"
                  disabled={a.busy}
                  onClick={() =>
                    void a
                      .run(
                        () => request("tokens/" + t.id, "DELETE"),
                        "Token revoked.",
                      )
                      .catch(() => {})
                  }
                >
                  Revoke
                </button>
              )}
            </div>
          ))}
          <a
            className="action-link tiny settings-api-link"
            href="/api/openapi"
            target="_blank"
            rel="noreferrer"
          >
            API specification <ExternalLink size={12} />
          </a>
        </div>
      </details>
      {token && (
        <TokenModal
          onClose={() => setToken(false)}
          onCreated={(value) => {
            setToken(false);
            setSecret(value);
          }}
        />
      )}
      {secret && (
        <Modal
          title="Save your access token"
          onClose={() => setSecret(null)}
          footer={
            <button className="btn primary" onClick={() => setSecret(null)}>
              Done
            </button>
          }
        >
          <div className="stack">
            <p className="small muted">
              Copy this token now. It appears only once. Keep it private.
            </p>
            <pre className="log" aria-label="New API token secret">
              {secret.secret}
            </pre>
            <button
              className="btn"
              onClick={() => navigator.clipboard.writeText(secret.secret)}
            >
              <Copy size={12} />
              Copy token
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
function TokenModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (data: any) => void;
}) {
  const { request } = useApp(),
    a = useFormAction(),
    [name, setName] = useState(""),
    [scopes, setScopes] = useState(["read", "draft", "request_approval"]),
    [expiry, setExpiry] = useState(() =>
      new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
    );
  return (
    <Modal
      title="Create an API token"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={a.busy || !name || !scopes.length}
            onClick={() =>
              a.submit(
                () =>
                  request("tokens", "POST", {
                    name,
                    scopes,
                    expiresAt: new Date(expiry + "T23:59:59Z").toISOString(),
                  }),
                onCreated,
              )
            }
          >
            Create token
          </button>
        </>
      }
    >
      <div className="stack">
        {a.error && <ErrorNote message={a.error} />}
        <Field label="Name">
          <input
            aria-label="Token name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Local drafting agent"
          />
        </Field>
        <Field label="Permissions">
          <div className="choices">
            {["read", "draft", "request_approval", "schedule", "analytics"].map(
              (scope) => (
                <label className="check-row" key={scope}>
                  <input
                    type="checkbox"
                    checked={scopes.includes(scope)}
                    onChange={(e) =>
                      setScopes(
                        e.target.checked
                          ? [...scopes, scope]
                          : scopes.filter((x) => x !== scope),
                      )
                    }
                  />
                  {scope}
                </label>
              ),
            )}
          </div>
        </Field>
        <Field label="Expires (UTC)">
          <input
            aria-label="Token expiration"
            type="date"
            value={expiry}
            onChange={(e) => setExpiry(e.target.value)}
          />
        </Field>
        <div className="note">
          Tokens with scheduling permission can schedule only posts you have
          already approved. API tokens cannot approve posts.
        </div>
      </div>
    </Modal>
  );
}
export function IntegrationModal({
  service,
  entry,
  onClose,
}: {
  service: string;
  entry: any;
  onClose: () => void;
}) {
  const { request, mode, notify } = useApp(),
    a = useFormAction();
  const [key, setKey] = useState(""),
    [enabled, setEnabled] = useState(entry?.enabled ?? true),
    [model, setModel] = useState(entry?.config.model || ""),
    [ceiling, setCeiling] = useState(entry?.config.dailyTokenCeiling || 20000),
    [maxTokens, setMaxTokens] = useState(entry?.config.maxOutputTokens || 1500),
    [redirect, setRedirect] = useState(entry?.config.credentialMode === "own"),
    [allowPublishing, setAllowPublishing] = useState(
      entry?.config.publishingEnabled || false,
    ),
    [callbackConfigured, setCallbackConfigured] = useState(
      entry?.config.connectionCallbackConfigured || false,
    );
  const callback =
    (typeof window !== "undefined" ? window.location.origin : "") +
    "/api/v1/connections/callback";
  return (
    <Modal
      title={service === "openai" ? "Connect OpenAI" : "Connect Post for Me"}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Close
          </button>
          {mode === "live" && (
            <button
              className="btn primary"
              disabled={a.busy || (!key && !entry?.has_key)}
              onClick={() =>
                a.submit(
                  async () => {
                    await request("integrations/" + service, "PUT", {
                      ...(key ? { apiKey: key } : {}),
                      enabled,
                      config:
                        service === "openai"
                          ? {
                              model,
                              dailyTokenCeiling: ceiling,
                              maxOutputTokens: maxTokens,
                            }
                          : {
                              credentialMode: redirect ? "own" : "quickstart",
                              publishingEnabled: allowPublishing,
                              connectionCallbackConfigured: callbackConfigured,
                            },
                    });
                    return enabled
                      ? request(
                          "integrations/" + service + "/check",
                          "POST",
                          {},
                        )
                      : { message: "Connection saved and disabled." };
                  },
                  (value) => {
                    notify(value.message);
                    onClose();
                  },
                )
              }
            >
              Save connection
            </button>
          )}
        </>
      }
    >
      <div className="stack">
        {a.error && <ErrorNote message={a.error} />}{" "}
        {mode === "demo" ? (
          <p className="small muted">
            API keys cannot be saved in this test environment.
          </p>
        ) : (
          <>
            <Field label="API key">
              <input
                aria-label="Integration API key"
                type="password"
                autoComplete="off"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder={
                  entry?.has_key
                    ? "Leave blank to keep your key"
                    : "Paste your API key"
                }
              />
            </Field>
            <label className="check-row">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              Enable connection
            </label>
            {service === "openai" ? (
              <>
                <Field label="Model">
                  <input
                    aria-label="OpenAI model"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    required
                  />
                </Field>
                <div className="fields-2">
                  <Field label="Daily token limit">
                    <input
                      aria-label="Daily AI token limit"
                      type="number"
                      min={1000}
                      max={1000000}
                      value={ceiling}
                      onChange={(e) => setCeiling(Number(e.target.value))}
                    />
                  </Field>
                  <Field label="Output token limit">
                    <input
                      aria-label="Maximum output tokens"
                      type="number"
                      min={256}
                      max={4000}
                      value={maxTokens}
                      onChange={(e) => setMaxTokens(Number(e.target.value))}
                    />
                  </Field>
                </div>
                <p className="tiny muted">
                  AI drafts use your API account. You can edit drafts manually
                  without AI.
                </p>
              </>
            ) : (
              <>
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={allowPublishing}
                    onChange={(e) => setAllowPublishing(e.target.checked)}
                  />
                  Allow publishing only posts I approve
                </label>
                <Field label="Provider project">
                  <select
                    aria-label="Provider project type"
                    value={redirect ? "override" : "project"}
                    onChange={(e) => setRedirect(e.target.value === "override")}
                  >
                    <option value="project">Quickstart</option>
                    <option value="override">Own platform credentials</option>
                  </select>
                </Field>
                {
                  <>
                    <p className="small muted">
                      Set your Project Redirect URL in Post for Me to:
                    </p>
                    <code className="callback-url">{callback}</code>
                    <button
                      className="btn compact"
                      onClick={() => navigator.clipboard.writeText(callback)}
                    >
                      Copy redirect URL
                    </button>
                    <label className="check-row">
                      <input
                        type="checkbox"
                        checked={callbackConfigured}
                        onChange={(e) =>
                          setCallbackConfigured(e.target.checked)
                        }
                      />
                      I saved this redirect URL in Post for Me
                    </label>
                  </>
                }
              </>
            )}
            {entry?.has_key && (
              <button
                className="btn compact"
                disabled={a.busy}
                onClick={() =>
                  a.submit(
                    () => request("integrations/" + service, "DELETE"),
                    onClose,
                    "Connection removed.",
                  )
                }
              >
                Remove connection
              </button>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
export function ServiceModal({ onClose }: { onClose: () => void }) {
  const { request } = useApp(),
    a = useFormAction(),
    [name, setName] = useState(""),
    [type, setType] = useState("reference"),
    [url, setUrl] = useState(""),
    [notes, setNotes] = useState("");
  return (
    <Modal
      title="Add a service link"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={a.busy || !name || !url}
            onClick={() =>
              a.submit(
                () => request("services", "POST", { name, type, url, notes }),
                onClose,
                "Service link saved.",
              )
            }
          >
            Save link
          </button>
        </>
      }
    >
      <div className="stack">
        {a.error && <ErrorNote message={a.error} />}
        <Field label="Service name">
          <input
            aria-label="Service name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="Type">
          <select
            aria-label="Service type"
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            {[
              "reference",
              "storage",
              "publishing",
              "analytics",
              "automation",
            ].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </Field>
        <Field label="Service URL">
          <input
            aria-label="Service URL"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://service.example/dashboard"
          />
        </Field>
        <Field label="Notes">
          <textarea
            aria-label="Service notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>
        <div className="note">
          This saves a service link without connecting to it or retrieving data.
          Save API keys in connection settings.
        </div>
      </div>
    </Modal>
  );
}
