// The plugin's whole stylesheet, so its toolbar, menus, dice tray and log look as they do for the GM.
import '../../../styles/index.css';
import '../../../styles/main.scss';
import './page.css';
// The page's policy forbids eval (relay/staticFiles.ts); PixiJS then needs its own replacement for it.
import 'pixi.js/unsafe-eval';
import type { GmMessage } from '../../../src/app/online/protocol/game.ts';
import type { RollAdvantage } from '../../../src/app/online/protocol/dice.ts';
import { TABLE_CODE_PATTERN } from '../../../src/app/online/protocol/relay.ts';
import { AssetLoader } from './assets.ts';
import { PlayerConnection, type ConnectionEvent, type JoinRequest } from './connection.ts';
import { installBrowserDomHost } from './domHost.ts';
import { GameInbox } from './inbox.ts';
import { LogPanel } from './logPanel.ts';
import { MarksView } from './marks.ts';
import { ImageViewer } from './shownImage.ts';
import { InitiativePanel } from './initiative.ts';
import { AnnotationsView } from './annotations.ts';
import { WidgetBar } from './widgets.ts';
import { DiceView } from './dice.tsx';
import { BookPanel } from './book.ts';
import { deviceKey } from './deviceKey.ts';
import { Notice } from './notice.ts';
import { Reader } from './reader.ts';
import { TEXT } from './text.ts';
import { SceneView, type SceneNotice } from './sceneView.ts';
import { createStage } from './stage.ts';
import { TokenLayer } from './tokenLayer.ts';
import { StatusLine, askToJoin, closeText } from './ui.ts';
import { DrawTools, askText } from './drawTools.ts';
import { mountToolbar, type ToolbarState } from './toolbar.tsx';
import { ToolSettingsStore } from './toolSettings.ts';

const NOTICE_TEXT: Readonly<Record<SceneNotice, string | null>> = {
  none: null,
  'no-scene': 'Le MJ n\'a pas encore partagé de scène.',
  loading: 'Chargement de la carte…',
  'lit-failed': 'L\'éclairage dynamique ne peut pas s\'afficher sur ce navigateur : la carte reste masquée.',
  'map-failed': 'La carte n\'a pas pu être chargée.',
};

async function main(): Promise<void> {
  installBrowserDomHost();
  // Obsidian's dark theme marks the body; the plugin's styles read it (the dice tray's faces among them).
  document.body.classList.add('theme-dark');
  document.documentElement.dataset.pointer = window.matchMedia('(pointer: coarse)').matches ? 'coarse' : 'fine';
  const app = document.querySelector<HTMLDivElement>('#app');
  if (app === null) return;
  const table = window.location.hash.slice(1);
  if (!TABLE_CODE_PATTERN.test(table)) {
    app.textContent = 'Ce lien ne contient pas de table. Demande le lien d\'invitation au MJ.';
    return;
  }

  const status = new StatusLine(app);
  let request: JoinRequest = await askToJoin(app, null);
  const canvasHost = document.createElement('div');
  canvasHost.className = 'canvas';
  app.prepend(canvasHost);
  const stage = await createStage(canvasHost);

  let connection: PlayerConnection | null = null;
  const send = (body: Parameters<PlayerConnection['send']>[0]): void => connection?.send(body);
  const assets = new AssetLoader(send);
  const tokens = new TokenLayer(stage.tokens, stage.viewport, assets, send);
  let notice: SceneNotice = 'no-scene';
  let gmOnline = false;
  const refresh = (): void => {
    if (!gmOnline) return status.show('Le MJ n\'est pas connecté pour l\'instant.', 'warn');
    status.show(NOTICE_TEXT[notice]);
  };
  const scene = new SceneView(stage, assets, tokens, (next) => {
    notice = next;
    refresh();
  });
  let playerId: string | null = null;
  const settings = new ToolSettingsStore();
  const marks = new MarksView(stage.viewport, stage.app.canvas, send, () => playerId, () => scene.sceneId, settings);
  scene.onSceneChange = () => {
    marks.clear();
    drawTools.clear();
    initiative.show(null);
    annotations.clear();
    widgets.show(null);
  };
  const logHost = document.createElement('div');
  app.append(logHost);
  const viewer = new ImageViewer(app, assets);
  const initiative = new InitiativePanel(app, assets);
  const widgets = new WidgetBar(app);
  let dice: DiceView | null = null;
  const notices = new Notice(app);
  // What the toolbar shows, kept for when it mounts (the book or the rules may come first). The tray
  // offers both sides of advantage until the GM names the dice set's (`dice-rules`): a GM's Atlas that
  // names none still rolls them by its set's rules, and a set without them rolls as it is.
  let toolbarState: ToolbarState = { advantage: ['advantage', 'disadvantage'], book: false };
  const reader = new Reader(app, assets);
  /** A roll of the player's, from the dice tray or the sheet; false while no scene is shared to roll in. */
  const rollAs = (formula: string, how: { readonly flavor?: string; readonly advantage?: RollAdvantage | null } = {}): boolean => {
    const shared = scene.sceneId;
    if (shared === null) {
      notices.show(TEXT.rolls.noScene);
      return false;
    }
    send({ t: 'roll', scene: shared, formula, token: null, ...(how.flavor !== undefined && { flavor: how.flavor.slice(0, 80) }), ...(how.advantage != null && { advantage: how.advantage }) });
    return true;
  };
  const book = new BookPanel(app, assets, send, (text) => notices.show(text), (has) => {
    toolbarState = { ...toolbarState, book: has };
    bar?.update(toolbarState);
  }, { roll: (formula, label) => void rollAs(formula, { flavor: label }), openNote: (note) => reader.open(note) });
  const annotations = new AnnotationsView(stage.annotations, stage.pins, send, () => scene.sceneId, (found) => {
    if (found === null || !log.openFound(found)) log.show();
  });
  const log = new LogPanel(logHost, send, () => scene.sceneId, assets, viewer, reader, () => notices.show(TEXT.rolls.noScene));
  dice = new DiceView(app, (who) => log.nameOf(who));
  const drawTools = new DrawTools(stage.viewport, stage.annotations, annotations, {
    send, scene: () => scene.sceneId, self: () => playerId, settings, askText: (at) => askText(app, at),
  });
  let bar: ReturnType<typeof mountToolbar> | null = null;
  const showToolbar = (): void => {
    if (bar !== null) return;
    bar = mountToolbar(app, {
      settings,
      setTool: (tool) => {
        marks.setTool(tool);
        drawTools.setTool(tool);
        tokens.setDragsEnabled(tool === 'move');
      },
      deleteMyDrawings: () => drawTools.deleteMine(),
      roll: (formula, advantage) => rollAs(formula, { advantage }),
      toggleChat: () => log.toggle(),
      toggleBook: () => book.toggle(),
    });
    bar.update(toolbarState);
  };

  const inbox = new GameInbox((message: GmMessage) => {
    if (message.t === 'roll') dice?.roll(message);
    if (message.t === 'roll-refused') return notices.show(TEXT.rolls.refused[message.reason]);
    if (assets.receive(message) || log.receive(message)) return;
    if (message.t === 'marks') return marks.receive(message);
    if (message.t === 'rules') return marks.rules(message);
    if (message.t === 'dice-rules') {
      if (message.scene !== scene.sceneId) return;
      toolbarState = { ...toolbarState, advantage: message.advantage };
      return bar?.update(toolbarState);
    }
    if (message.t === 'shown-image') return viewer.fromGm(message);
    if (message.t === 'book' || message.t === 'book-sheet' || message.t === 'book-item') return book.receive(message);
    if (message.t === 'sheet') return book.receiveSheet(message);
    if (message.t === 'compendium' || message.t === 'compendium-entry' || message.t === 'compendium-saved' || message.t === 'sheet-choices' || message.t === 'compendium-missing') return book.receiveCompendium(message);
    if (message.t === 'initiative') return message.scene === scene.sceneId ? initiative.show(message.list) : undefined;
    if (message.t === 'annotations') return message.scene === scene.sceneId ? annotations.showAnnotations(message) : undefined;
    if (message.t === 'widgets') return message.scene === scene.sceneId ? widgets.show(message.bar) : undefined;
    if (message.t === 'pins') return message.scene === scene.sceneId ? annotations.showPins(message.pins) : undefined;
    scene.receive(message);
  }, (sceneId, of) => send({ t: 'resync', scene: sceneId, of }));

  const listen = (event: ConnectionEvent): void => {
    switch (event.kind) {
      case 'connecting':
        return status.show('Connexion à la table…');
      case 'waiting':
        return status.show('Le MJ va t\'accepter à la table, patiente un instant…');
      case 'welcome':
        gmOnline = event.gmOnline;
        playerId = event.id;
        log.setPlayer(event.id, request.name);
        log.setCanSend(gmOnline);
        showToolbar();
        // Who this player is, from one table to the next: the pages the GM shares with them follow.
        send({ t: 'identify', key: deviceKey() });
        return refresh();
      case 'gm':
        gmOnline = event.online;
        log.setCanSend(gmOnline);
        // A GM's Atlas that came back knows no one at the table yet.
        if (gmOnline) send({ t: 'identify', key: deviceKey() });
        return refresh();
      case 'game':
        return inbox.receive(event.body);
      case 'closed':
        if (!event.final) return status.show(`${closeText(event.code)} Reconnexion…`, 'warn');
        status.show(null);
        void askToJoin(app, closeText(event.code)).then((again) => {
          request = again;
          connection = new PlayerConnection(table, request, listen);
          connection.start();
        });
        return;
    }
  };
  connection = new PlayerConnection(table, request, listen);
  connection.start();
}

void main();
