const PER_IP_LIMIT = parseInt(process.env.RATE_LIMIT_PER_IP || '100', 10);
const PER_USER_LIMIT = parseInt(process.env.RATE_LIMIT_PER_USER || '200', 10);
const PER_SOCKET_LIMIT = parseInt(process.env.RATE_LIMIT_PER_SOCKET || '60', 10);
const WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '10000', 10);

interface Bucket {
  count: number;
  resetAt: number;
}

const ipBuckets = new Map<string, Bucket>();
const userBuckets = new Map<string, Bucket>();
const socketBuckets = new Map<string, Bucket>();

function checkBucket(map: Map<string, Bucket>, key: string, limit: number): boolean {
  const now = Date.now();
  const bucket = map.get(key);
  if (!bucket || now > bucket.resetAt) {
    map.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count++;
  return true;
}

export function checkRateLimit(ip: string, uid: string, socketId: string): boolean {
  const ipOk = checkBucket(ipBuckets, ip, PER_IP_LIMIT);
  const userOk = checkBucket(userBuckets, uid, PER_USER_LIMIT);
  const socketOk = checkBucket(socketBuckets, socketId, PER_SOCKET_LIMIT);
  return ipOk && userOk && socketOk;
}

export function clearRateLimitsFor(socketId: string): void {
  for (const [k, _v] of socketBuckets) {
    if (k === socketId) socketBuckets.delete(k);
  }
}

const bucketCleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [k, v] of ipBuckets) { if (now > v.resetAt) ipBuckets.delete(k); }
  for (const [k, v] of userBuckets) { if (now > v.resetAt) userBuckets.delete(k); }
  for (const [k, v] of socketBuckets) { if (now > v.resetAt) socketBuckets.delete(k); }
}, 60000);

export function stopRateLimiter(): void {
  clearInterval(bucketCleanupTimer);
}
