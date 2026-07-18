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
