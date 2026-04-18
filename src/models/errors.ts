/**
 * Standard platform error codes.
 */
export enum ErrorCode {
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  UNAUTHORIZED = 'UNAUTHORIZED',
  NOT_FOUND = 'NOT_FOUND',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}

/**
 * Structured API error that produces the standard error response JSON:
 * { error: { code, message, correlationId, details } }
 */
export class ApiError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly correlationId: string;
  public readonly details: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    message: string,
    statusCode: number,
    correlationId: string,
    details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.statusCode = statusCode;
    this.correlationId = correlationId;
    this.details = details;
  }

  /**
   * Produce the standard error response JSON body.
   */
  toResponseBody(): string {
    return JSON.stringify({
      error: {
        code: this.code,
        message: this.message,
        correlationId: this.correlationId,
        details: this.details,
      },
    });
  }

  /**
   * Produce a full GatewayResponse from this error.
   */
  toResponse(): { statusCode: number; headers: Record<string, string>; body: string } {
    return {
      statusCode: this.statusCode,
      headers: { 'Content-Type': 'application/json' },
      body: this.toResponseBody(),
    };
  }
}
