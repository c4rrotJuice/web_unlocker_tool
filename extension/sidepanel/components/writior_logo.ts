function resolveSrc(size = 32) {
  const normalized = Number(size) >= 128 ? 128 : Number(size) >= 48 ? 48 : 32;
  return `../assets/icons/writior_logo_${normalized}.jpg`;
}

export function createWritiorLogo({
  documentRef = globalThis.document,
  size = 32,
  alt = "Writior",
} = {}) {
  const image = documentRef.createElement("img");
  image.setAttribute("data-writior-logo", "true");
  image.src = resolveSrc(size);
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
