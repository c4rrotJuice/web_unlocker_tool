export const WRITIOR_LOGO_ASSET_PATHS = Object.freeze({
  32: "assets/icons/writior_logo_32.jpg",
  48: "assets/icons/writior_logo_48.jpg",
  128: "assets/icons/writior_logo_128.jpg",
});

export function normalizeWritiorLogoSize(size: number = 32) {
  const numericSize = Number(size);
  if (numericSize >= 128) {
    return 128;
  }
  if (numericSize >= 48) {
    return 48;
  }
  return 32;
}

export function getWritiorLogoAssetPath(size: number = 32) {
  return WRITIOR_LOGO_ASSET_PATHS[normalizeWritiorLogoSize(size)];
}

export function getWritiorLogoAssetUrl({
  chromeApi = globalThis.chrome,
  size = 32,
  fallbackPrefix = "",
}: {
  chromeApi?: any;
  size?: number;
  fallbackPrefix?: string;
} = {}) {
  const path = getWritiorLogoAssetPath(size);
  if (typeof chromeApi?.runtime?.getURL === "function") {
    return chromeApi.runtime.getURL(path);
  }
  return `${fallbackPrefix}${path}`;
}
