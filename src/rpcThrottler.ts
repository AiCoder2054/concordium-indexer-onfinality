import { GrpcTransport } from '@protobuf-ts/grpc-transport';
import {
  Deferred,
  RpcError,
  UnaryCall,
  type FinishedUnaryCall,
  type RpcInterceptor,
  type RpcMetadata,
  type RpcStatus,
} from '@protobuf-ts/runtime-rpc';

const logger = {
  warn: (...args: unknown[]) => console.warn('[concordium-rpc]', ...args),
  error: (...args: unknown[]) => console.error('[concordium-rpc]', ...args),
};

const DEFAULT_MAX_CONCURRENCY = 4;
const DEFAULT_MAX_RETRIES = 5;
const DEFAULT_INITIAL_DELAY_MS = 800;
const DEFAULT_MAX_DELAY_MS = 10_000;
const DEFAULT_JITTER_MS = 250;
const BACKOFF_MULTIPLIER = 2;

const MAX_CONCURRENCY = Number(
  process.env.CONCORDIUM_RPC_MAX_CONCURRENT_REQUESTS ?? DEFAULT_MAX_CONCURRENCY,
);
const MAX_RETRIES = Number(
  process.env.CONCORDIUM_RPC_MAX_RETRIES ?? DEFAULT_MAX_RETRIES,
);
const INITIAL_DELAY_MS = Number(
  process.env.CONCORDIUM_RPC_RETRY_BASE_DELAY_MS ?? DEFAULT_INITIAL_DELAY_MS,
);
const MAX_DELAY_MS = Number(
  process.env.CONCORDIUM_RPC_RETRY_MAX_DELAY_MS ?? DEFAULT_MAX_DELAY_MS,
);
const JITTER_MS = Number(
  process.env.CONCORDIUM_RPC_RETRY_JITTER_MS ?? DEFAULT_JITTER_MS,
);

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class ConcurrencyLimiter {
  private readonly queue: Array<() => void> = [];
  private active = 0;

  constructor(private readonly limit: number) {}

  acquire(): Promise<void> {
    if (this.limit <= 0) return Promise.resolve();
    if (this.active < this.limit) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.queue.push(() => {
        this.active += 1;
        resolve();
      });
    });
  }

  release(): void {
    if (this.limit <= 0) return;
    this.active = Math.max(0, this.active - 1);
    const next = this.queue.shift();
    if (next) next();
  }
}

const limiter = new ConcurrencyLimiter(Number.isFinite(MAX_CONCURRENCY) ? MAX_CONCURRENCY : DEFAULT_MAX_CONCURRENCY);

function isRetryableError(error: unknown): boolean {
  if (!error) return false;
  if (error instanceof RpcError) {
    const metadata = (error as any)?.metadata;
    const code = String(error.code ?? '').toUpperCase();
    if (code === 'RESOURCE_EXHAUSTED' || code === 'UNAVAILABLE') {
      return true;
    }
    if (typeof error.message === 'string' && /429|too many requests/i.test(error.message)) {
      return true;
    }
    const retryAfter =
      metadata?.get?.('retry-after') ??
      metadata?.get?.('Retry-After');
    if (retryAfter && retryAfter.length > 0) {
      return true;
    }
  } else if (error instanceof Error) {
    if (/429|too many requests/i.test(error.message)) {
      return true;
    }
  }
  return false;
}

function extractRetryAfterMs(error: unknown): number | undefined {
  if (!(error instanceof RpcError)) return undefined;
  const metadata = (error as any)?.metadata;
  const values =
    metadata?.get?.('retry-after') ??
    metadata?.get?.('Retry-After');
  if (!values || values.length === 0) return undefined;
  const raw = values[0];
  if (typeof raw === 'string') {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) {
      return parsed >= 1 ? parsed * 1000 : parsed;
    }
  } else if (typeof raw === 'number') {
    return raw >= 1 ? raw * 1000 : raw;
  }
  return undefined;
}

async function runWithRetries(
  method: { service: { typeName?: string }; name?: string },
  execute: () => UnaryCall<any, any>,
): Promise<FinishedUnaryCall<any, any>> {
  let attempt = 0;
  let delayMs = Number.isFinite(INITIAL_DELAY_MS) ? INITIAL_DELAY_MS : DEFAULT_INITIAL_DELAY_MS;
  const maxDelay = Number.isFinite(MAX_DELAY_MS) ? MAX_DELAY_MS : DEFAULT_MAX_DELAY_MS;
  const maxRetries = Number.isFinite(MAX_RETRIES) ? MAX_RETRIES : DEFAULT_MAX_RETRIES;

  while (true) {
    attempt += 1;
    const call = execute();
    try {
      const finished = (await call) as FinishedUnaryCall<any, any>;
      if (attempt > 1) {
        logger.warn(
          `Concordium RPC ${method.service.typeName ?? 'unknown'}/${method.name ?? 'unknown'} succeeded after ${attempt} attempts`,
        );
      }
      return finished;
    } catch (err) {
      if (!isRetryableError(err) || attempt >= maxRetries) {
        throw err;
      }

      const retryAfter = extractRetryAfterMs(err);
      const jitter =
        JITTER_MS > 0 && Number.isFinite(JITTER_MS)
          ? Math.floor(Math.random() * JITTER_MS)
          : 0;
      const waitMs = Math.min(
        retryAfter ?? delayMs + jitter,
        maxDelay,
      );

      logger.warn(
        `Concordium RPC ${method.service.typeName ?? 'unknown'}/${method.name ?? 'unknown'} hit rate limit (attempt ${attempt}). Retrying in ${waitMs}ms`,
      );

      await delay(waitMs);
      delayMs = Math.min(delayMs * BACKOFF_MULTIPLIER, maxDelay);
    }
  }
}

const unaryInterceptor: RpcInterceptor & { __concordiumRetry?: true } = {
  __concordiumRetry: true,
  interceptUnary(next, method, input, options) {
    const headers = new Deferred<RpcMetadata>(true);
    const response = new Deferred<any>(true);
    const status = new Deferred<RpcStatus>(true);
    const trailers = new Deferred<RpcMetadata>(true);

    let settled = false;
    const settleSuccess = (finished: FinishedUnaryCall<any, any>) => {
      if (settled) return;
      settled = true;
      headers.resolve(finished.headers);
      response.resolve(finished.response);
      status.resolve(finished.status);
      trailers.resolve(finished.trailers);
    };
    const settleFailure = (error: unknown) => {
      if (settled) return;
      settled = true;
      headers.reject(error as any);
      response.reject(error as any);
      status.reject(error as any);
      trailers.reject(error as any);
    };

    (async () => {
      await limiter.acquire();
      try {
        const finished = await runWithRetries(method, () => next(method, input, options));
        settleSuccess(finished);
      } catch (err) {
        settleFailure(err);
      } finally {
        limiter.release();
      }
    })().catch((err) => {
      logger.error('Unexpected Concordium RPC retry failure', err);
    });

    return new UnaryCall<any, any>(
      method as any,
      (options?.meta ?? {}) as RpcMetadata,
      input as any,
      headers.promise,
      response.promise,
      status.promise,
      trailers.promise,
    );
  },
};

const originalMergeOptions = GrpcTransport.prototype.mergeOptions;

GrpcTransport.prototype.mergeOptions = function mergeOptionsWithRetry(
  options,
) {
  const merged = originalMergeOptions.call(this, options) ?? {};
  const current = Array.isArray(merged.interceptors)
    ? merged.interceptors
    : merged.interceptors
    ? [merged.interceptors as RpcInterceptor]
    : [];

  if (!current.some((interceptor: RpcInterceptor) => (interceptor as typeof unaryInterceptor).__concordiumRetry)) {
    merged.interceptors = [...current, unaryInterceptor];
  }

  return merged;
};
