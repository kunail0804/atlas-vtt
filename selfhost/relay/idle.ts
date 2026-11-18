/**
 * Stops the relay once nobody has been connected for a while: no GM, no player, no newcomer. In the
 * container that ends the campaign: the tunnel goes with the relay, and Docker removes the container.
 *
 * Until someone connects for the first time the relay waits `firstMs`: a GM who starts a campaign
 * and then prepares the table in Obsidian (trust dialog, dashboard, scene, sign-in) connects only once
 * the table starts, which takes longer than the `ms` the relay waits after everyone left.
 */
export class IdleStop {
  private readonly ms: number | null;
  private readonly firstMs: number | null;
  private readonly onIdle: () => void;
  private timer: NodeJS.Timeout | undefined;
  /** When the pending stop fires, in `Date.now()` time. */
  private due = 0;
  private open = 0;
  private everConnected = false;

  /** `ms` null: the relay never stops on its own (development). `firstMs` defaults to `ms`. */
  constructor(ms: number | null, onIdle: () => void, firstMs: number | null = ms) {
    this.ms = ms;
    this.firstMs = ms === null ? null : firstMs ?? ms;
    this.onIdle = onIdle;
  }

  /** Called with the number of open sockets whenever it changes, and once at start. */
  update(openSockets: number): void {
    this.open = openSockets;
    if (this.ms === null) return;
    if (openSockets > 0) {
      this.everConnected = true;
      this.cancel();
      return;
    }
    if (this.timer !== undefined) return;
    this.arm(this.everConnected ? this.ms : this.firstMs ?? this.ms);
  }

  /**
   * Something reached the GM side without a socket (Obsidian checking the account, uploading what
   * players are shown): with nobody connected, the relay waits at least `ms` from now.
   */
  touch(): void {
    if (this.ms === null || this.open > 0 || this.timer === undefined) return;
    if (this.due - Date.now() >= this.ms) return;
    this.cancel();
    this.arm(this.ms);
  }

  stop(): void {
    this.cancel();
  }

  private arm(ms: number): void {
    this.due = Date.now() + ms;
    this.timer = setTimeout(this.onIdle, ms);
  }

  private cancel(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
  }
}
