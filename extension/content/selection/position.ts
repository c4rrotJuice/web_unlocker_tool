function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function computePillPosition({
  rect,
  viewportWidth,
  viewportHeight,
  panelWidth,
  panelHeight,
  gap = 12,
  margin = 8,
}: {
  rect: any;
  viewportWidth: number;
  viewportHeight: number;
  panelWidth: number;
  panelHeight: number;
  gap?: number;
  margin?: number;
}) {
  const width = Math.max(1, Number(panelWidth || 0));
  const height = Math.max(1, Number(panelHeight || 0));
  const safeRect = rect || { left: 0, top: 0, width: 0, height: 0, bottom: 0 };
  const left = clamp(
    Number(("right" in safeRect ? safeRect.right : Number(safeRect.left || 0) + Number(safeRect.width || 0)) || 0) - width,
    margin,
    Math.max(margin, Number(viewportWidth || 0) - width - margin),
  );
  const aboveTop = Number(safeRect.top || 0) - height - gap;
  const belowTop = Number(safeRect.bottom || 0) + gap;
  const top = aboveTop >= margin
    ? aboveTop
    : clamp(
      belowTop,
      margin,
      Math.max(margin, Number(viewportHeight || 0) - height - margin),
    );

  return { top, left };
}
