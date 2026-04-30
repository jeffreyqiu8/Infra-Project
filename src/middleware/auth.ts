import { createHash } from 'node:crypto';
import * as jwt from 'jsonwebtoken';
import type { GatewayEvent } from '../models/interfaces.js';
import type { AuthResult, AuthMiddleware } from '../models/auth.js';
import { apiKeyKeys, EntityType } from '../models/dynamo.js';

// ---------------------------------------------------------------------------
// DynamoDB client abstraction (for testability)
// ---------------------------------------------------------------------------

/**
 * Minimal DynamoDB document-client interface used by the auth middleware.
 * Accepts the real AWS SDK DocumentClient or a test stub.
 */
export interface DynamoClient {
  get(params: {
    TableName: string;
    Key: Record<string, string>;
  }): Promise<{ Item?: Record<string, unknown> }>;
}

// ---------------------------------------------------------------------------
// JWKS provider abstraction (for testability)
// ---------------------------------------------------------------------------

/**
 * Provides the public key(s) used to verify JWT signatures.
 * In production this fetches and caches a JWKS endpoint; in tests it can
 * return a static key.
 */
export interface JwksProvider {
  getSigningKey(kid?: string): Promise<string | Buffer>;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface AuthConfig {
  /** DynamoDB table name that stores API key records. */
  tableName: string;
  /** DynamoDB client instance. */
  dynamoClient: DynamoClient;
  /** JWKS provider for JWT verification. */
  jwksProvider?: JwksProvider;
  /** Algorithms accepted for JWT verification (default: RS256). */
  jwtAlgorithms?: jwt.Algorithm[];
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Concrete implementation of the AuthMiddleware interface.
 *
 * Authentication priority:
 *   1. `x-api-key` header  → API key lookup in DynamoDB
 *   2. `Authorization: Bearer <token>` → JWT verification via JWKS
 *   3. Neither present → unauthenticated (401)
 */
export class Auth implements AuthMiddleware {
  private readonly tableName: string;
  private readonly dynamo: DynamoClient;
  private readonly jwksProvider?: JwksProvider;
  private readonly jwtAlgorithms: jwt.Algorithm[];

  constructor(config: AuthConfig) {
    this.tableName = config.tableName;
    this.dynamo = config.dynamoClient;
    this.jwksProvider = config.jwksProvider;
    this.jwtAlgorithms = config.jwtAlgorithms ?? ['RS256'];
  }

  // ── Public API ──────────────────────────────────────────────────

  async authenticate(request: GatewayEvent): Promise<AuthResult> {
    const headers = normalizeHeaders(request.headers);

    // 1. Try API key first
    const apiKey = headers['x-api-key'];
    if (apiKey) {
      return this.authenticateApiKey(apiKey);
    }

    // 2. Try JWT
    const authHeader = headers['authorization'];
    if (authHeader) {
      const token = extractBearerToken(authHeader);
      if (token) {
        return this.authenticateJwt(token);
      }
      return unauthenticated('Invalid Authorization header format. Expected "Bearer <token>"');
    }

    // 3. No credentials
    return unauthenticated('No authentication credentials provided');
  }

  // ── API Key authentication ──────────────────────────────────────

  private async authenticateApiKey(apiKey: string): Promise<AuthResult> {
    const keyHash = sha256(apiKey);
    const keys = apiKeyKeys(keyHash);

    try {
      const result = await this.dynamo.get({
        TableName: this.tableName,
        Key: { PK: keys.PK, SK: keys.SK },
      });

      if (!result.Item) {
        return unauthenticated('Invalid API key');
      }

      const item = result.Item;

      // Validate the item is actually an API key entity
      if (item['Type'] !== EntityType.ApiKey) {
        return unauthenticated('Invalid API key');
      }

      // Check optional expiration
      if (typeof item['expiresAt'] === 'number' && item['expiresAt'] < Date.now()) {
        return unauthenticated('API key has expired');
      }

      return {
        authenticated: true,
        identity: {
          userId: item['userId'] as string,
          applicationId: item['applicationId'] as string,
          authMethod: 'api-key',
        },
      };
    } catch {
      return unauthenticated('Failed to validate API key');
    }
  }

  // ── JWT authentication ──────────────────────────────────────────

  private async authenticateJwt(token: string): Promise<AuthResult> {
    if (!this.jwksProvider) {
      return unauthenticated('JWT authentication is not configured');
    }

    try {
      // Decode header to get kid for key lookup
      const decoded = jwt.decode(token, { complete: true });
      if (!decoded || typeof decoded === 'string') {
        return unauthenticated('Invalid JWT format');
      }

      const kid = decoded.header.kid;
      const signingKey = await this.jwksProvider.getSigningKey(kid);

      // Verify signature and expiration
      const payload = jwt.verify(token, signingKey, {
        algorithms: this.jwtAlgorithms,
        complete: false,
      });

      if (typeof payload === 'string') {
        return unauthenticated('Invalid JWT payload');
      }

      const claims = payload as jwt.JwtPayload;

      // Extract identity from standard claims
      const userId = claims.sub ?? claims['userId'] ?? 'unknown';
      const applicationId = claims['applicationId'] ?? claims.aud ?? 'unknown';

      return {
        authenticated: true,
        identity: {
          userId: String(userId),
          applicationId: Array.isArray(applicationId)
            ? String(applicationId[0])
            : String(applicationId),
          authMethod: 'jwt',
          claims: claims as Record<string, unknown>,
        },
      };
    } catch (err) {
      if (err instanceof jwt.TokenExpiredError) {
        return unauthenticated('JWT has expired');
      }
      if (err instanceof jwt.JsonWebTokenError) {
        return unauthenticated(`Invalid JWT: ${err.message}`);
      }
      return unauthenticated('Failed to verify JWT');
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** SHA-256 hash of a string, returned as hex. */
function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Normalize header keys to lowercase. */
function normalizeHeaders(headers: Record<string, string>): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers ?? {})) {
    normalized[key.toLowerCase()] = value;
  }
  return normalized;
}

/** Extract the token from a "Bearer <token>" header value. */
function extractBearerToken(authHeader: string): string | null {
  const parts = authHeader.split(' ');
  if (parts.length === 2 && parts[0].toLowerCase() === 'bearer' && parts[1]) {
    return parts[1];
  }
  return null;
}

/** Build an unauthenticated AuthResult with the given error message. */
function unauthenticated(error: string): AuthResult {
  return { authenticated: false, identity: null, error };
}
