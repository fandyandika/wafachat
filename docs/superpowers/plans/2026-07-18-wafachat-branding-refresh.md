# WaFaChat Branding Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every runtime Pustaka Islam/Bot brand treatment with the supplied WaFaChat identity and ship transparent production assets plus a new favicon.

**Architecture:** Preserve the two supplied PNGs as immutable brand sources and use a small Pillow-based build helper to remove only border-connected white pixels, crop transparent whitespace, and derive web/icon sizes. Runtime components consume stable files from `public/brand`, while Next.js file conventions provide the browser and Apple icons from `app`.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript, Tailwind CSS, Python 3 with Pillow for deterministic asset processing, Vitest/build checks.

## Global Constraints

- WaFaChat is the sole runtime product identity; Pustaka Islam is a client and must not appear in runtime UI branding.
- Preserve the supplied logo mark, typography, colors, proportions, and internal white details.
- Do not use generative image editing and do not redraw the logo as SVG.
- Remove only the near-white background connected to the image boundary.
- Visible logo images use `alt="WaFaChat"` and retain their intrinsic aspect ratio.
- Do not redesign the application color system, navigation, or general layout.
- Do not remove historical Pustaka Islam references from internal documentation or tenant data.

---

## File Structure

- `assets/logo/logo-apps-1.png` — supplied, immutable app-mark source.
- `assets/logo/logo-apps-2.png` — supplied, immutable horizontal-wordmark source.
- `scripts/prepare-brand-assets.py` — deterministic alpha extraction, crop, resize, and icon writer.
- `scripts/test_prepare_brand_assets.py` — unit coverage proving edge-connected white is removed while enclosed white remains opaque.
- `public/brand/wafachat-mark.png` — transparent compact mark used by UI.
- `public/brand/wafachat-wordmark.png` — transparent horizontal lockup used by UI.
- `app/icon.png` — 512×512 Next.js app/browser icon.
- `app/apple-icon.png` — 180×180 Apple touch icon.
- `app/favicon.ico` — multi-resolution 16/32/48 pixel browser favicon.
- `app/layout.tsx` — metadata title, description, and explicit icon declarations.
- `app/login/page.tsx` — WaFaChat wordmark login treatment.
- `app/panel/layout.tsx` — WaFaChat sidebar/header branding.

---

### Task 1: Deterministic Brand Asset Pipeline

**Files:**
- Create: `scripts/test_prepare_brand_assets.py`
- Create: `scripts/prepare-brand-assets.py`
- Create: `public/brand/wafachat-mark.png`
- Create: `public/brand/wafachat-wordmark.png`
- Create: `app/icon.png`
- Create: `app/apple-icon.png`
- Create: `app/favicon.ico`
- Track: `assets/logo/logo-apps-1.png`
- Track: `assets/logo/logo-apps-2.png`

**Interfaces:**
- Consumes: the two supplied 1254×1254 RGB PNG source files.
- Produces: `remove_border_background(image: Image.Image, threshold: int = 238) -> Image.Image`, `crop_with_padding(image: Image.Image, padding_ratio: float = 0.06) -> Image.Image`, and stable runtime asset paths listed above.

- [ ] **Step 1: Write the failing alpha-extraction unit test**

Create `scripts/test_prepare_brand_assets.py`:

```python
import importlib.util
import unittest
from pathlib import Path

from PIL import Image, ImageDraw

MODULE_PATH = Path(__file__).with_name("prepare-brand-assets.py")
SPEC = importlib.util.spec_from_file_location("prepare_brand_assets", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


class BrandAssetTests(unittest.TestCase):
    def test_removes_border_white_but_preserves_enclosed_white(self):
        source = Image.new("RGB", (40, 40), "white")
        draw = ImageDraw.Draw(source)
        draw.rectangle((8, 8, 31, 31), fill=(20, 25, 28))
        draw.rectangle((15, 15, 24, 24), fill="white")

        result = MODULE.remove_border_background(source)

        self.assertEqual(result.getpixel((0, 0))[3], 0)
        self.assertEqual(result.getpixel((10, 10))[3], 255)
        self.assertEqual(result.getpixel((20, 20)), (255, 255, 255, 255))

    def test_crop_adds_transparent_padding(self):
        source = Image.new("RGBA", (40, 40), (0, 0, 0, 0))
        ImageDraw.Draw(source).rectangle((10, 12, 29, 27), fill=(20, 25, 28, 255))

        result = MODULE.crop_with_padding(source, padding_ratio=0.1)

        self.assertGreater(result.width, 20)
        self.assertGreater(result.height, 16)
        self.assertEqual(result.getpixel((0, 0))[3], 0)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the test and verify the missing processor failure**

Run: `python -m unittest scripts/test_prepare_brand_assets.py -v`

Expected: FAIL because `scripts/prepare-brand-assets.py` does not exist.

- [ ] **Step 3: Implement the processor**

Create `scripts/prepare-brand-assets.py` with these behaviors:

```python
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
```

- [ ] **Step 4: Run tests, generate assets, and validate alpha**

Run:

```powershell
python -m unittest scripts/test_prepare_brand_assets.py -v
python scripts/prepare-brand-assets.py
python -c "from PIL import Image; from pathlib import Path; files=['public/brand/wafachat-mark.png','public/brand/wafachat-wordmark.png','app/icon.png','app/apple-icon.png']; [(lambda im,p: print(p,im.size,im.mode,im.getpixel((0,0))[3]))(Image.open(p),p) for p in files]"
```

Expected: two tests PASS; every reported image is RGBA with corner alpha `0`; icon sizes are `(512, 512)` and `(180, 180)`.

- [ ] **Step 5: Visually inspect both transparent runtime assets**

Open `public/brand/wafachat-mark.png` and `public/brand/wafachat-wordmark.png` on the checkerboard/image viewer. Confirm the outer background is transparent, the internal `W` stays opaque white, and no wide white fringe remains.

- [ ] **Step 6: Commit the asset pipeline and outputs**

```powershell
git add assets/logo/logo-apps-1.png assets/logo/logo-apps-2.png scripts/prepare-brand-assets.py scripts/test_prepare_brand_assets.py public/brand/wafachat-mark.png public/brand/wafachat-wordmark.png app/icon.png app/apple-icon.png app/favicon.ico
git commit -m "feat(brand): add WaFaChat production assets"
```

---

### Task 2: Replace Runtime Branding and Register Icons

**Files:**
- Modify: `app/layout.tsx:10-13`
- Modify: `app/login/page.tsx:1-43`
- Modify: `app/panel/layout.tsx:1-126`

**Interfaces:**
- Consumes: `/brand/wafachat-mark.png`, `/brand/wafachat-wordmark.png`, `/favicon.ico`, `/icon.png`, and `/apple-icon.png` from Task 1.
- Produces: runtime UI with WaFaChat as the only product brand and Next.js metadata pointing to the new icons.

- [ ] **Step 1: Record the pre-change acceptance failure**

Run: `rg -n "Pustaka|<Bot|Bot," app --glob "*.tsx"`

Expected: matches in `app/login/page.tsx` and `app/panel/layout.tsx`.

- [ ] **Step 2: Register explicit icon metadata**

Update the metadata in `app/layout.tsx`:

```tsx
export const metadata: Metadata = {
  title: 'WaFaChat',
  description: 'WaFaChat CS Control Panel',
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/icon.png', type: 'image/png', sizes: '512x512' },
    ],
    apple: [{ url: '/apple-icon.png', type: 'image/png', sizes: '180x180' }],
  },
};
```

- [ ] **Step 3: Replace login branding**

In `app/login/page.tsx`, remove the `Bot` import. Replace the icon and Pustaka Islam heading with:

```tsx
{/* eslint-disable-next-line @next/next/no-img-element */}
<img
  src="/brand/wafachat-wordmark.png"
  alt="WaFaChat"
  className="mx-auto h-16 w-auto max-w-[260px] object-contain"
/>
<p className="mt-2 text-sm text-muted-foreground">CS AI Panel</p>
```

- [ ] **Step 4: Replace sidebar branding**

In `app/panel/layout.tsx`, remove `Bot` from the Lucide import. Replace the current Bot/text lockup inside the desktop sidebar with:

```tsx
{/* eslint-disable-next-line @next/next/no-img-element */}
<img
  src="/brand/wafachat-wordmark.png"
  alt="WaFaChat"
  className="h-10 w-auto max-w-full object-contain object-left"
/>
```

- [ ] **Step 5: Replace panel header branding**

Replace the Pustaka Islam image and `via WaFaChat` copy in the panel header with:

```tsx
<span className="hidden h-6 w-px bg-border sm:block" />
{/* eslint-disable-next-line @next/next/no-img-element */}
<img
  src="/brand/wafachat-wordmark.png"
  alt="WaFaChat"
  className="hidden h-6 w-auto max-w-[140px] object-contain sm:block"
/>
```

- [ ] **Step 6: Run focused acceptance and build checks**

Run:

```powershell
rg -n "Pustaka|<Bot|Bot," app --glob "*.tsx"
npm run build
```

Expected: `rg` returns no matches and the Next.js production build exits `0`.

- [ ] **Step 7: Commit runtime branding**

```powershell
git add app/layout.tsx app/login/page.tsx app/panel/layout.tsx
git commit -m "feat(brand): apply WaFaChat identity across app"
```

---

### Task 3: Browser-Level Visual Verification

**Files:**
- Modify only if a verified layout defect is found: `app/login/page.tsx`, `app/panel/layout.tsx`, or `scripts/prepare-brand-assets.py` plus regenerated outputs.

**Interfaces:**
- Consumes: the completed branding assets and runtime UI from Tasks 1–2.
- Produces: evidence that transparent branding, responsive placement, and favicon rendering work in the built application.

- [ ] **Step 1: Start the application locally**

Run: `npm run dev`

Expected: Next.js reports a local URL and serves the login route without compilation errors.

- [ ] **Step 2: Inspect the login at desktop and mobile widths**

Open `/login` at 1440×900 and 390×844. Confirm the horizontal wordmark is centered, undistorted, has no white rectangle, and the form layout remains unchanged.

- [ ] **Step 3: Inspect authenticated panel branding where credentials/session are available**

Open `/panel` at 1440×900 and 390×844. Confirm the desktop sidebar wordmark fits within 256 px, the header mark does not collide with the title/filters, and the mobile bottom navigation retains its original space. If local authentication is unavailable, verify the rendered source/styles plus the successful production build and report the limitation explicitly.

- [ ] **Step 4: Verify browser icon requests**

Confirm `/favicon.ico`, `/icon.png`, and `/apple-icon.png` return HTTP 200. Inspect the browser tab to confirm the WaFaChat app mark appears rather than the old/default icon.

- [ ] **Step 5: Apply and verify any narrowly scoped visual correction**

If a defect is observed, change only the affected sizing/crop class or asset threshold, rerun `python -m unittest scripts/test_prepare_brand_assets.py -v` when asset processing changes, and rerun `npm run build`.

- [ ] **Step 6: Final repository audit**

Run:

```powershell
rg -n "Pustaka|<Bot|Bot," app components public --glob "*.tsx" --glob "*.ts"
git status --short
```

Expected: no runtime branding matches; status contains no unintended files. Preserve unrelated pre-existing user changes.

