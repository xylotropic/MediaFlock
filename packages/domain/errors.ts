export class DomainError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
    public details?: unknown,
  ) {
    super(message);
  }
}
export function requireCondition(
  condition: unknown,
  code: string,
  message: string,
  status = 400,
): asserts condition {
  if (!condition) throw new DomainError(code, message, status);
}
export function publicError(error: unknown) {
  if (error instanceof DomainError)
    return { code: error.code, message: error.message, details: error.details };
  return {
    code: "internal_error",
    message: "The operation could not be completed. Check the server log.",
  };
}
export function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown error";
  return message
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/(?:sk-|mf_)[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/postgres(?:ql)?:\/\/[^\s]+/g, "[database]");
}
