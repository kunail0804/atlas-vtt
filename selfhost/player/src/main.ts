import '../../../src/app/online/tableLog/styles/table-log.scss';
import './page.css';
// The page's policy forbids eval (relay/staticFiles.ts); PixiJS then needs its own replacement for it.
import 'pixi.js/unsafe-eval';
import '../../../src/app/online/marks/styles/marks.scss';
import type { GmMessage } from '../../../src/app/online/protocol/game.ts';
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
import './dice.scss';
import { SceneView, type SceneNotice } from './sceneView.ts';
import { createStage } from './stage.ts';
import { TokenLayer } from './tokenLayer.ts';
import { StatusLine, askToJoin, closeText, toolbar } from './ui.ts';

const NOTICE_TEXT: Readonly<Record<SceneNotice, string | null>> = {
  none: null,
  'no-scene': 'Le MJ n\'a pas encore partagé de scène.',
  loading: 'Chargement de la carte…',
  lit: 'Cette scène utilise l\'éclairage dynamique, que cette page n\'affiche pas encore.',
  'map-failed': 'La carte n\'a pas pu être chargée.',
};

async function main(): Promise<void> {
  installBrowserDomHost();
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
  const marks = new MarksView(stage.viewport, stage.app.canvas, send, () => playerId, () => scene.sceneId);
  scene.onSceneChange = () => {
    marks.clear();
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
  const annotations = new AnnotationsView(stage.annotations, stage.pins, send, () => scene.sceneId, () => log.show());
  const log = new LogPanel(logHost, send, () => scene.sceneId, assets, viewer);
  dice = new DiceView(app, (who) => log.nameOf(who));
  const chatButton = document.createElement('button');
  // The plugin's panel closes on a press outside it, except on the host's button for it (LOG_TOGGLE).
  chatButton.className = 'chat-button atlas-online-log-button';
  chatButton.textContent = 'Chat et dés';
  chatButton.addEventListener('click', () => log.toggle());

  const inbox = new GameInbox((message: GmMessage) => {
    if (message.t === 'roll') dice?.roll(message);
    if (assets.receive(message) || log.receive(message)) return;
    if (message.t === 'marks') return marks.receive(message);
    if (message.t === 'rules') return marks.rules(message);
    if (message.t === 'shown-image') return viewer.fromGm(message);
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
        if (chatButton.parentElement === null) {
          app.append(chatButton);
          toolbar(app, (tool) => {
            marks.setTool(tool);
            tokens.setDragsEnabled(tool === 'move');
          });
        }
        return refresh();
      case 'gm':
        gmOnline = event.online;
        log.setCanSend(gmOnline);
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
