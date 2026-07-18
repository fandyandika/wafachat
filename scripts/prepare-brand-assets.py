from collections import deque
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE_MARK = ROOT / "assets/logo/logo-apps-1.png"
SOURCE_WORDMARK = ROOT / "assets/logo/logo-apps-2.png"
BRAND_DIR = ROOT / "public/brand"


def remove_border_background(image: Image.Image, threshold: int = 238) -> Image.Image:
    rgba = image.convert("RGBA")
    pixels = rgba.load()
    width, height = rgba.size
    queue = deque()
    visited = bytearray(width * height)

    def enqueue(x: int, y: int) -> None:
        index = y * width + x
        if visited[index]:
            return
        red, green, blue, _ = pixels[x, y]
        if min(red, green, blue) < threshold or max(red, green, blue) - min(red, green, blue) > 18:
            return
        visited[index] = 1
        queue.append((x, y))

    for x in range(width):
        enqueue(x, 0)
        enqueue(x, height - 1)
    for y in range(height):
        enqueue(0, y)
        enqueue(width - 1, y)

    while queue:
        x, y = queue.popleft()
        pixels[x, y] = (*pixels[x, y][:3], 0)
        if x:
            enqueue(x - 1, y)
        if x + 1 < width:
            enqueue(x + 1, y)
        if y:
            enqueue(x, y - 1)
        if y + 1 < height:
            enqueue(x, y + 1)
    return rgba


def crop_with_padding(image: Image.Image, padding_ratio: float = 0.06) -> Image.Image:
    bbox = image.getchannel("A").getbbox()
    if bbox is None:
        raise ValueError("Image contains no opaque pixels")
    cropped = image.crop(bbox)
    padding = max(8, round(max(cropped.size) * padding_ratio))
    output = Image.new("RGBA", (cropped.width + 2 * padding, cropped.height + 2 * padding))
    output.alpha_composite(cropped, (padding, padding))
    return output


def fit_square(image: Image.Image, size: int, inset_ratio: float = 0.08) -> Image.Image:
    canvas = Image.new("RGBA", (size, size))
    limit = round(size * (1 - 2 * inset_ratio))
    scale = min(limit / image.width, limit / image.height)
    resized = image.resize((round(image.width * scale), round(image.height * scale)), Image.Resampling.LANCZOS)
    canvas.alpha_composite(resized, ((size - resized.width) // 2, (size - resized.height) // 2))
    return canvas


def main() -> None:
    BRAND_DIR.mkdir(parents=True, exist_ok=True)
    mark = crop_with_padding(remove_border_background(Image.open(SOURCE_MARK)))
    wordmark = crop_with_padding(remove_border_background(Image.open(SOURCE_WORDMARK)))
    mark.save(BRAND_DIR / "wafachat-mark.png", optimize=True)
    wordmark.save(BRAND_DIR / "wafachat-wordmark.png", optimize=True)
    icon = fit_square(mark, 512)
    icon.save(ROOT / "app/icon.png", optimize=True)
    fit_square(mark, 180).save(ROOT / "app/apple-icon.png", optimize=True)
    icon.save(ROOT / "app/favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])


if __name__ == "__main__":
    main()
