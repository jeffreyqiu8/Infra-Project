/**
 * Entity type constants used as the `Type` discriminator in DynamoDB items.
 */
export const EntityType = {
  ApiKey: 'ApiKey',
  RateLimit: 'RateLimit',
  Cache: 'Cache',
  Job: 'Job',
  Idempotency: 'Idempotency',
  WebSocketConnection: 'WebSocketConnection',
} as const;

export type EntityTypeName = (typeof EntityType)[keyof typeof EntityType];

// ---------------------------------------------------------------------------
// Key pattern helpers
// ---------------------------------------------------------------------------

/** API Key entity keys. */
export function apiKeyKeys(keyHash: string) {
  return { PK: `APIKEY#${keyHash}`, SK: 'META' } as const;
}

export function apiKeyGSI1Keys(appId: string, keyHash: string) {
  return { GSI1PK: `APP#${appId}`, GSI1SK: `APIKEY#${keyHash}` } as const;
}

/** Rate Limit entity keys (per-user). */
export function rateLimitUserKeys(userId: string, endpoint: string = 'GLOBAL') {
  return { PK: `RATELIMIT#USER#${userId}`, SK: `WINDOW#${endpoint}` } as const;
}

/** Rate Limit entity keys (per-IP). */
export function rateLimitIpKeys(ip: string, endpoint: string = 'GLOBAL') {
  return { PK: `RATELIMIT#IP#${ip}`, SK: `WINDOW#${endpoint}` } as const;
}

/** Cache entity keys. */
export function cacheKeys(appId: string, keyHash: string) {
  return { PK: `CACHE#${appId}#${keyHash}`, SK: 'META' } as const;
}

export function cacheGSI1Keys(appId: string, keyPrefix: string) {
  return { GSI1PK: `CACHE#${appId}`, GSI1SK: `KEY#${keyPrefix}` } as const;
}

/** Job entity keys. */
export function jobKeys(jobId: string) {
  return { PK: `JOB#${jobId}`, SK: 'META' } as const;
}

export function jobGSI1Keys(appId: string, createdAt: number) {
  return { GSI1PK: `APP#${appId}`, GSI1SK: `JOB#${createdAt}` } as const;
}

/** Idempotency entity keys. */
export function idempotencyKeys(appId: string, idempotencyKey: string) {
  return { PK: `IDEMPOTENCY#${appId}#${idempotencyKey}`, SK: 'META' } as const;
}

/** WebSocket Connection entity keys. */
export function webSocketKeys(connectionId: string) {
  return { PK: `WSCONN#${connectionId}`, SK: 'META' } as const;
}

export function webSocketGSI1Keys(jobId: string, connectionId: string) {
  return { GSI1PK: `WSJOB#${jobId}`, GSI1SK: `CONN#${connectionId}` } as const;
}
