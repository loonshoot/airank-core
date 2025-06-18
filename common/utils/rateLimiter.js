/**
 * Rate Limiter implementation for controlling API request rates
 * 
 * This provides a token bucket rate limiting algorithm to prevent
 * exceeding API rate limits for external services.
 */

class RateLimiter {
  constructor() {
    // Store tokens by key (typically destinationId:objectType)
    this.tokenBuckets = new Map();
  }

  /**
   * Try to acquire a token for the operation
   * 
   * @param {string} key - Unique identifier for the rate limit bucket
   * @param {object} limits - Rate limiting configuration
   * @param {number} limits.requestsPerInterval - Maximum number of requests per interval
   * @param {number} limits.intervalMs - Interval in milliseconds
   * @returns {boolean} - Whether the operation can proceed
   */
  async acquireToken(key, limits) {
    const { requestsPerInterval, intervalMs } = limits;
    
    // Initialize the bucket if it doesn't exist
    if (!this.tokenBuckets.has(key)) {
      this.tokenBuckets.set(key, {
        tokens: requestsPerInterval,
        lastRefill: Date.now(),
        requestsPerInterval,
        intervalMs
      });
      return true;
    }
    
    const bucket = this.tokenBuckets.get(key);
    
    // Update bucket configuration if limits have changed
    if (bucket.requestsPerInterval !== requestsPerInterval || 
        bucket.intervalMs !== intervalMs) {
      bucket.requestsPerInterval = requestsPerInterval;
      bucket.intervalMs = intervalMs;
    }
    
    // Refill tokens based on time elapsed
    const now = Date.now();
    const timePassed = now - bucket.lastRefill;
    const tokensToAdd = Math.floor(timePassed / intervalMs) * requestsPerInterval;
    
    if (tokensToAdd > 0) {
      bucket.tokens = Math.min(bucket.tokens + tokensToAdd, requestsPerInterval);
      bucket.lastRefill = now - (timePassed % intervalMs);
    }
    
    // Check if tokens are available
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return true;
    }
    
    return false;
  }
  
  /**
   * Reset the rate limiter for a specific key
   * 
   * @param {string} key - Key to reset
   */
  reset(key) {
    if (this.tokenBuckets.has(key)) {
      const bucket = this.tokenBuckets.get(key);
      bucket.tokens = bucket.requestsPerInterval;
      bucket.lastRefill = Date.now();
    }
  }
  
  /**
   * Reset all rate limiters
   */
  resetAll() {
    this.tokenBuckets.clear();
  }
}

module.exports = { RateLimiter }; 