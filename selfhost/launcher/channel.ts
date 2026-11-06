/** Which image a campaign runs: the released one, or the one `develop` published for testing. */
export type Channel = 'stable' | 'dev';

const REPOSITORY = 'kunail0804/atlas-relay';

/** The image of a channel. CI tags every image from main `latest` and every image from develop `dev`. */
export function imageOf(channel: Channel): string {
  return `${REPOSITORY}:${channel === 'dev' ? 'dev' : 'latest'}`;
}

export interface StartArguments {
  readonly name: string | undefined;
  readonly channel: Channel;
  /** Options this command does not know, which the caller refuses. */
  readonly unknown: readonly string[];
}

/** Reads `atlas start`'s arguments after the command: a campaign name and `--dev`, in any order. */
export function startArguments(args: readonly string[]): StartArguments {
  const options = args.filter((arg) => arg.startsWith('--'));
  return {
    name: args.find((arg) => !arg.startsWith('--')),
    channel: options.includes('--dev') ? 'dev' : 'stable',
    unknown: options.filter((option) => option !== '--dev'),
  };
}
