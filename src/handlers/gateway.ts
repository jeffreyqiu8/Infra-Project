import { randomUUID } from 'node:crypto';
import type { GatewayEvent, GatewayResponse, RequestContext } from '../models/interfaces.js';
import type { AuthMiddleware, AuthResult } from '../models/auth.js';
import type { RateLimiter } from '../models/rate-limit.js';
import type { CacheLayer, CachedResponse } from '../models/cache.js';
import type { RequestLogger } from '../models/logger.js';
import { ApiError, ErrorCode } from '../models/errors.js';
import { schemaValidationMiddleware } from '../middleware/schema-validator.js';
import { Router } from '../middleware/router.js';

/**
 * Dependencies injected into the Gateway Lambda handler.
 * Each middleware is optional so the handler can operate in degraded mode
 * (e.g. during testing or when a component is unavailable).
 */
export interface GatewayDependencies {
  router: Router;
  auth?: AuthMiddleware;
  rateLimiter?: RateLimiter;
  cacheLayer?: CacheLayer;
  logger?: RequestLogger;
}

/**
 * Build a cache key from the request path and query parameters.
 */
function buildCacheKey(path: string, queryParams: Record<string, string>): string {
  const sortedParams = Object.keys(queryParams)
    .sort()
    .map((k) => `${k}=${queryParams[k]}`)
    .join('&');
  return sortedParams ? `${path}?${sortedParams}` : path;
}

/**
 * Create the Gateway Lambda handler with the given dependencies.
 *
 * The handler orchestrates the full request pipeline:
 *   1. Assign correlation ID
 *   2. Schema validation
 *   3. Authentication
 *   4. Rate limiting
 *   5. Cache check (GET only)
 *   6. Route dispatch
 *   7. Cache store (GET only, cacheable routes)
 *   8. Logging
 */
export function createGatewayHandler(deps: GatewayDependencies) {
  return async (event: unknown): Promise<GatewayResponse> => {
    const correlationId = randomUUID();
    const startTime = Date.now();

    try {
      // ── 1. Schema validation ──────────────────────────────────────
      const validationError = schemaValidationMiddleware(event, correlationId);
      if (validationError) {
        return addCorrelationHeader(validationError, correlationId);
      }

      // After validation we know the event conforms to GatewayEvent
      const gatewayEvent = event as GatewayEvent;

      // ── 2. Build initial request context ──────────────────────────
      const context: RequestContext = {
        correlationId,
        sourceIp: gatewayEvent.requestContext?.identity?.sourceIp ?? 'unknown',
        identity: null,
        httpMethod: gatewayEvent.httpMethod.toUpperCase(),
        path: gatewayEvent.path,
        headers: normalizeHeaders(gatewayEvent.headers),
        body: parseBody(gatewayEvent.body),
        queryParams: gatewayEvent.queryStringParameters ?? {},
        timestamp: startTime,
      };

      // ── 3. Authentication ─────────────────────────────────────────
      if (deps.auth) {
        const authResult = await deps.auth.authenticate(gatewayEvent);

        if (!authResult.authenticated) {
          const error = new ApiError(
            ErrorCode.UNAUTHORIZED,
            authResult.error ?? 'Authentication failed',
            401,
            correlationId,
          );
          return addCorrelationHeader(error.toResponse(), correlationId);
        }

        context.identity = authResult.identity;
      }

      // ── 4. Route matching (needed before rate limit for per-endpoint overrides) ──
      const routeMatch = deps.router.match(context.httpMethod, context.path);

      // ── 5. Rate limiting ──────────────────────────────────────────
      if (deps.rateLimiter && context.identity) {
        const rateLimitResult = await deps.rateLimiter.checkAndConsume(
          context.identity.userId,
          context.sourceIp,
          context.identity.applicationId,
          context.path,
        );

        if (!rateLimitResult.allowed) {
          const retryAfter = rateLimitResult.retryAfterSeconds ?? 60;
          const error = new ApiError(
            ErrorCode.RATE_LIMIT_EXCEEDED,
            `Rate limit exceeded. Please retry after ${retryAfter} seconds.`,
            429,
            correlationId,
            { retryAfterSeconds: retryAfter },
          );
          const response = error.toResponse();
          response.headers['Retry-After'] = String(retryAfter);
          return addCorrelationHeader(response, correlationId);
        }
      }

      // ── 6. Cache check (GET requests on cacheable routes) ─────────
      const isCacheable =
        context.httpMethod === 'GET' && routeMatch?.route.cacheable === true;
      const applicationId = context.identity?.applicationId ?? 'anonymous';
      const cacheKey = buildCacheKey(context.path, context.queryParams);

      if (isCacheable && deps.cacheLayer) {
        const cached = await deps.cacheLayer.get(cacheKey, applicationId);
        if (cached) {
          const response: GatewayResponse = {
            statusCode: cached.statusCode,
            headers: { ...cached.headers, 'X-Cache': 'HIT' },
            body: cached.body,
          };
          return addCorrelationHeader(response, correlationId);
        }
      }

      // ── 7. Route dispatch ─────────────────────────────────────────
      let response: GatewayResponse;

      if (!routeMatch) {
        const error = new ApiError(
          ErrorCode.NOT_FOUND,
          `No route found for ${context.httpMethod} ${context.path}`,
          404,
          correlationId,
        );
        response = error.toResponse();
      } else {
        response = await routeMatch.route.handler(context);
      }

      // ── 8. Cache store (GET requests on cacheable routes, successful responses) ──
      if (
        isCacheable &&
        deps.cacheLayer &&
        response.statusCode >= 200 &&
        response.statusCode < 300
      ) {
        const ttl = routeMatch?.route.cacheTtlSeconds ?? 300;
        const cachedResponse: CachedResponse = {
          statusCode: response.statusCode,
          headers: response.headers,
          body: response.body,
          cachedAt: Date.now(),
          ttl,
        };
        // Fire-and-forget — cache write failure should not break the response
        deps.cacheLayer.set(cacheKey, applicationId, cachedResponse, ttl).catch(() => {
          // Swallow cache write errors; the response is still valid
        });
      }

      // Mark cache miss for cacheable GET requests that weren't served from cache
      if (isCacheable && !response.headers['X-Cache']) {
        response.headers['X-Cache'] = 'MISS';
      }

      return addCorrelationHeader(response, correlationId);
    } catch (err) {
      // ── Unhandled error fallback ──────────────────────────────────
      const error = new ApiError(
        ErrorCode.INTERNAL_ERROR,
        'An unexpected error occurred',
        500,
        correlationId,
      );
      return addCorrelationHeader(error.toResponse(), correlationId);
    } finally {
      // ── 9. Logging ────────────────────────────────────────────────
      // Logging is best-effort and non-blocking
      if (deps.logger) {
        try {
          await deps.logger.flush();
        } catch {
          // Swallow logger flush errors
        }
      }
    }
  };
}

/**
 * Normalize header keys to lowercase for consistent lookups.
 */
function normalizeHeaders(headers: Record<string, string>): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers ?? {})) {
    normalized[key.toLowerCase()] = value;
  }
  return normalized;
}

/**
 * Safely parse the request body. Returns the parsed JSON object,
 * the raw string, or null.
 */
function parseBody(body: string | null): unknown {
  if (body === null || body === undefined) {
    return null;
  }
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

/**
 * Add the X-Correlation-Id header to a response.
 */
function addCorrelationHeader(response: GatewayResponse, correlationId: string): GatewayResponse {
  return {
    ...response,
    headers: {
      ...response.headers,
      'X-Correlation-Id': correlationId,
    },
  };
}
