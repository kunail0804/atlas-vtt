import { ensureDir, logFile, stateDir } from './paths.ts';

/** A failure the GM can act on: `message` says what happened and what to do, in French. */
export class UserError extends Error {}

export async function log(line: string): Promise<void> {
  try {
    await ensureDir(stateDir());
    await Deno.writeTextFile(logFile(), `${new Date().toISOString()} ${line}\n`, { append: true });
  } catch {
    // The log is a help, never a reason to fail.
  }
}

/** Runs a program; never through a shell, so nothing in an argument is ever read as a command. */
export async function run(command: string, args: string[], options: { env?: Record<string, string>; stdin?: string } = {}): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const child = new Deno.Command(command, {
      args, stdout: 'piped', stderr: 'piped', stdin: options.stdin === undefined ? 'null' : 'piped',
      ...(options.env === undefined ? {} : { env: options.env }),
    }).spawn();
    if (options.stdin !== undefined) {
      const writer = child.stdin.getWriter();
      await writer.write(new TextEncoder().encode(options.stdin));
      await writer.close();
    }
    const output = await child.output();
    const decoder = new TextDecoder();
    return { code: output.code, stdout: decoder.decode(output.stdout), stderr: decoder.decode(output.stderr) };
  } catch (error) {
    // A program that is not installed: the caller decides what that means.
    return { code: -1, stdout: '', stderr: String(error) };
  }
}

export async function openBrowser(url: string): Promise<boolean> {
  const result = Deno.build.os === 'windows'
    ? await run('rundll32', ['url.dll,FileProtocolHandler', url])
    : await run('xdg-open', [url]);
  return result.code === 0;
}

export async function copyToClipboard(text: string): Promise<boolean> {
  if (Deno.build.os === 'windows') return (await run('clip', [], { stdin: text })).code === 0;
  for (const [command, args] of [['wl-copy', []], ['xclip', ['-selection', 'clipboard']], ['xsel', ['--clipboard', '--input']]] as const) {
    if ((await run(command, [...args], { stdin: text })).code === 0) return true;
  }
  return false;
}

/** A folder chosen in the system's dialog; null when there is no dialog or the GM cancelled. */
export async function pickFolder(title: string): Promise<string | null> {
  if (Deno.build.os === 'windows') {
    const script = 'Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.FolderBrowserDialog; '
      + `$d.Description = '${title.replace(/'/g, "''")}'; $d.ShowNewFolderButton = $false; `
      + 'if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($d.SelectedPath) }';
    const result = await run('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script]);
    return result.code === 0 && result.stdout.trim() !== '' ? result.stdout.trim() : null;
  }
  for (const [command, args] of [['zenity', ['--file-selection', '--directory', `--title=${title}`]], ['kdialog', ['--getexistingdirectory', Deno.env.get('HOME') ?? '/', '--title', title]]] as const) {
    const result = await run(command, [...args]);
    if (result.code === 0 && result.stdout.trim() !== '') return result.stdout.trim();
    if (result.code !== -1) return null;
  }
  return null;
}

export function ask(question: string): string {
  return (prompt(question) ?? '').trim();
}

export function pause(): void {
  prompt('Appuie sur Entrée pour continuer…');
}
