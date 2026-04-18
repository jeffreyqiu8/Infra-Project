import type { GatewayEvent, GatewayResponse } from '../models/interfaces.js';
import { ApiError, ErrorCode } from '../models/errors.js';

/**
 * Validation error detail returned when a specific field fails validation.
 */
export interface ValidationError {
  field: string;
  message: string;
}

/**
 * Result of schema validation.
 */
export interface SchemaValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/**
 * Validate an incoming GatewayEvent against the required request schema.
 *
 * Required fields:
 *  - httpMethod: must be a non-empty string
 *  - path: must be a non-empty string starting with "/"
 *  - headers: must be a non-null object
 *
 * Returns a SchemaValidationResult indicating whether the event is valid
 * and, if not, which fields failed validation.
 */
export function validateRequestSchema(event: unknown): SchemaValidationResult {
  const errors: ValidationError[] = [];

  if (event === null || event === undefined || typeof event !== 'object') {
    return { valid: false, errors: [{ field: 'event', message: 'Request must be a non-null object' }] };
  }

  const obj = event as Record<string, unknown>;

  // httpMethod
  if (!('httpMethod' in obj) || obj.httpMethod === undefined || obj.httpMethod === null) {
    errors.push({ field: 'httpMethod', message: 'httpMethod is required' });
  } else if (typeof obj.httpMethod !== 'string') {
    errors.push({ field: 'httpMethod', message: 'httpMethod must be a string' });
  } else if (obj.httpMethod.trim().length === 0) {
    errors.push({ field: 'httpMethod', message: 'httpMethod must not be empty' });
  }

  // path
  if (!('path' in obj) || obj.path === undefined || obj.path === null) {
    errors.push({ field: 'path', message: 'path is required' });
  } else if (typeof obj.path !== 'string') {
    errors.push({ field: 'path', message: 'path must be a string' });
  } else if (obj.path.trim().length === 0) {
    errors.push({ field: 'path', message: 'path must not be empty' });
  } else if (!obj.path.startsWith('/')) {
    errors.push({ field: 'path', message: 'path must start with /' });
  }

  // headers
  if (!('headers' in obj) || obj.headers === undefined || obj.headers === null) {
    errors.push({ field: 'headers', message: 'headers is required' });
  } else if (typeof obj.headers !== 'object' || Array.isArray(obj.headers)) {
    errors.push({ field: 'headers', message: 'headers must be a non-null object' });
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Middleware function that validates the request schema and returns a 400
 * GatewayResponse if validation fails, or null if the request is valid.
 */
export function schemaValidationMiddleware(
  event: unknown,
  correlationId: string,
): GatewayResponse | null {
  const result = validateRequestSchema(event);

  if (!result.valid) {
    const error = new ApiError(
      ErrorCode.VALIDATION_ERROR,
      `Request validation failed: ${result.errors.map((e) => e.message).join('; ')}`,
      400,
      correlationId,
      { validationErrors: result.errors },
    );
    return error.toResponse();
  }

  return null;
}
