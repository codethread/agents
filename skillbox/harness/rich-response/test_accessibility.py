"""Contrast regressions for the shared text and questionnaire control palettes."""
from pathlib import Path
import re
import unittest


def luminance(color):
    channels = [int(color[index:index + 2], 16) / 255 for index in (1, 3, 5)]
    linear = [value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4
              for value in channels]
    return sum(value * weight for value, weight in zip(linear, (0.2126, 0.7152, 0.0722)))


def contrast(first, second):
    dark, light = sorted((luminance(first), luminance(second)))
    return (light + 0.05) / (dark + 0.05)


class AccessibilityTests(unittest.TestCase):
    def test_shared_palettes_keep_text_and_control_cues_readable(self):
        template = Path(__file__).with_name("template.html").read_text()
        palettes = re.findall(r":root\s*\{([^}]+)\}", template)
        self.assertEqual(len(palettes), 2)
        for theme, declarations in zip(("light", "dark"), palettes):
            colors = dict(re.findall(r"(--[\w-]+):\s*(#[\da-f]{6})", declarations))
            for foreground in ("--fg", "--muted", "--dim", "--link"):
                for background in ("--bg", "--code-bg", "--info-bg"):
                    with self.subTest(theme=theme, foreground=foreground, background=background):
                        self.assertGreaterEqual(contrast(colors[foreground], colors[background]), 4.5)
            for foreground in ("--control-border", "--link"):
                with self.subTest(theme=theme, control=foreground):
                    self.assertGreaterEqual(contrast(colors[foreground], colors["--bg"]), 3)


if __name__ == "__main__":
    unittest.main()
