import type { NodeFsModule } from '../soundLibrary/nodeFiles';
import { BackupFolderError, type BackupFolder, type BackupFolderProblem } from './backupFolder';

/** What a backup folder on disk needs of Node's `fs`. */
export type BackupFs = Pick<NodeFsModule['promises'], 'readdir' | 'stat' | 'readFile' | 'writeFile' | 'unlink'>;

const MISSING_CODES = new Set(['ENOENT', 'ENOTDIR']);
const UNWRITABLE_CODES = new Set(['EACCES', 'EPERM', 'EROFS']);

const codeOf = (error: unknown): unknown => (error instanceof Error ? Reflect.get(error, 'code') : undefined);

/** The folder problem a Node error names, or null for any other failure. */
function problemOf(error: unknown): BackupFolderProblem | null {
  const code = codeOf(error);
  if (typeof code !== 'string') return null;
  if (MISSING_CODES.has(code)) return 'missing';
  return UNWRITABLE_CODES.has(code) ? 'unwritable' : null;
}

/**
 * A folder the GM chose outside the vault (desktop app only). It is never created: a folder that is
 * gone (an unplugged drive, a renamed folder) fails the backup instead of writing it somewhere else.
 */
export function diskBackupFolder(fs: BackupFs, folder: string, sep: string): BackupFolder {
  const pathOf = (name: string): string => `${folder.endsWith(sep) ? folder : `${folder}${sep}`}${name}`;

  const inFolder = async <T>(work: () => Promise<T>): Promise<T> => {
    try {
      return await work();
    } catch (error) {
      const problem = problemOf(error);
      throw problem === null ? error : new BackupFolderError(problem, folder, { cause: error });
    }
  };

  const ensureFolder = async (): Promise<void> => {
    const stat = await inFolder(() => fs.stat(folder));
    if (!stat.isDirectory()) throw new BackupFolderError('missing', folder);
  };

  return {
    async names() {
      await ensureFolder();
      const entries = await inFolder(() => fs.readdir(folder, { withFileTypes: true }));
      return entries.filter((entry) => entry.isFile() && entry.name.endsWith('.json')).map((entry) => entry.name);
    },
    read: (name) => inFolder(() => fs.readFile(pathOf(name), 'utf8')),
    async write(name, text) {
      await ensureFolder();
      await inFolder(() => fs.writeFile(pathOf(name), text, 'utf8'));
    },
    remove: (name) => inFolder(() => fs.unlink(pathOf(name))),
  };
}
