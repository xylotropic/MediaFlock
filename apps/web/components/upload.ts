"use client";

type ApiRequest = (
  path: string,
  method?: string,
  body?: unknown,
) => Promise<any>;
type UploadOptions = {
  tags?: string[];
  notes?: string;
  onProgress?: (stage: "uploading" | "validating") => void;
};
const attempts = new WeakMap<
  File,
  { key: string; fingerprint: string; checksum: string }
>();

function fileMime(header: Uint8Array) {
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((x, i) => header[i] === x))
    return "image/png";
  if (header[0] === 255 && header[1] === 216 && header[2] === 255)
    return "image/jpeg";
  const text = new TextDecoder().decode(header);
  if (text.slice(0, 4) === "RIFF" && text.slice(8, 12) === "WEBP")
    return "image/webp";
  if (text.slice(4, 8) === "ftyp") {
    const brand = text.slice(8, 12);
    if (brand === "qt  ") return "video/quicktime";
    if (/^(isom|iso[2-9]|mp4[12]|avc1|av01|M4V |MSNV|dash)$/.test(brand))
      return "video/mp4";
  }
  throw new Error("Upload a PNG, JPEG, WebP, MP4 or QuickTime file.");
}

/** Upload original bytes directly to private Storage, then await verification. */
export async function uploadOriginal(
  request: ApiRequest,
  file: File,
  options: UploadOptions = {},
) {
  if (!file.size || file.size > 50 * 1024 * 1024)
    throw new Error("Upload a file between 1 byte and 50 MiB.");
  const tags = options.tags || [],
    notes = options.notes || "";
  const fingerprint = JSON.stringify([tags, notes]);
  options.onProgress?.("uploading");
  let attempt = attempts.get(file);
  const mimeType = fileMime(
    new Uint8Array(await file.slice(0, 12).arrayBuffer()),
  );
  if (!attempt || attempt.fingerprint !== fingerprint) {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      await file.arrayBuffer(),
    );
    attempt = {
      key: crypto.randomUUID(),
      fingerprint,
      checksum: Array.from(new Uint8Array(digest), (b) =>
        b.toString(16).padStart(2, "0"),
      ).join(""),
    };
    attempts.set(file, attempt);
  }
  let upload;
  try {
    upload = await request("asset-uploads", "POST", {
      requestId: attempt.key,
      filename: file.name,
      bytes: file.size,
      mimeType,
      checksum: attempt.checksum,
      tags,
      notes,
    });
  } catch (error) {
    if (error instanceof Error && /upload link expired/i.test(error.message))
      attempts.delete(file);
    throw error;
  }
  if (upload.status === "ready") return upload.asset;
  if (["failed", "expired"].includes(upload.status)) {
    attempts.delete(file);
    throw new Error(
      upload.error ||
        "This upload could not be validated. Select the file again.",
    );
  }
  if (upload.status === "awaiting_upload") {
    const response = await fetch(upload.signedUrl, {
      method: "PUT",
      body: file,
      credentials: "omit",
      referrerPolicy: "no-referrer",
      headers: {
        "Content-Type": mimeType,
        "x-upsert": "false",
        "cache-control": "max-age=0",
      },
    }).catch(() => null);
    // A lost response or duplicate PUT may still have stored the first bytes.
    // Completion checks existence; verification checks the original checksum.
    try {
      upload = await request(
        "asset-uploads/" + upload.id + "/complete",
        "POST",
        {},
      );
    } catch (error) {
      if (!response?.ok)
        throw new Error(
          "Private storage could not receive the file. Keep it selected and retry.",
        );
      throw error;
    }
  }
  options.onProgress?.("validating");
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    if (upload.status === "ready") return upload.asset;
    if (["failed", "expired"].includes(upload.status)) {
      attempts.delete(file);
      throw new Error(
        upload.error || "The stored original could not be validated.",
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
    upload = await request("asset-uploads/" + upload.id);
  }
  throw new Error(
    "The file is stored privately and validation is still running. Keep it selected and retry to check its progress.",
  );
}
