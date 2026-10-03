export type DeliveryState =
  | "scheduled"
  | "processing"
  | "published"
  | "failed"
  | "cancelled"
  | "uncertain";
export interface Receipt {
  providerJobId: string;
  state: DeliveryState;
  platformPostId?: string;
  url?: string;
  scheduledAt?: string;
  error?: string;
  raw: Record<string, unknown>;
  authoritative: boolean;
}
export interface DeliveryEnvelope {
  version: number;
  adapterVersion: string;
  workspaceId: string;
  accountId: string;
  providerAccountId: string;
  platform: string;
  format: string;
  variantId: string;
  revisionId: string;
  contentHash: string;
  payload: {
    caption: string;
    hook: string;
    title: string;
    description: string;
    cta: string;
    visibility: string;
    settings: Record<string, unknown>;
  };
  media: {
    assetId: string;
    checksum: string;
    storagePath: string;
    mimeType: string;
    bytes: number;
    width?: number | null;
    height?: number | null;
    duration?: number | null;
    derivativeId: string | null;
    derivativeChecksum: string | null;
    derivativePath: string | null;
  }[];
  effectiveSettings?: Record<string, unknown>;
  scheduledAt: string;
  provenance: "simulated" | "provider";
}
export interface FeedPost {
  platformPostId: string;
  publishedAt?: string;
  metrics: Record<string, unknown>;
  raw: Record<string, unknown>;
}
export interface PublishingProvider {
  submit(
    envelope: DeliveryEnvelope,
    localKey: string,
    snapshotHash: string,
  ): Promise<Receipt>;
  status(providerJobId: string, envelope: DeliveryEnvelope): Promise<Receipt>;
  reconcile(
    localKey: string,
    snapshotHash: string,
    envelope: DeliveryEnvelope,
  ): Promise<Receipt | null>;
  cancel(providerJobId: string, envelope: DeliveryEnvelope): Promise<Receipt>;
  feed(providerAccountId: string, platformPostId?: string): Promise<FeedPost[]>;
}
export class ProviderError extends Error {
  constructor(
    public classification:
      "rate_limited" | "auth" | "validation" | "ambiguous" | "unavailable",
    message: string,
    public safeToRetry = false,
    public retryAfterSeconds?: number,
  ) {
    super(message);
  }
}
