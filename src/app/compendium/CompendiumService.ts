import { requestUrl, TFile, TFolder, type App } from 'obsidian';
import { sha256 } from '../utils/hashing';
import { INSTALLS_DIR, installRecordPath, parseInstalledSource, type InstalledSource } from './installedSources';
import { obsidianCompendiumVault } from './obsidianCompendiumVault';
import { OFFICIAL_SOURCES, type OfficialSource } from './officialSources';
import { installSource, readInstalledSource, removeSource, type CompendiumVault, type InstallProgress, type InstallResult, type RemoveResult } from './sourceInstall';
import { openSource } from './sourceZip';
import { exportSource, personalManifest, sourceFolderNames, type ExportedSource } from './sourceExport';
import { MONSTER_TEMPLATES, isFolderName, sourceManifestProblem, type EntryKind } from './sourceFormat';
import { entryFileStem, entryFolder, entryProperties, newEntryText, type CompendiumBook } from './compendiumEntries';
import { ensureFolder } from '../plugin/vaultFolders';
import { createStatblockNote, freeNotePath } from '../statblocks/notes/createStatblockNote';

/**
 * The vault's compendium: which sources it has installed, installing one from Atlas' list or
 * from a zip file, and removing one. One per app.
 */
export class CompendiumService {
  private static readonly instances = new WeakMap<App, CompendiumService>();
  private readonly listeners = new Set<() => void>();
  private readonly vault: CompendiumVault;

  static forApp(app: App): CompendiumService {
    let service = CompendiumService.instances.get(app);
    if (!service) {
      service = new CompendiumService(app);
      CompendiumService.instances.set(app, service);
    }
    return service;
  }

  private constructor(private readonly app: App) {
    this.vault = obsidianCompendiumVault(app);
  }

  /** Every source the vault has installed, read from the install records. */
  async installed(): Promise<InstalledSource[]> {
    const folder = this.app.vault.getFolderByPath(INSTALLS_DIR);
    if (!(folder instanceof TFolder)) return [];
    const sources: InstalledSource[] = [];
    for (const child of folder.children) {
      if (!(child instanceof TFile) || child.extension !== 'json') continue;
      const record = parseInstalledSource(await this.app.vault.read(child));
      if (record) sources.push(record);
    }
    return sources.sort((a, b) => a.manifest.id.localeCompare(b.manifest.id));
  }

  /** Downloads a source of Atlas' list, checks it against the list's size and SHA-256, and installs it. */
  async installOfficial(source: OfficialSource, onProgress?: InstallProgress): Promise<InstallResult> {
    const response = await requestUrl({ url: source.url, method: 'GET', throw: false });
    if (response.status !== 200) throw new Error(`The download of ${source.book.name} failed (HTTP ${response.status}).`);
    const data = response.arrayBuffer;
    if (data.byteLength !== source.size || await sha256(data) !== source.sha256) {
      throw new Error(`The download of ${source.book.name} does not match the file Atlas expects. Nothing was installed.`);
    }
    return this.install(data, onProgress);
  }

  /** Installs a source from a zip file the GM chose, such as a personal source. */
  async installFile(file: Pick<Blob, 'arrayBuffer'>, onProgress?: InstallProgress): Promise<InstallResult> {
    return this.install(await file.arrayBuffer(), onProgress);
  }

  async remove(id: string): Promise<RemoveResult | null> {
    const record = await readInstalledSource(this.vault, id);
    if (!record) return null;
    const result = await removeSource(this.vault, record);
    this.notify();
    return result;
  }

  /** Exports the source folder `Compendium/<system>/<book>` as a zip, and records it as installed here. */
  async exportFolder(path: string): Promise<ExportedSource> {
    const folder = sourceFolderNames(path);
    if (!folder) throw new Error('Only a folder Compendium/<game system>/<book> can be exported as a source.');
    const paths = this.app.vault.getFiles().map((file) => file.path).filter((filePath) => filePath.startsWith(`${path}/`));
    const readBinary = async (filePath: string): Promise<Uint8Array> => {
      const file = this.app.vault.getFileByPath(filePath);
      if (!file) throw new Error(`${filePath} is gone.`);
      return new Uint8Array(await this.app.vault.readBinary(file));
    };
    try {
      return await exportSource(this.vault, folder, paths, readBinary, await this.installed());
    } finally {
      this.notify();
    }
  }

  /**
   * Creates an empty personal book, `Compendium/<system>/<book>`, and records it as installed so
   * campaigns can choose it. Its system takes the id of an installed system of the same name.
   * Returns the new source's id. Throws with a message for the GM when the book cannot be made.
   */
  async createBook(systemName: string, bookName: string): Promise<string> {
    const folder = { system: systemName.trim(), book: bookName.trim() };
    if (!isFolderName(folder.system) || !isFolderName(folder.book)) throw new Error('A name may not be empty, start with a dot, or hold any of * " \\ / < > : | ? # ^ [ ]');
    const installed = await this.installed();
    const manifest = personalManifest(folder, [], installed);
    if (installed.some((source) => source.manifest.id === manifest.id || source.manifest.root === manifest.root)) {
      throw new Error(`${folder.system} already has a book named ${folder.book}.`);
    }
    if (OFFICIAL_SOURCES.some((source) => source.id === manifest.id)) throw new Error(`${folder.book} is one of Atlas' sources: install it from the compendium list instead.`);
    const problem = sourceManifestProblem(manifest);
    if (problem) throw new Error(problem);
    await ensureFolder(this.app, manifest.root);
    const { files: _files, ...rest } = manifest;
    const record: InstalledSource = { manifest: rest, installedAt: Date.now(), files: {} };
    await this.vault.writeText(installRecordPath(manifest.id), `${JSON.stringify(record)}\n`);
    this.notify();
    return manifest.id;
  }

  /**
   * Creates a new entry in a book and returns its note. A monster of a system with a built-in
   * monster template is a native statblock of that template; every other entry is a note with the
   * entry's properties.
   */
  async createEntry(book: CompendiumBook, kind: EntryKind, name: string): Promise<TFile> {
    const folderPath = entryFolder(book, kind);
    const properties = entryProperties(book, kind, name.trim());
    const templateId = kind === 'monster' ? MONSTER_TEMPLATES[book.systemId] : undefined;
    if (templateId !== undefined) {
      const { name: _name, ...values } = properties;
      const created = await createStatblockNote(this.app, { name: name.trim(), templateId, folder: folderPath, values, fileStem: entryFileStem(name) });
      return created.file;
    }
    const folder = await ensureFolder(this.app, folderPath);
    const path = freeNotePath(this.app, folder, entryFileStem(name));
    return this.app.vault.create(path, newEntryText(book, kind, name.trim()));
  }

  /** Calls `listener` after every install or removal made here. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private async install(data: ArrayBuffer, onProgress?: InstallProgress): Promise<InstallResult> {
    const opened = await openSource(data);
    try {
      return await installSource(this.vault, opened, onProgress);
    } finally {
      this.notify();
    }
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
