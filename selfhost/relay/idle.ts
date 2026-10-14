/**
 * Stops the relay once nobody has been connected for `ms`: no GM, no player, no newcomer. In the
 * container that ends the campaign: the tunnel goes with the relay, and Docker removes the container.
 */
export class IdleStop {
  private readonly ms: number | null;
  private readonly onIdle: () => void;
  private timer: NodeJS.Timeout | undefined;

  /** `ms` null: the relay never stops on its own (development). */
  constructor(ms: number | null, onIdle: () => void) {
    this.ms = ms;
    this.onIdle = onIdle;
  }

  /** Called with the number of open sockets whenever it changes, and once at start. */
  update(openSockets: number): void {
    if (this.ms === null) return;
    if (openSockets > 0) {
      clearTimeout(this.timer);
      this.timer = undefined;
      return;
    }
    if (this.timer !== undefined) return;
    this.timer = setTimeout(this.onIdle, this.ms);
  }

  stop(): void {
    clearTimeout(this.timer);
  }
}
