// NextRequest normalizes loopback URL hostnames to localhost. The actual HTTP
// authority must still be the configured 127.0.0.1 listener; forwarded headers
// never establish local access. Subscription use also requires its startup gate.
export function localRequestAuthority(
  request: Request,
  configuredOrigin: string,
) {
  const configured = new URL(configuredOrigin),
    received = new URL(request.url);
  return (
    configured.protocol === "http:" &&
    configured.hostname === "127.0.0.1" &&
    !!configured.port &&
    request.headers.get("host") === configured.host &&
    received.protocol === configured.protocol &&
    received.port === configured.port &&
    ["127.0.0.1", "localhost"].includes(received.hostname)
  );
}
