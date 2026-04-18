import type { RequestContext } from './interfaces.js';

/**
 * Payload submitted by a client to create a new job.
 */
export interface JobSubmission {
  type: string;
  payload: Record<string, unknown>;
  idempotencyKey?: string;
  priority?: 'normal' | 'high';
}

/**
 * Logical job record stored in DynamoDB.
 */
export interface JobRecord {
  jobId: string;
  applicationId: string;
  type: string;
  payload: Record<string, unknown>;
  state: 'queued' | 'processing' | 'completed' | 'failed';
  idempotencyKey?: string;
  result?: Record<string, unknown>;
  error?: { message: string; code: string; retryCount: number };
  createdAt: number;
  updatedAt: number;
}

/**
 * DynamoDB item shape for a job record.
 */
export interface JobItem {
  PK: string;
  SK: string;
  GSI1PK: string;
  GSI1SK: string;
  jobId: string;
  applicationId: string;
  type: string;
  payload: Record<string, unknown>;
  state: 'queued' | 'processing' | 'completed' | 'failed';
  idempotencyKey?: string;
  result?: Record<string, unknown>;
  error?: { message: string; code: string; retryCount: number };
  createdAt: number;
  updatedAt: number;
  TTL?: number;
  Type: 'Job';
}

/**
 * Job producer contract.
 */
export interface JobProducer {
  submit(
    submission: JobSubmission,
    context: RequestContext
  ): Promise<{ jobId: string; status: 'created' | 'existing' }>;
}

/**
 * Job worker contract – processes a single SQS message.
 */
export interface JobWorker {
  processMessage(sqsMessage: import('aws-lambda').SQSRecord): Promise<void>;
}

/**
 * Handler for a specific job type.
 */
export interface JobTypeHandler {
  execute(
    payload: Record<string, unknown>,
    context: JobExecutionContext
  ): Promise<Record<string, unknown>>;
  validate(payload: Record<string, unknown>): boolean;
}

/**
 * Context passed to a job type handler during execution.
 */
export interface JobExecutionContext {
  jobId: string;
  applicationId: string;
  correlationId: string;
  attemptNumber: number;
}
