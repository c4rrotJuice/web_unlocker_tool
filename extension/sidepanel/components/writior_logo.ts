import { getWritiorLogoAssetUrl, normalizeWritiorLogoSize } from "../../shared/constants/assets.ts";

export function createWritiorLogo({
  documentRef = globalThis.document,
  chromeApi = globalThis.chrome,
  size = 32,
  alt = "Writior",
} = {}) {
  const assetSize = normalizeWritiorLogoSize(size);
  const image = documentRef.createElement("img");
  image.setAttribute("data-writior-logo", "true");
  image.setAttribute("data-logo-size", String(assetSize));
  image.src = getWritiorLogoAssetUrl({
    chromeApi,
    size,
    fallbackPrefix: "../",
  });
  image.alt = alt;
  image.width = size;
  image.height = size;
  image.style.width = `${size}px`;
  image.style.height = `${size}px`;
  image.style.borderRadius = "10px";
  image.style.display = "block";
  image.style.objectFit = "cover";
  image.style.flexShrink = "0";
  return image;
}
