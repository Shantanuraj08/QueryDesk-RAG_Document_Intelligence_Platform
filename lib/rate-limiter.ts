import { randomUUID } from "crypto";
import { getRedisClient } from "./redis";

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfter: number;
}

/**
 * Atomic Redis Sorted Set (ZSET) sliding window Lua script.
 * KEYS[1] = rate limit key
 * ARGV[1] = current timestamp (ms)
 * ARGV[2] = window size (ms)
 * ARGV[3] = max allowed requests
 * ARGV[4] = unique request member id
 *
 * Returns: [allowed (1 | 0), remaining, retryAfterSeconds]
 */
const SLIDING_WINDOW_LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]

local windowStart = now - windowMs
redis.call('ZREMRANGEBYSCORE', key, '-inf', windowStart)

local count = redis.call('ZCARD', key)
if count >= limit then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local retryAfterMs = windowMs
  if #oldest >= 2 then
    retryAfterMs = math.max(1000, (tonumber(oldest[2]) + windowMs) - now)
  end
  return {0, 0, math.ceil(retryAfterMs / 1000)}
end

redis.call('ZADD', key, now, member)
redis.call('PEXPIRE', key, windowMs)
return {1, limit - (count + 1), 0}
`;

/**
 * Enforces an atomic sliding-window rate limit in Redis.
 * Fails open if Redis is unconfigured or unavailable so legitimate traffic is not blocked.
 */
export async function checkRateLimit(
  key: string,
  limit = 20,
  windowSeconds = 60
): Promise<RateLimitResult> {
  const redis = getRedisClient();

  if (!redis) {
    return {
      allowed: true,
      limit,
      remaining: limit,
      retryAfter: 0,
    };
  }

  const now = Date.now();
  const windowMs = windowSeconds * 1000;
  const member = `${now}:${randomUUID()}`;

  try {
    const result = await redis.eval(
      SLIDING_WINDOW_LUA,
      1,
      key,
      now,
      windowMs,
      limit,
      member
    );

    if (Array.isArray(result) && result.length >= 3) {
      const allowed = Number(result[0]) === 1;
      const remaining = Math.max(0, Number(result[1]));
      const retryAfter = Math.max(0, Number(result[2]));

      return {
        allowed,
        limit,
        remaining,
        retryAfter,
      };
    }

    return {
      allowed: true,
      limit,
      remaining: limit,
      retryAfter: 0,
    };
  } catch (error) {
    console.warn(
      "[RateLimiter] Redis evaluation failed; failing open:",
      error instanceof Error ? error.message : error
    );
    return {
      allowed: true,
      limit,
      remaining: limit,
      retryAfter: 0,
    };
  }
}

export const DAILY_CREDIT_LIMIT = 30;
export const QUESTION_CREDIT_COST = 1;
export const DOCUMENT_UPLOAD_CREDIT_COST = 3;

export interface DailyCreditResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetSeconds: number;
}

const CONSUME_CREDITS_LUA = `
local key = KEYS[1]
local cost = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local ttl = tonumber(ARGV[3])

local current = tonumber(redis.call('GET', key) or '0')
if current + cost > limit then
  return {0, math.max(0, limit - current)}
end

local updated = redis.call('INCRBY', key, cost)
if redis.call('TTL', key) < 0 then
  redis.call('EXPIRE', key, ttl)
end
return {1, math.max(0, limit - updated)}
`;

const REFUND_CREDITS_LUA = `
local key = KEYS[1]
local amount = tonumber(ARGV[1])

local raw = redis.call('GET', key)
if not raw then
  return 0
end

local current = tonumber(raw)
local updated = math.max(0, current - amount)
local ttl = redis.call('TTL', key)
if ttl > 0 then
  redis.call('SET', key, updated, 'EX', ttl)
else
  redis.call('SET', key, updated)
end
return updated
`;

function getUtcDayContext(): { keySuffix: string; resetSeconds: number } {
  const now = new Date();
  const keySuffix = now.toISOString().slice(0, 10);
  const nextMidnightMs = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1
  );
  const resetSeconds = Math.max(
    1,
    Math.ceil((nextMidnightMs - now.getTime()) / 1000)
  );
  return { keySuffix, resetSeconds };
}

/**
 * Atomically checks and deducts daily credits from the user's UTC day wallet.
 * Fails open if Redis is unavailable so legitimate traffic is not blocked.
 */
export async function consumeDailyCredits(
  userId: string,
  cost: number,
  dailyAllowance = DAILY_CREDIT_LIMIT
): Promise<DailyCreditResult> {
  const { keySuffix, resetSeconds } = getUtcDayContext();
  const redis = getRedisClient();

  if (!redis) {
    return {
      allowed: true,
      limit: dailyAllowance,
      remaining: dailyAllowance,
      resetSeconds,
    };
  }

  const key = `credits:daily:${userId}:${keySuffix}`;

  try {
    const result = await redis.eval(
      CONSUME_CREDITS_LUA,
      1,
      key,
      cost,
      dailyAllowance,
      resetSeconds
    );

    if (Array.isArray(result) && result.length >= 2) {
      return {
        allowed: Number(result[0]) === 1,
        limit: dailyAllowance,
        remaining: Math.max(0, Number(result[1])),
        resetSeconds,
      };
    }

    return {
      allowed: true,
      limit: dailyAllowance,
      remaining: dailyAllowance,
      resetSeconds,
    };
  } catch (error) {
    console.warn(
      "[Credits] Redis consume failed; failing open:",
      error instanceof Error ? error.message : error
    );
    return {
      allowed: true,
      limit: dailyAllowance,
      remaining: dailyAllowance,
      resetSeconds,
    };
  }
}

export interface DailyCreditStatus {
  used: number;
  remaining: number;
  limit: number;
}

/**
 * Reads the user's current daily credit usage from Redis without mutating it.
 */
export async function getDailyCredits(
  userId: string,
  dailyAllowance = DAILY_CREDIT_LIMIT
): Promise<DailyCreditStatus> {
  const redis = getRedisClient();

  if (!redis) {
    return {
      used: 0,
      remaining: dailyAllowance,
      limit: dailyAllowance,
    };
  }

  const { keySuffix } = getUtcDayContext();
  const key = `credits:daily:${userId}:${keySuffix}`;

  try {
    const raw = await redis.get(key);
    const used = Math.max(0, Number(raw ?? 0) || 0);
    return {
      used,
      remaining: Math.max(0, dailyAllowance - used),
      limit: dailyAllowance,
    };
  } catch (error) {
    console.warn(
      "[Credits] Redis read failed; defaulting to full allowance:",
      error instanceof Error ? error.message : error
    );
    return {
      used: 0,
      remaining: dailyAllowance,
      limit: dailyAllowance,
    };
  }
}

/**
 * Refunds daily credits back to the user's UTC day wallet without dropping below zero.
 * Returns the updated remaining credit count, or null if unavailable.
 */
export async function refundDailyCredits(
  userId: string,
  amount: number,
  dailyAllowance = DAILY_CREDIT_LIMIT
): Promise<number | null> {
  const redis = getRedisClient();
  if (!redis || amount <= 0) return null;

  const { keySuffix } = getUtcDayContext();
  const key = `credits:daily:${userId}:${keySuffix}`;

  try {
    const updatedUsed = await redis.eval(REFUND_CREDITS_LUA, 1, key, amount);
    return Math.max(0, dailyAllowance - Number(updatedUsed ?? 0));
  } catch (error) {
    console.warn(
      "[Credits] Redis refund failed:",
      error instanceof Error ? error.message : error
    );
    return null;
  }
}


