/**
 * Relay server — HTTP error model
 * -------------------------------
 * One error type the request handler understands. Routes throw `HttpError`
 * (or any helper below) and the centralized handler in `app.ts` turns it into
 * a consistent JSON envelope. Anything that is NOT an `HttpError` is treated as
 * an unexpected 500 (and logged) so we never leak internal messages to clients.
 */

export interface ErrorBody {
  error: { code: string; message: string };
}

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
    readonly code: string = "error",
    /** Extra response headers to send alongside the error (e.g. `Allow`). */
    readonly headers: Record<string, string> = {}
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const notFound = (message = "Not found"): HttpError =>
  new HttpError(404, message, "not_found");

/**
 * 405 for a known resource hit with an unsupported method. Per RFC 9110 a 405
 * response MUST carry an `Allow` header listing the methods the resource does
 * support, so callers learn what to use instead.
 */
export const methodNotAllowed = (
  allow: string[],
  message = "Method not allowed"
): HttpError =>
  new HttpError(405, message, "method_not_allowed", { Allow: allow.join(", ") });

/** Normalize any thrown value into the JSON envelope + status to send. */
export function toErrorResponse(err: unknown): {
  statusCode: number;
  body: ErrorBody;
  headers: Record<string, string>;
  unexpected: boolean;
} {
  if (err instanceof HttpError) {
    return {
      statusCode: err.statusCode,
      body: { error: { code: err.code, message: err.message } },
      headers: err.headers,
      unexpected: false,
    };
  }
  return {
    statusCode: 500,
    body: { error: { code: "internal_error", message: "Internal server error" } },
    headers: {},
    unexpected: true,
  };
}
