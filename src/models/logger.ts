/**
 * Structured log entry written to CloudWatch.
 */
export interface LogEntry {
  correlationId: string;
  timestamp: string;
  level: 'INFO' | 'WARN' | 'ERROR';
  applicationId: string;
  httpMethod: string;
  path: string;
  sourceIp: string;
  userId?: string;
  statusCode: number;
  latencyMs: number;
  error?: {
    message: string;
    stack?: string;
    code?: string;
  };
}

/**
 * Request logger contract.
 */
export interface RequestLogger {
  logRequest(entry: LogEntry): void;
  logError(entry: LogEntry & { error: NonNullable<LogEntry['error']> }): void;
  emitMetrics(entry: LogEntry): void;
  flush(): Promise<void>;
}
