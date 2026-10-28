/** Per-socket token buckets. Messages over budget are dropped. */
export class TokenBucket {
  private tokens: number;
  private last = Date.now();
  constructor(
    private readonly ratePerSec: number,
    private readonly burst: number,
  ) {
    this.tokens = burst;
  }
  take(n = 1): boolean {
    const now = Date.now();
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.ratePerSec);
    this.last = now;
    if (this.tokens < n) return false;
    this.tokens -= n;
    return true;
  }
}

export interface Limits {
  move: TokenBucket;
  act: TokenBucket;
  lobby: TokenBucket;
  car: TokenBucket;
  /** Count of dropped messages, used to disconnect abusive clients. */
  violations: number;
}

export function makeLimits(): Limits {
  return {
    move: new TokenBucket(45, 70),
    act: new TokenBucket(10, 20),
    lobby: new TokenBucket(4, 10),
    car: new TokenBucket(40, 60),
    violations: 0,
  };
}
