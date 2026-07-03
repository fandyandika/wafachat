import { toCanvas } from 'html-to-image';

// Sample a sparse grid of pixels; if every sample matches the first one the canvas
// is a solid fill — i.e. the background painted but WebKit silently failed to draw
// the SVG snapshot on top (a known iOS Safari flake with foreignObject rendering:
// the first pass often comes out blank, a retry works once resources are warm).
function isCanvasBlank(canvas: HTMLCanvasElement): boolean {
  const ctx = canvas.getContext('2d');
  if (!ctx || !canvas.width || !canvas.height) return true;
  let first: Uint8ClampedArray | null = null;
  for (let yi = 0; yi < 8; yi++) {
    for (let xi = 0; xi < 4; xi++) {
      const x = Math.floor(((xi + 0.5) / 4) * canvas.width);
      const y = Math.floor(((yi + 0.5) / 8) * canvas.height);
      const px = ctx.getImageData(x, y, 1, 1).data;
      if (!first) {
        first = px;
        continue;
      }
      if (Math.abs(px[0] - first[0]) + Math.abs(px[1] - first[1]) + Math.abs(px[2] - first[2]) > 12) {
        return false; // found a pixel that differs from the corner → real content
      }
    }
  }
  return true;
}

// Render a DOM node to a PNG and hand it to the user — entirely client-side
// (zero Convex reads; the data is already on screen). On mobile, prefer the
// native share sheet (straight into WhatsApp); otherwise download the file.
export async function shareNodeAsPng(node: HTMLElement, filename: string): Promise<void> {
  const background = getComputedStyle(document.body).backgroundColor || '#ffffff';
  // Buttons and other chrome marked data-nocapture stay out of the image.
  const skipChrome = (el: HTMLElement) => !(el instanceof HTMLElement) || el.dataset?.nocapture === undefined;

  // iOS Safari silently returns an EMPTY canvas past ~16.7M pixels (width × height).
  // The full-board export at desktop width is tall enough to blow that at 2× —
  // scale the ratio down so the canvas stays inside a safe budget. Small nodes
  // (single card) still get the crisp 2×.
  const MAX_CANVAS_PIXELS = 12_000_000;
  const area = Math.max(node.scrollWidth * node.scrollHeight, 1);
  const baseRatio = Math.min(2, Math.sqrt(MAX_CANVAS_PIXELS / area));

  // Fonts must be loaded before the snapshot or Safari renders text as blank.
  try {
    await document.fonts?.ready;
  } catch {
    /* older browsers without the Font Loading API — proceed */
  }

  const render = (pixelRatio: number, dropImages: boolean) =>
    toCanvas(node, {
      pixelRatio,
      cacheBust: true,
      backgroundColor: background,
      // Avatar <img> from another origin can fail CORS inlining — the last attempts
      // drop images (initials chips still render) rather than failing the capture.
      filter: dropImages
        ? (el) => skipChrome(el as HTMLElement) && (el as HTMLElement).tagName !== 'IMG'
        : skipChrome,
    });

  // Escalating attempts: same settings twice (warm-up beats the iOS first-pass
  // blank), then half resolution (device canvas-memory limits), then without
  // <img> (CORS inlining failures throw).
  const attempts: Array<{ ratio: number; dropImages: boolean }> = [
    { ratio: baseRatio, dropImages: false },
    { ratio: baseRatio, dropImages: false },
    { ratio: baseRatio / 2, dropImages: false },
    { ratio: baseRatio / 2, dropImages: true },
  ];
  let canvas: HTMLCanvasElement | null = null;
  for (let i = 0; i < attempts.length; i++) {
    const { ratio, dropImages } = attempts[i];
    try {
      const candidate = await render(ratio, dropImages);
      if (!isCanvasBlank(candidate)) {
        canvas = candidate;
        break;
      }
      canvas = canvas ?? candidate; // keep something shareable if every attempt is blank
    } catch {
      /* render threw (CORS image etc.) — fall through to the next attempt */
    }
    if (i < attempts.length - 1) await new Promise((r) => setTimeout(r, 150));
  }
  if (!canvas) throw new Error('Gagal membuat gambar');
  const finalCanvas = canvas;

  const blob = await new Promise<Blob | null>((resolve) => finalCanvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Gagal membuat gambar');

  const file = new File([blob], filename, { type: 'image/png' });
  if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (e) {
      // User cancelled the share sheet — treat as done, don't force a download.
      if ((e as DOMException)?.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
