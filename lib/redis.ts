import Redis from "ioredis";

const globalForRedis = globalThis as unknown as {
  redis: Redis | undefined;
};

function createRedisClient(): Redis | null {
  const redisUrl = process.env.REDIS_URL?.trim();

  if (!redisUrl) {
    return null;
  }

  const client = new Redis(redisUrl, {
    maxRetriesPerRequest: 1,
    connectTimeout: 3000,
    commandTimeout: 2000,
    retryStrategy(times) {
      // Back off quickly and cap retry delay to avoid blocking/log flooding
      if (times > 3) return null;
      return Math.min(times * 200, 1000);
    },
    ...(redisUrl.startsWith("rediss://") ? { tls: {} } : {}),
  });

  client.on("error", (err) => {
    console.error("[Redis] Connection error:", err.message);
  });

  return client;
}

/**
 * Returns a shared singleton Redis client if REDIS_URL is configured.
 */
export function getRedisClient(): Redis | null {
  if (globalForRedis.redis) {
    return globalForRedis.redis;
  }

  const client = createRedisClient();
  if (client) {
    globalForRedis.redis = client;
  }

  return client;
}

