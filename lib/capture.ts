import { toBlob } from 'html-to-image';

// Render a DOM node to a PNG and hand it to the user — entirely client-side
// (zero Convex reads; the data is already on screen). On mobile, prefer the
// native share sheet (straight into WhatsApp); otherwise download the file.
export async function shareNodeAsPng(node: HTMLElement, filename: string): Promise<void> {
  const background = getComputedStyle(document.body).backgroundColor || '#ffffff';
  // Buttons and other chrome marked data-nocapture stay out of the image.
  const skipChrome = (el: HTMLElement) => !(el instanceof HTMLElement) || el.dataset?.nocapture === undefined;
  // iOS Safari silently returns a BLANK canvas past ~16.7M pixels (width × height).
  // The full-board export at desktop width is tall enough to blow that at 2× —
  // scale the ratio down so the canvas stays inside a safe budget. Small nodes
  // (single card) still get the crisp 2×.
  const MAX_CANVAS_PIXELS = 12_000_000;
  const area = Math.max(node.scrollWidth * node.scrollHeight, 1);
  const pixelRatio = Math.min(2, Math.sqrt(MAX_CANVAS_PIXELS / area));
  let blob: Blob | null = null;
  try {
    blob = await toBlob(node, { pixelRatio, cacheBust: true, backgroundColor: background, filter: skipChrome });
  } catch {
    // Avatar <img> from another origin can fail CORS inlining — retry without images
    // (initials chips still render) rather than failing the whole capture.
    blob = await toBlob(node, {
      pixelRatio,
      cacheBust: true,
      backgroundColor: background,
      filter: (el) => skipChrome(el as HTMLElement) && (el as HTMLElement).tagName !== 'IMG',
    });
  }
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
