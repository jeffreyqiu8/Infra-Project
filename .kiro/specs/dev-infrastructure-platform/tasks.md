# Implementation Plan: Dev Infrastructure Platform

## Overview

This plan implements a modular, serverless backend platform on AWS using CDK (TypeScript). The implementation follows an incremental approach: project scaffolding and shared types first, then each middleware layer in pipeline order (Auth → Rate Limiter → Cache → Router), followed by the job processing system, logging, multi-app support, error handling, optional WebSocket support, and finally CDK infrastructure wiring. Each component is tested close to its implementation to catch errors early.

## Tasks

- [x] 1. Set up project structure, shared types, and tooling
  - [x] 1.1 Initialize the CDK TypeScript project and configure tooling
    - Initialize a CDK TypeScript app with `cdk init app --language typescript`
    - Configure `tsconfig.json` with strict mode
    - Install dependencies: `aws-sdk`, `aws-lambda`, `uuid`, `jsonwebtoken`, `ioredis`
    - Install dev dependencies: `vitest`, `fast-check`, `@types/aws-lambda`, `@types/node`, `esbuild`
    - Configure `vitest` in `vitest.config.ts` with separate test paths for unit, property, and integration tests
    - Create directory structure: `src/`, `src/handlers/`, `src/middleware/`, `src/services/`, `src/models/`, `src/utils/`, `tests/unit/`, `tests/property/`, `tests/integration/`
    - _Requirements: All_

  - [x] 1.2 Define shared interfaces, types, and error codes
    - Create `src/models/interfaces.ts` with `GatewayEvent`, `GatewayResponse`, `RouteDefinition`, `RouteHandler`, `RequestContext`
    - Create `src/models/auth.ts` with `AuthResult`, `AuthMiddleware` interface
    - Create `src/models/rate-limit.ts` with `RateLimitConfig`, `RateLimitResult`, `RateLimiter` interface, `RateLimitItem`
    - Create `src/models/cache.ts` with `CachedResponse`, `CacheLayer` interface, `CacheItem`
    - Create `src/models/job.ts` with `JobSubmission`, `JobRecord`, `JobItem`, `JobProducer` interface, `JobWorker` interface, `JobTypeHandler`, `JobExecutionContext`
    - Create `src/models/logger.ts` with `LogEntry`, `RequestLogger` interface
    - Create `src/models/websocket.ts` with `WebSocketHandler` interface
    - Create `src/models/errors.ts` with error code enum (`VALIDATION_ERROR`, `UNAUTHORIZED`, `NOT_FOUND`, `RATE_LIMIT_EXCEEDED`, `SERVICE_UNAVAILABLE`, `INTERNAL_ERROR`) and a structured `ApiError` class that produces the standard error response JSON format
    - Create `src/models/dynamo.ts` with DynamoDB key pattern helpers and entity type constants
    - _Requirements: 1.1–1.5, 2.1–2.6, 3.1–3.8, 4.1–4.9, 5.1–5.9, 6.1–6.7, 8.1–8.5_

- [ ] 2. Implement Gateway Lambda with request pipeline
  - [ ] 2.1 Implement request schema validation
    - Create `src/middleware/schema-validator.ts`
    - Validate incoming `GatewayEvent` against a JSON schema (required fields: `httpMethod`, `path`, `headers`)
    - Return descriptive 400 errors identifying the specific validation failure
    - _Requirements: 1.2, 1.3_

  - [ ]* 2.2 Write property test for schema validation (Property 1)
    - **Property 1: Schema Validation Correctness**
    - Generate random objects with valid/invalid field combinations using fast-check
    - Verify: conforming requests are accepted, non-conforming requests produce 400 with descriptive error
    - **Validates: Requirements 1.2, 1.3**

  - [ ] 2.3 Implement route matching and dispatcher
    - Create `src/middleware/router.ts`
    - Implement route registration and matching by HTTP method and path (including path parameters like `/jobs/{id}`)
    - Return 404 for unmatched routes
    - _Requirements: 1.4, 1.5_

  - [ ]* 2.4 Write property test for route matching (Property 2)
    - **Property 2: Route Matching Correctness**
    - Generate random path/method pairs from a route table plus random non-matching paths
    - Verify: matching routes dispatch to the correct handler, non-matching routes produce 404
    - **Validates: Requirements 1.4, 1.5**

  - [ ] 2.5 Implement the Gateway Lambda handler with middleware pipeline orchestration
    - Create `src/handlers/gateway.ts`
    - Orchestrate the full pipeline: assign correlation ID → schema validation → auth → rate limit → cache check → route → cache store → response
    - Wire middleware components together with early-exit on auth/rate-limit/validation failures
    - Include `X-Cache` header passthrough from cache layer
    - _Requirements: 1.1, 1.2, 1.4, 6.6_

  - [ ]* 2.6 Write unit tests for Gateway Lambda
    - Test full pipeline execution with mocked middleware
    - Test early exit on validation failure (400), auth failure (401), rate limit failure (429)
    - Test correlation ID assignment and propagation
    - Test 404 for unknown routes
    - _Requirements: 1.1–1.5, 6.6_

- [ ] 3. Checkpoint
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 4. Implement Auth Middleware
  - [ ] 4.1 Implement API key authentication
    - Create `src/middleware/auth.ts` implementing the `AuthMiddleware` interface
    - Look up API key by SHA-256 hash in DynamoDB (`APIKEY#{keyHash}` / `META`)
    - On valid key: return `AuthResult` with `userId`, `applicationId`, `authMethod: 'api-key'`
    - On missing/invalid key: return unauthenticated result with error message
    - Check `x-api-key` header first before JWT
    - _Requirements: 2.1, 2.2, 2.3, 2.5, 2.6_

  - [ ] 4.2 Implement JWT authentication
    - Add JWT verification to `src/middleware/auth.ts`
    - Verify token signature using cached JWKS public key set
    - Validate token expiration
    - Extract and attach decoded claims to `AuthResult`
    - Check `Authorization: Bearer <token>` header
    - _Requirements: 2.2, 2.4, 2.5, 2.6_

  - [ ]* 4.3 Write property test for authentication correctness (Property 3)
    - **Property 3: Authentication Correctness**
    - Generate random API keys (valid/invalid), JWTs (valid/invalid/expired), and no-auth requests
    - Verify: valid credentials produce authenticated result with correct identity; invalid/expired/missing credentials produce unauthenticated result with error
    - **Validates: Requirements 2.3, 2.4, 2.5, 2.6**

  - [ ]* 4.4 Write unit tests for Auth Middleware
    - Test API key lookup with mocked DynamoDB
    - Test JWT verification with mocked JWKS
    - Test auth method priority (API key checked before JWT)
    - Test expired JWT rejection
    - Test missing credentials (no `x-api-key` and no `Authorization` header)
    - _Requirements: 2.1–2.7_

- [ ] 5. Implement Rate Limiter
  - [ ] 5.1 Implement token bucket algorithm with DynamoDB
    - Create `src/middleware/rate-limiter.ts` implementing the `RateLimiter` interface
    - Implement lazy token refill: `tokensToAdd = floor((elapsed / windowSize) * refillRate)` capped at burst limit
    - Use DynamoDB conditional writes (`ConditionExpression: tokens > 0`) for atomic token decrement
    - Retry once on conditional write failure (race condition)
    - Compute `Retry-After` header value when tokens are 0
    - Support per-user (`RATELIMIT#USER#{userId}`), per-IP (`RATELIMIT#IP#{ip}`), and per-endpoint rate limit keys
    - _Requirements: 3.1, 3.4, 3.5, 3.6, 3.7, 3.8_

  - [ ] 5.2 Implement most-restrictive-limit evaluation
    - In `checkAndConsume`, evaluate both per-user and per-IP limits
    - Apply the result from whichever limit has fewer remaining tokens
    - Reject if either limit is exceeded
    - Support per-endpoint rate limit overrides via `RouteDefinition.rateLimitOverride`
    - _Requirements: 3.2, 3.3, 3.8_

  - [ ]* 5.3 Write property test for token bucket invariant (Property 4)
    - **Property 4: Token Bucket Invariant**
    - Generate random bucket states, time deltas, and refill configs
    - Verify: (a) lazy refill adds exactly `floor((elapsed / windowSize) * refillRate)` tokens capped at burst limit, (b) allowing a request decrements by exactly 1, (c) when tokens are 0, Retry-After equals time until next replenishment
    - **Validates: Requirements 3.4, 3.5, 3.6**

  - [ ]* 5.4 Write property test for most restrictive rate limit (Property 5)
    - **Property 5: Most Restrictive Rate Limit Applied**
    - Generate random user/IP token counts
    - Verify: the result uses whichever limit has fewer remaining tokens; request is rejected if either limit is exceeded
    - **Validates: Requirements 3.3**

  - [ ]* 5.5 Write unit tests for Rate Limiter
    - Test token decrement with mocked DynamoDB conditional writes
    - Test refill calculation with specific time deltas
    - Test concurrent request handling (conditional write failure and retry)
    - Test per-endpoint override application
    - Test 429 response with correct Retry-After header
    - _Requirements: 3.1–3.8_

- [ ] 6. Checkpoint
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 7. Implement Cache Layer
  - [ ] 7.1 Implement Redis-primary cache with DynamoDB fallback
    - Create `src/services/cache-layer.ts` implementing the `CacheLayer` interface
    - Implement `get`: check Redis first, fall back to DynamoDB on Redis connection failure
    - Implement `set`: write to Redis with TTL, write to DynamoDB with TTL as fallback
    - Implement `invalidate`: remove from both Redis and DynamoDB
    - Implement `invalidatePattern`: use Redis `SCAN` with `MATCH` for primary, DynamoDB GSI query on key prefix for fallback
    - Namespace cache keys by application ID: `{applicationId}:{endpoint}:{queryHash}`
    - Implement circuit breaker for Redis: open after 5 consecutive failures within 60s, half-open after 30s
    - _Requirements: 4.1–4.8, 7.3_

  - [ ] 7.2 Implement cache response serialization/deserialization
    - Serialize `CachedResponse` (status code, headers, body) to JSON for storage
    - Deserialize back to `CachedResponse` preserving all fields
    - Set `X-Cache: HIT` or `X-Cache: MISS` header on responses
    - _Requirements: 4.2, 4.3, 4.9_

  - [ ]* 7.3 Write property test for cache serialization round-trip (Property 6)
    - **Property 6: Cache Response Serialization Round-Trip**
    - Generate random `CachedResponse` objects with varying status codes, headers, and bodies
    - Verify: serialize then deserialize produces an object equal to the original
    - **Validates: Requirements 4.9**

  - [ ]* 7.4 Write property test for cache key namespace isolation (Property 7)
    - **Property 7: Cache Key Namespace Isolation**
    - Generate random pairs of distinct application IDs and identical endpoint paths
    - Verify: generated cache keys are always distinct across different application IDs
    - **Validates: Requirements 7.3**

  - [ ]* 7.5 Write unit tests for Cache Layer
    - Test Redis cache hit returns response with `X-Cache: HIT`
    - Test cache miss invokes backend and stores with `X-Cache: MISS`
    - Test Redis failure triggers DynamoDB fallback transparently
    - Test circuit breaker opens after 5 consecutive Redis failures
    - Test circuit breaker half-open after 30s recovery window
    - Test key and pattern invalidation across both stores
    - Test TTL-based expiration
    - _Requirements: 4.1–4.9, 7.3_

- [ ] 8. Checkpoint
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 9. Implement Job Producer and Job Worker
  - [ ] 9.1 Implement Job Producer
    - Create `src/services/job-producer.ts` implementing the `JobProducer` interface
    - Validate job payload
    - Check idempotency key via DynamoDB GSI query on `(applicationId, idempotencyKey)` — return existing job ID if found
    - Generate unique job ID, create job record in DynamoDB with state `queued`
    - Send message to SQS queue
    - Return job ID with HTTP 202
    - Tag job with originating application ID
    - Retry SQS send up to 3 times with exponential backoff on failure, return 503 after exhaustion
    - _Requirements: 5.1, 5.2, 5.7, 7.4, 8.4_

  - [ ] 9.2 Implement Job Worker with state machine
    - Create `src/handlers/job-worker.ts` implementing the `JobWorker` interface
    - Process SQS messages: parse job ID, update state to `processing`
    - Look up job type handler from registry, execute with `JobExecutionContext`
    - On success: update state to `completed`, store result in DynamoDB
    - On failure: update state to `failed`, record error details (message, code, retryCount)
    - Enforce valid state transitions: `queued → processing`, `processing → completed`, `processing → failed`, `failed → processing` (retry)
    - Include application ID in all job state records
    - _Requirements: 5.3, 5.4, 5.5, 5.6, 7.4_

  - [ ] 9.3 Implement job status retrieval endpoint
    - Create route handler for `GET /jobs/{id}`
    - Return current job state, creation timestamp, result (if completed), or error details (if failed)
    - _Requirements: 5.8_

  - [ ]* 9.4 Write property test for job payload round-trip (Property 8)
    - **Property 8: Job Payload Round-Trip**
    - Generate random valid job payloads with nested structures
    - Verify: submitting a job then retrieving by ID returns a response containing all original payload fields with original values
    - **Validates: Requirements 5.9, 5.1, 5.8**

  - [ ]* 9.5 Write property test for job state transition validity (Property 9)
    - **Property 9: Job State Transition Validity**
    - Generate random sequences of state transition attempts
    - Verify: only `queued → processing`, `processing → completed`, `processing → failed`, `failed → processing` are accepted; all others are rejected
    - **Validates: Requirements 5.3**

  - [ ]* 9.6 Write property test for idempotency key deduplication (Property 10)
    - **Property 10: Idempotency Key Deduplication**
    - Generate random idempotency keys and submission sequences
    - Verify: duplicate submissions with the same app ID and idempotency key return the existing job ID without creating a new record
    - **Validates: Requirements 5.7**

  - [ ]* 9.7 Write unit tests for Job Producer and Job Worker
    - Test job creation with mocked DynamoDB and SQS
    - Test idempotency key lookup returns existing job
    - Test SQS retry on send failure (3 retries then 503)
    - Test state transitions: queued → processing → completed
    - Test state transitions: queued → processing → failed
    - Test invalid state transition rejection
    - Test job status retrieval for completed and failed jobs
    - Test DLQ routing after max retries exceeded
    - _Requirements: 5.1–5.9, 8.4_

- [ ] 10. Checkpoint
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 11. Implement Request Logger
  - [ ] 11.1 Implement structured logging and metrics emission
    - Create `src/services/request-logger.ts` implementing the `RequestLogger` interface
    - Implement `logRequest`: write structured JSON to CloudWatch Logs with all required fields (HTTP method, path, source IP, user identity, status code, latency, application ID, correlation ID)
    - Implement `logError`: include severity level, stack trace, request context, and correlation ID
    - Implement `emitMetrics`: use CloudWatch Embedded Metric Format (EMF) for request latency (p50, p95, p99), error rate, and throughput per endpoint
    - Implement `flush`: flush buffered entries
    - On CloudWatch write failure: buffer entries in-memory and retry with exponential backoff (max 3 retries)
    - _Requirements: 6.1, 6.2, 6.4, 6.5, 6.6, 6.7, 7.5_

  - [ ] 11.2 Configure S3 log archival pipeline
    - Create CloudWatch Logs subscription filter configuration for streaming to Kinesis Firehose
    - Configure Firehose delivery to S3 with date-partitioned structure: `logs/{year}/{month}/{day}/{hour}/`
    - This will be wired in CDK infrastructure (task 14)
    - _Requirements: 6.3_

  - [ ]* 11.3 Write property test for log entry completeness (Property 11)
    - **Property 11: Log Entry Completeness**
    - Generate random request metadata (HTTP method, path, source IP, user identity, status code, latency, application ID) and optional error details
    - Verify: produced JSON log entry contains all provided fields; when error details are present, entry additionally contains severity level, stack trace, and correlation ID
    - **Validates: Requirements 6.1, 6.2, 6.4, 7.5**

  - [ ]* 11.4 Write unit tests for Request Logger
    - Test structured JSON output contains all required fields
    - Test error logging includes severity, stack trace, correlation ID
    - Test CloudWatch write failure triggers buffering and retry
    - Test EMF metric emission format
    - Test correlation ID propagation through log entries
    - _Requirements: 6.1–6.7, 7.5_

- [ ] 12. Implement error handling and resilience
  - [ ] 12.1 Implement retry utility with exponential backoff
    - Create `src/utils/retry.ts`
    - Implement generic retry function: configurable max retries, base delay, exponential backoff (`delay = baseMs * 2^attempt`)
    - Classify errors: transient (5xx, network timeout) → retry; non-transient (4xx) → do not retry
    - Return 503 with `Retry-After` header after all retries exhausted
    - _Requirements: 8.1, 8.2_

  - [ ]* 12.2 Write property test for retry decision and backoff calculation (Property 12)
    - **Property 12: Retry Decision and Backoff Calculation**
    - Generate random error types (5xx, 4xx, network timeout) and attempt numbers
    - Verify: transient errors trigger retry, non-transient errors do not; backoff delay equals `100ms * 2^n` for attempt `n`
    - **Validates: Requirements 8.1, 8.2**

  - [ ] 12.3 Wire retry logic into Gateway Lambda and Job Producer
    - Integrate retry utility into downstream service calls in the Gateway Lambda
    - Integrate retry utility into SQS send in Job Producer (already partially done in 9.1, wire the shared utility)
    - Configure SQS visibility timeout to at least 6x average Job Worker processing time
    - _Requirements: 8.1, 8.2, 8.4, 8.5_

  - [ ]* 12.4 Write unit tests for error handling and resilience
    - Test retry on transient 5xx errors with correct backoff delays
    - Test no retry on 4xx errors
    - Test 503 response after retry exhaustion with Retry-After header
    - Test SQS visibility timeout configuration
    - _Requirements: 8.1–8.5_

- [ ] 13. Checkpoint
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 14. Implement multi-application support wiring
  - [ ] 14.1 Wire tenant isolation across all components
    - Ensure Auth Middleware associates each API key / JWT issuer with an application identifier (already in auth result from 4.1/4.2)
    - Ensure Rate Limiter enforces limits independently per application (include `applicationId` in rate limit key)
    - Ensure Cache Layer namespaces entries by application ID (already in cache key from 7.1)
    - Ensure Job Producer/Worker tags jobs with application ID (already in job record from 9.1/9.2)
    - Ensure Request Logger includes application ID in every log entry (already in log entry from 11.1)
    - Create `src/utils/tenant.ts` with helper functions for extracting and validating application context
    - _Requirements: 7.1–7.5_

  - [ ]* 14.2 Write unit tests for multi-application isolation
    - Test per-application rate limit independence (separate buckets)
    - Test cache namespace isolation (no cross-app cache collisions)
    - Test job records include application ID
    - Test log entries include application ID
    - _Requirements: 7.1–7.5_

- [ ] 15. Implement WebSocket handler (optional)
  - [ ] 15.1 Implement WebSocket connection management
    - Create `src/handlers/websocket.ts` implementing the `WebSocketHandler` interface
    - Implement `onConnect`: store connection ID in DynamoDB (`WSCONN#{connectionId}` / `META`) with TTL matching idle timeout, associate with job ID via GSI (`WSJOB#{jobId}`)
    - Implement `onDisconnect`: remove connection record from DynamoDB
    - Implement `notifyJobUpdate`: query connections for a job ID via GSI, post state update to each connection via API Gateway Management API, clean up stale connections on post failure
    - _Requirements: 9.1, 9.2_

  - [ ] 15.2 Wire WebSocket notifications into Job Worker
    - After each job state transition in the Job Worker, call `notifyJobUpdate` with the new state
    - Handle notification failures gracefully (non-blocking, clean up stale connections)
    - _Requirements: 9.2_

  - [ ]* 15.3 Write unit tests for WebSocket handler
    - Test connection storage and retrieval
    - Test disconnect cleanup
    - Test notification delivery to connected clients
    - Test stale connection cleanup on post failure
    - _Requirements: 9.1–9.3_

- [ ] 16. Implement CDK infrastructure stack
  - [ ] 16.1 Define DynamoDB table and GSIs
    - Create `lib/platform-stack.ts` (or extend existing CDK stack)
    - Define `PlatformTable` with PK/SK, GSI1 (GSI1PK/GSI1SK), TTL enabled
    - Use on-demand capacity mode
    - _Requirements: 3.4, 3.7, 8.3_

  - [ ] 16.2 Define SQS queues
    - Create main job queue (SQS Standard)
    - Create dead-letter queue with `maxReceiveCount` redrive policy
    - Configure visibility timeout to at least 6x average worker processing time
    - _Requirements: 5.2, 5.6, 8.5_

  - [ ] 16.3 Define Lambda functions and API Gateway
    - Define Gateway Lambda with API Gateway REST proxy integration
    - Define Job Worker Lambda with SQS event source mapping
    - Define WebSocket Lambda (optional) with WebSocket API Gateway routes (`$connect`, `$disconnect`, `$default`)
    - Configure Lambda environment variables for table names, queue URLs, Redis endpoint
    - _Requirements: 1.1, 5.2, 9.1_

  - [ ] 16.4 Define ElastiCache Redis and VPC configuration
    - Define ElastiCache Serverless Redis cluster
    - Configure VPC, subnets, and security groups for Lambda-to-Redis connectivity
    - _Requirements: 4.4_

  - [ ] 16.5 Define CloudWatch Logs, Firehose, and S3 archival pipeline
    - Create S3 bucket for log archival
    - Create Kinesis Firehose delivery stream with S3 destination (date-partitioned prefix)
    - Create CloudWatch Logs subscription filter to stream to Firehose
    - _Requirements: 6.2, 6.3_

  - [ ] 16.6 Define IAM roles and permissions
    - Gateway Lambda: DynamoDB read/write, SQS send, ElastiCache access, CloudWatch Logs/Metrics
    - Job Worker Lambda: DynamoDB read/write, SQS receive/delete, WebSocket API Management (optional), CloudWatch Logs/Metrics
    - WebSocket Lambda: DynamoDB read/write, CloudWatch Logs
    - Firehose: S3 write, CloudWatch Logs read
    - _Requirements: All (security baseline)_

- [ ] 17. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.
  - Verify CDK synthesizes without errors (`cdk synth`)

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation after each major component
- Property tests validate the 12 universal correctness properties from the design document
- Unit tests validate specific examples, edge cases, and error conditions
- The implementation language is TypeScript throughout (Lambda handlers, CDK, tests)
- fast-check is used for property-based testing with minimum 100 iterations per property
