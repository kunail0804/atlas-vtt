/** How long a notice stays, in milliseconds. */
const NOTICE_MS = 4_000;

/** A short message at the bottom of the screen that leaves by itself: what the GM refused, what came. */
export class Notice {
  private readonly element: HTMLElement;
  private timer: number | undefined;

  constructor(host: HTMLElement) {
    this.element = document.createElement('div');
    this.element.className = 'notice';
    this.element.setAttribute('role', 'status');
    this.element.hidden = true;
    host.append(this.element);
  }

  /** Shows `text` for `ms` (`NOTICE_MS` unless named). */
  show(text: string, ms = NOTICE_MS): void {
    this.element.textContent = text;
    this.element.hidden = false;
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => (this.element.hidden = true), ms);
  }
}
