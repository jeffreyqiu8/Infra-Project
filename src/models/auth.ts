import type { GatewayEvent } from './interfaces.js';

/**
 * Result of an authentication attempt.
 */
export interface AuthResult {
  authenticated: boolean;
  identity: {
    userId: string;
    applicationId: string;
    authMethod: 'api-key' | 'jwt';
    claims?: Record<string, unknown>;
  } | null;
  error?: string;
}

/**
 * Auth middleware contract.
 */
export interface AuthMiddleware {
  authenticate(request: GatewayEvent): Promise<AuthResult>;
}
