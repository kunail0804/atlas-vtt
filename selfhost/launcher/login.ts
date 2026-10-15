import { ServiceError, api, saveSession } from './service.ts';
import { UserError, openBrowser } from './system.ts';

interface DeviceLogin {
  readonly device_code: string;
  readonly user_code: string;
  readonly login_url: string;
  readonly interval: number;
  readonly expires_in: number;
}

/** Signs in through Discord: opens the browser on the login link and waits until Discord sends the GM back. */
export async function login(): Promise<void> {
  const device = await api<DeviceLogin>('POST', '/auth/device', undefined, { session: false });
  console.log('\nConnexion avec Discord.');
  console.log(`Ton code : ${device.user_code}  (la page qui s'ouvre doit afficher le même ; sinon, ferme-la)`);
  const opened = await openBrowser(device.login_url);
  console.log(opened
    ? 'Une page s\'est ouverte dans ton navigateur : autorise Atlas sur Discord, puis reviens ici.'
    : `Ouvre ce lien dans ton navigateur, autorise Atlas sur Discord, puis reviens ici :\n  ${device.login_url}`);
  const deadline = Date.now() + device.expires_in * 1000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, Math.max(1, device.interval) * 1000));
    try {
      const done = await api<{ session_token: string }>('POST', '/auth/device/token', { device_code: device.device_code }, { session: false });
      await saveSession(done.session_token);
      return;
    } catch (error) {
      // `pending`: the browser has not come back from Discord yet, so keep waiting.
      if (!(error instanceof ServiceError) || error.code !== 'pending') throw error;
    }
  }
  throw new UserError('La connexion a expiré. Recommence.');
}
