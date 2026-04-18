/**
 * Configuration for a token bucket rate limiter.
 */
export interface RateLimitConfig {
  tokensPerWindow: number;
  windowSizeSeconds: number;
  burstLimit: number;
}

/**
 * Result of a rate limit check.
 */
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds?: number;
  limit: number;
}

/**
 * Rate limiter contract.
 */
export interface RateLimiter {
  checkAndConsume(
    userId: string,
    sourceIp: string,
    applicationId: string,
    endpoint?: string
  ): Promise<RateLimitResult>;
}

/**
 * DynamoDB item shape for a rate limit bucket.
 */
export interface RateLimitItem {
  PK: string;
  SK: string;
  tokens: number;
  lastRefillTimestamp: number;
  maxTokens: number;
  refillRate: number;
  windowSizeMs: number;
  TTL: number;
  Type: 'RateLimit';
}
