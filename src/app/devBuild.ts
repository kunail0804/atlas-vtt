declare const __ATLAS_DEV_BUILD__: string | undefined;

/**
 * The tag of the `dev` image this plugin was built into (`0.12.1-dev.3`), or null for any other
 * build. develop's CI passes it to the image build (`ATLAS_DEV_BUILD`); main's passes nothing, so
 * the same code shows nothing there. Undefined outside Vite's build (tests).
 */
export const DEV_BUILD: string | null =
  typeof __ATLAS_DEV_BUILD__ === 'string' && __ATLAS_DEV_BUILD__ !== '' ? __ATLAS_DEV_BUILD__ : null;
