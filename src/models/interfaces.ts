import type { RateLimitConfig } from './rate-limit.js';

/**
 * Incoming API Gateway proxy event shape.
 */
export interface GatewayEvent {
  httpMethod: string;
  path: string;
  headers: Record<string, string>;
  body: string | null;
  queryStringParameters: Record<string, string> | null;
  requestContext: {
    identity: {
      sourceIp: string;
    };
  };
}

/**
 * Outgoing API Gateway proxy response shape.
 */
export interface GatewayResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

/**
 * Registered route definition used by the router.
 */
export interface RouteDefinition {
  method: string;
  path: string;
  handler: RouteHandler;
  cacheable: boolean;
  cacheTtlSeconds?: number;
  rateLimitOverride?: RateLimitConfig;
  requiresAuth: boolean;
}

/**
 * Handler function invoked when a route matches.
 */
export type RouteHandler = (context: RequestContext) => Promise<GatewayResponse>;

/**
 * Request context enriched by the middleware pipeline.
 */
export interface RequestContext {
  correlationId: string;
  sourceIp: string;
  identity: import('./auth.js').AuthResult['identity'];
  httpMethod: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
  queryParams: Record<string, string>;
  timestamp: number;
}
