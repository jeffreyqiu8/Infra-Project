import type { JobRecord } from './job.js';

/**
 * WebSocket handler contract for real-time job updates.
 */
export interface WebSocketHandler {
  onConnect(connectionId: string, jobId: string, applicationId: string): Promise<void>;
  onDisconnect(connectionId: string): Promise<void>;
  notifyJobUpdate(
    jobId: string,
    state: JobRecord['state'],
    data?: Record<string, unknown>
  ): Promise<void>;
}
