import type { GmMessage, PlayerMessage } from '../../../src/app/online/protocol/game.ts';
import type { ImageEntry } from '../../../src/app/online/protocol/log.ts';
import { LogState, mountLogSurface, type LogActions, type SpeakerOption } from '../../../src/app/online/tableLog/index.ts';
import type { AssetLoader } from './assets.ts';
import type { ImageViewer } from './shownImage.ts';

/** Images in the log are asked for at this size: they show as thumbnails there. */
const LOG_IMAGE_SIDE = 1024;

const LOG_TYPES: readonly string[] = ['log', 'log-entry', 'log-remove', 'chat-refused', 'people'];

/**
 * The table's log (chat and rolls) with the plugin's own panel. The panel changes nothing itself:
 * what the player does goes to the GM, and the GM's messages update the log.
 */
export class LogPanel {
  private readonly state: LogState;
  private readonly surface: ReturnType<typeof mountLogSurface>;
  private readonly send: (message: PlayerMessage) => void;
  private readonly scene: () => string | null;
  private self: string | null = null;
  private name = '';
  private canSend = false;
  private open = false;
  private readonly assets: AssetLoader;
  private readonly viewer: ImageViewer;
  /** Object URLs of the log's images, by hash, once they are here. */
  private readonly images = new Map<string, string>();

  constructor(host: HTMLElement, send: (message: PlayerMessage) => void, scene: () => string | null, assets: AssetLoader, viewer: ImageViewer) {
    this.send = send;
    this.scene = scene;
    this.assets = assets;
    this.viewer = viewer;
    this.state = new LogState(() => this.self);
    this.surface = mountLogSurface(host);
    this.render();
  }

  /** Takes the log's messages; false for any other message. */
  receive(message: GmMessage): boolean {
    if (!LOG_TYPES.includes(message.t)) return false;
    this.state.receive(message as Parameters<LogState['receive']>[0]);
    return true;
  }

  setPlayer(id: string, name: string): void {
    this.self = id;
    this.name = name;
    this.render();
  }

  setCanSend(canSend: boolean): void {
    this.canSend = canSend;
    this.render();
  }

  toggle(): void {
    this.open = !this.open;
    this.state.setOpen(this.open);
    this.render();
  }

  private readonly actions: LogActions = {
    say: (draft) => this.send({ t: 'chat', text: draft.text, ...(draft.reply === undefined ? {} : { reply: draft.reply }), ...(draft.style === undefined ? {} : { style: draft.style }), ...(draft.to === undefined ? {} : { to: draft.to }) }),
    roll: (draft) => {
      const scene = this.scene();
      if (scene === null) return;
      this.send({ t: 'roll', scene, formula: draft.formula, token: null, mode: draft.mode, ...(draft.flavor === undefined ? {} : { flavor: draft.flavor }), ...(draft.request === undefined ? {} : { request: draft.request }) });
    },
    edit: (id, text) => this.send({ t: 'chat-edit', id, text }),
    remove: (id) => this.send({ t: 'chat-delete', id }),
    react: (id, emoji, on) => this.send({ t: 'react', id, emoji, on }),
  };

  /** An image of the log, or null while it comes; the panel is drawn again once it is here. */
  private imageSrc(entry: ImageEntry): string | null {
    const known = this.images.get(entry.image.hash);
    if (known !== undefined) return known;
    this.assets.image(entry.image, LOG_IMAGE_SIDE).then((loaded) => {
      this.images.set(entry.image.hash, loaded.url);
      this.render();
    }).catch(() => undefined);
    return null;
  }

  private render(): void {
    const speakers: SpeakerOption[] = [{ key: 'self', name: this.name === '' ? 'Moi' : this.name, kind: 'self', portrait: null }];
    this.surface.show({
      state: this.state, actions: this.actions, self: this.self, moderator: false, canSend: this.canSend,
      offlineText: 'Le MJ n\'est pas connecté.', speakers, open: this.open,
      onOpen: () => this.toggle(), onClose: () => this.toggle(),
      imageSrc: (entry) => this.imageSrc(entry), openImage: (entry) => this.viewer.open(entry),
    });
  }
}
