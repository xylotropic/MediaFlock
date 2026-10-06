import { z } from "zod";

export const editorScopeSchema = z
  .object({
    backend: z.string().url().max(2048),
    environment: z.enum(["demo", "live"]),
    userId: z.uuid(),
    workspaceId: z.uuid(),
  })
  .strict();
export type EditorScope = z.infer<typeof editorScopeSchema>;

/** A lease belongs to one verified login/workspace lifetime. Its identity is
 * deliberately separate from the durable namespace so projects can reopen. */
export class EditorScopeLease {
  readonly scope: Readonly<EditorScope>;
  readonly namespace: string;
  private readonly cancellation = new AbortController();
  constructor(input: EditorScope) {
    this.scope = Object.freeze(editorScopeSchema.parse(input));
    this.namespace = JSON.stringify([
      this.scope.backend,
      this.scope.environment,
      this.scope.userId,
      this.scope.workspaceId,
    ]);
  }
  get signal(): AbortSignal {
    return this.cancellation.signal;
  }
  assertActive(): void {
    if (this.signal.aborted)
      throw new DOMException(
        "The editing workspace has changed.",
        "AbortError",
      );
  }
  invalidate(): void {
    this.cancellation.abort();
  }
}
