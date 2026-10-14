/**
 * A token bucket: `burst` frames at once, then `perSecond`. A player's page sends moves, drags and
 * cursor positions; the plugin paces its own sends, so the limit only stops a page that floods.
 */
export class RateLimit {
  private tokens: number;
  private last: number;
  private readonly perSecond: number;
  private readonly burst: number;
  private readonly now: () => number;

  constructor(perSecond: number, burst: number, now: () => number = Date.now) {
    this.perSecond = perSecond;
    this.burst = burst;
    this.tokens = burst;
    this.now = now;
    this.last = now();
  }

  take(): boolean {
    const now = this.now();
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.perSecond);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}
