import { runInBackground } from '../../utils/backgroundTask';
import { Component, type App, type Plugin, type TFile } from 'obsidian';
import { showNotice } from '../../ui/notice';
import type { AtlasSettingSection } from '../../settings/settingSections';
import { AccountControl } from './account/AccountControl.ts';
import { obsidianHttp } from './account/obsidianHttp.ts';
import { secretTokenStore } from './account/tokenStore.ts';
import { activeAtlasLeaf } from './atlasView.ts';
import { openPinNote } from '../../services/noteHeadings';
import { TableBooks } from '../../campaigns/players/TableBooks';
import { BookShelf } from './book/BookShelf.ts';
import { setActiveShelf } from './book/activeShelf.ts';
import { BoundBookSource, tableBookSource } from './book/tableBookSource.ts';
import { CompanionDiagnostics } from './companionDiagnostics.ts';
import { companionTimers, every, stopCompanionTimers } from './companionTimers.ts';
import { DockMounts } from './dock/DockMounts.ts';
import { ImageTakeover } from './image/imageTakeover.ts';
import { atlasImageDisplay, localPlayerWindowOpen, readShownFile } from './image/atlasImageHost.ts';
import { LogMounts } from './log/LogMounts.ts';
import { TableChat } from './tableChat.ts';
import { lootCardOf } from './log/lootCard.ts';
import { PlayerLootDisplay } from '../../services/PlayerLootDisplay';
import { copyText } from './dock/dockDom.ts';
import { onlineApi } from './dock/panelModel.ts';
import type { OnlineCommandId } from './onlineCommands.ts';
import { OnlineControl } from './OnlineControl.ts';
import type { OnlineDataFile } from './onlineData.ts';
import type { OnlineTable } from './OnlineTable.ts';
import { Ownership } from './ownership.ts';
import { readSavedTable, type SavedTable } from './savedTable.ts';
import { appCampaigns, playSavedTable, tableSeats, type TableCampaigns } from './tableCampaigns.ts';
import { appCampaignChoices } from './campaignChoices.ts';
import { DASHBOARD_VIEW_TYPE } from '../../dashboard-view';
import { DEFAULT_SETTINGS, onlineSettingsSections, readSettings, type OnlineSettings } from './settings.ts';
import { t } from '../../i18n';
import { secretSaltStore } from './account/saltStore.ts';
import { AssetSalt } from './assets/assetSalt.ts';
import { AssetStoreClient } from './assets/storeClient.ts';
import { RELAY_ORIGIN } from './servers.ts';
import type { HostAccount } from './tableStart.ts';

/** How long a change of the table's log waits before the data file is written. */
const LOG_SAVE_MS = 10_000;
/** How often the tab the table's log stands on and Atlas's image display are looked for. */
const SYNC_MS = 1_000;

const tokensText = (count: number): string => t('online.tokens', { count });

/**
 * Online play: shares the scene of an Atlas map tab with players in their browsers. A child of the
 * plugin, loaded while the GM has online play switched on. Nothing connects until the GM starts a table.
 */
export class OnlineFeature extends Component {
  settings: OnlineSettings = { ...DEFAULT_SETTINGS };
  /** The GM's side of online play, for panels and commands: table, players and player tokens. */
  online: OnlineControl;
  /** The GM's Atlas account, which tables are asked for with. */
  readonly account: AccountControl;
  /** The salt the GM's asset ids are made with, kept beside the account's token. */
  private readonly salt: AssetSalt;
  private readonly app: App;
  /** The running table as saved in this device's data, so a reload comes back to it. */
  private savedTable: SavedTable | null = null;
  /** The running table's log as saved with it; undefined while there is none. */
  private savedLog: unknown = undefined;
  private logSave: number | null = null;
  /** The last write of the data file, settled whether it worked or not (`flush`). */
  private writing: Promise<void> = Promise.resolve();
  /** Where the shelf keeps books: the table's books file once a table is bound, else nowhere (they stay in memory). */
  private readonly bookSource = new BoundBookSource();
  /** The players' books; they outlive tables. */
  private readonly books = new BookShelf(this.bookSource);
  private docks: DockMounts | null = null;
  private logs: LogMounts | null = null;
  /** The table's log for other plugins (`TableChat`). */
  readonly chat = new TableChat(() => (this.ready ? this.online.table : null));
  /** False before loading and after unloading: commands are offered and data is taken in only while true. */
  private live = false;
  /** True once this device's data was read: before that there is nothing to show in the settings, or to save. */
  private ready = false;
  private readonly commands = new Map<OnlineCommandId, (checking: boolean) => boolean>();

  constructor(private readonly plugin: Plugin, private readonly data: OnlineDataFile) {
    super();
    this.app = plugin.app;
    const campaigns = this.campaigns();
    this.online = new OnlineControl(this.app, new Ownership(tableSeats(campaigns, () => this.savedTable !== null)), campaigns);
    const store = new AssetStoreClient(RELAY_ORIGIN, () => this.account.token());
    const signedIn = (): boolean => this.account.token() !== null;
    this.salt = new AssetSalt({
      store: secretSaltStore(this.app),
      fetch: () => store.salt(),
      signedIn,
      signedOutByServer: () => this.account.signedOutByServer(),
      now: () => companionTimers().now(),
      sleep: (ms) => new Promise((resolve) => companionTimers().setTimer(resolve, ms)),
    });
    this.account = new AccountControl({
      http: obsidianHttp,
      timers: companionTimers(),
      tokens: secretTokenStore(this.app),
      openUrl: (url) => void window.open(url),
      notify: (text) => showNotice(text),
      signedIn: () => {
        void this.salt.ensure(true);
        this.online.table?.signedIn();
      },
      signedOut: () => this.salt.clear(),
      // The table uploads nothing more once the account's token is gone.
      beforeSignOut: () => Promise.resolve(this.online.table?.suspendAssets()),
    });
  }

  /** The account as tables are started with it, with what keeps assets in the store for players. */
  private host(): HostAccount {
    return {
      token: () => this.account.token(),
      signedOutByServer: () => this.account.signedOutByServer(),
      refresh: (force) => this.account.refresh(force),
      assets: { salt: this.salt, settled: () => undefined },
    };
  }

  /** The running table, or null. */
  get table(): OnlineTable | null {
    return this.online.table;
  }

  /** Online play's sections of Atlas's settings; none until its data was read, so no row can save over it. */
  settingsSections(): AtlasSettingSection[] {
    return this.ready ? onlineSettingsSections(this) : [];
  }

  /** Runs one of online play's commands, or checks whether it can run now. */
  runCommand(id: OnlineCommandId, checking: boolean): boolean {
    return this.live && (this.commands.get(id)?.(checking) ?? false);
  }

  onload(): void {
    this.live = true;
    void this.start().catch((error: unknown) => console.error('[Atlas] Online play could not start:', error));
  }

  private async start(): Promise<void> {
    const version = this.plugin.manifest.version;
    // Online play's own uncaught errors go to the console, and to the table's server once the GM switched error reports on.
    const diagnostics = new CompanionDiagnostics({
      reportErrors: () => this.settings.reportErrors,
      setReportErrors: (on) => {
        this.settings.reportErrors = on;
        void this.saveSettings();
      },
      table: () => this.savedTable,
      playerNames: () => this.online.players().map((player) => player.name),
      connection: () => this.online.table?.connectionStats() ?? null,
    }, version, () => version);
    this.register(diagnostics.listen(window));
    const data = await this.data.read();
    // Switched off while the data was read: nothing more is set up.
    if (!this.live) return;
    this.settings = readSettings(data);
    this.ready = true;
    const record = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};
    const campaigns = this.campaigns();
    const ownership = new Ownership(tableSeats(campaigns, () => this.savedTable !== null));
    this.savedTable = readSavedTable(record.table);
    this.savedLog = this.savedTable === null ? undefined : record.tableLog;
    setActiveShelf(this.books);
    // A world is played only while its table runs: the saved table's comes back with it.
    playSavedTable(campaigns, this.savedTable);
    this.online = new OnlineControl(this.app, ownership, campaigns, (table) => {
      this.savedTable = table;
      void this.saveSettings();
    }, this.host(), { read: () => this.savedLog, write: (entries) => this.keepLog(entries) }, this.books);
    // Atlas's "Display on player view" reaches the players online too, while a table runs.
    const images = new ImageTakeover<TFile>(() => atlasImageDisplay(this.app), {
      share: () => this.online.table?.image ?? null,
      readFile: (file) => readShownFile(this.app, file),
      pathOf: (file) => file.path,
      localWindowOpen: () => localPlayerWindowOpen(this.app),
      notice: (text) => showNotice(text),
    });
    this.register(() => images.dispose());
    // Loot handed out from the roller goes into the table's log while a table runs.
    const loot = PlayerLootDisplay.get();
    loot.setOutlet((draw) => {
      const item = this.online.table === null ? null : lootCardOf(draw);
      if (item === null) return false;
      this.online.table?.log.lootHanded(item);
      return true;
    });
    this.register(() => loot.setOutlet(null));
    const docks = new DockMounts(this.app.workspace, {
      api: onlineApi(this.online, () => images.hide()),
      account: this.account,
      campaigns: appCampaignChoices(this.app),
      openCampaigns: () => void this.app.workspace.getLeaf(true).setViewState({ type: DASHBOARD_VIEW_TYPE, active: true }),
      imageSrc: (path) => this.app.vault.adapter.getResourcePath(path),
      feedback: diagnostics,
      opened: (leaf) => logs.close(leaf),
    });
    this.docks = docks;
    // The table's log, where Atlas's dice log opens on the tab players see.
    const logs = new LogMounts({
      table: () => this.online.table,
      imageSrc: (path) => this.app.vault.adapter.getResourcePath(path),
      opened: (leaf) => docks.dockOf(leaf)?.makeWay(),
      openNote: (link, sourcePath) => runInBackground(openPinNote(this.app, link, true, sourcePath), `Opening ${link}`, 'Could not open the found note'),
    });
    this.logs = logs;
    this.register(this.online.onChange(() => (logs.sync(), logs.refresh(), images.sync(), this.chat.sync())));
    this.register(() => this.chat.dispose());
    this.register(this.online.logs.onChange(() => logs.logChanged()));
    // Which tab players see changes without a word (Atlas presents another, the tab closes), and so does Atlas's image display: looked at as often as the table looks.
    this.register(every(companionTimers(), SYNC_MS, () => (logs.sync(), images.sync())));
    this.app.workspace.onLayoutReady(() => {
      if (!this.live) return;
      // A table that ran when Obsidian or Atlas was last unloaded comes back with the same link.
      if (this.savedTable !== null) void this.online.resume(this.savedTable);
      // A signed-in GM's session is renewed, and the dock learns what it may host.
      void this.account.refresh(true);
      docks.sync();
      logs.sync();
    });
    this.command('start-online-table', (checking) => {
      const leaf = activeAtlasLeaf(this.app);
      if (!this.online.canStart() || leaf === null) return false;
      // Opens the start menu, where the GM picks the campaign the table plays.
      if (!checking) docks.dockOf(leaf)?.open();
      return true;
    });
    this.command('toggle-online-panel', (checking) => {
      const leaf = activeAtlasLeaf(this.app);
      const dock = leaf === null ? undefined : docks.dockOf(leaf);
      if (dock === undefined) return false;
      if (!checking) dock.toggle(false);
      return true;
    });
    this.command('copy-online-table-link', (checking) => {
      const link = this.online.link();
      if (link === null) return false;
      if (!checking) void copyText(activeDocument.body, link).then((copied) => showNotice(copied ? t('online.linkCopiedNotice') : t('online.linkCopyFailed')));
      return true;
    });
    this.command('make-selected-player-tokens', (checking) => this.markSelected(checking, true));
    this.command('make-selected-gm-tokens', (checking) => this.markSelected(checking, false));
    this.command('stop-online-table', (checking) => {
      if (this.table === null) return false;
      if (!checking) this.online.stop();
      return true;
    });
    this.registerEvent(this.app.workspace.on('layout-change', () => {
      this.table?.checkLeaf();
      docks.sync();
      logs.sync();
    }));
  }

  onunload(): void {
    this.live = false;
    setActiveShelf(null);
    this.docks?.dispose();
    this.docks = null;
    this.logs?.dispose();
    this.logs = null;
    // A change of the log that still waits to be saved is saved now, and so are the books still waiting for the table's books file.
    if (this.logSave !== null) void this.saveSettings();
    this.bookSource.flush();
    // Unloading closes the connection only: the table stays on the server and comes back on the next load.
    this.online.close();
    stopCompanionTimers();
  }

  /** Saves the settings with the running table and its log. */
  async saveSettings(): Promise<void> {
    if (this.logSave !== null) companionTimers().clearTimer(this.logSave);
    this.logSave = null;
    const write = this.data.write({
      ...this.settings,
      table: this.savedTable,
      ...(this.savedLog !== undefined && { tableLog: this.savedLog }),
    });
    this.writing = write.catch(() => undefined);
    await write;
  }

  /** Settles once this device's data holds everything online play keeps, the log change still waiting included. */
  async flush(): Promise<void> {
    if (this.logSave !== null) await this.saveSettings().catch(() => undefined);
    await this.writing;
  }

  /**
   * From now on the players' books are kept in the table's books file while a table runs, whatever
   * world it plays, or in memory only while none runs; what the shelf held in memory of library
   * tokens' books is forgotten, so it never hides the file's.
   */
  bindBooks(running: boolean): void {
    const books = TableBooks.forApp(this.app);
    this.bookSource.bind(!running || books === undefined ? null : tableBookSource(books));
    if (running) this.books.forgetKept();
  }

  /** The campaigns tables run on; a table binds the table's books. */
  private campaigns(): TableCampaigns {
    return appCampaigns(this.app, (running) => this.bindBooks(running));
  }

  /** What one of online play's commands does; the plugin registers the commands once (`registerOnlinePlay`). */
  private command(id: OnlineCommandId, check: (checking: boolean) => boolean): void {
    this.commands.set(id, check);
  }

  /** Keeps the table's log: a cleared one at once, a changed one within `LOG_SAVE_MS` (every message would write the data file). */
  private keepLog(log: object | null): void {
    const cleared = log === null;
    if (cleared && this.savedLog === undefined) return;
    this.savedLog = cleared ? undefined : log;
    if (cleared) return void this.saveSettings();
    this.saveSoon();
  }

  /** Writes the data file within `LOG_SAVE_MS`: every message or note would write it otherwise. */
  private saveSoon(): void {
    this.logSave ??= companionTimers().setTimer(() => void this.saveSettings(), LOG_SAVE_MS);
  }

  /** Makes the tokens selected on the active Atlas tab player tokens, or the GM's own. */
  private markSelected(checking: boolean, player: boolean): boolean {
    if (activeAtlasLeaf(this.app) === null) return false;
    if (checking) return true;
    const count = this.online.markSelected(player);
    if (count === null) return true;
    if (count === 0) showNotice(t('online.selectTokensFirst'));
    else showNotice(player ? t('online.madePlayerTokens', { tokens: tokensText(count) }) : t('online.madeGmTokens', { tokens: tokensText(count) }));
    return true;
  }
}
