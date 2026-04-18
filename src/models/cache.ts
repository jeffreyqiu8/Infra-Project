/**
 * A cached HTTP response stored in Redis or DynamoDB.
 */
export interface CachedResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  cachedAt: number;
  ttl: number;
}

/**
 * Cache layer contract with Redis primary and DynamoDB fallback.
 */
export interface CacheLayer {
  get(key: string, applicationId: string): Promise<CachedResponse | null>;
  set(key: string, applicationId: string, response: CachedResponse, ttlSeconds: number): Promise<void>;
  invalidate(key: string, applicationId: string): Promise<void>;
  invalidatePattern(pattern: string, applicationId: string): Promise<void>;
}

/**
 * DynamoDB item shape for a cache entry.
 */
export interface CacheItem {
  PK: string;
  SK: string;
  GSI1PK: string;
  GSI1SK: string;
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  cachedAt: number;
  TTL: number;
  Type: 'Cache';
}
