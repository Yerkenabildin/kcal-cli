#!/usr/bin/env python3
"""Tests for the public skill progress renderer."""

from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path
from unittest.mock import patch


MODULE_PATH = Path(__file__).with_name("render_progress.py")
spec = importlib.util.spec_from_file_location("render_progress", MODULE_PATH)
assert spec is not None
assert spec.loader is not None
render_progress = importlib.util.module_from_spec(spec)
spec.loader.exec_module(render_progress)


class RenderDashboardTest(unittest.TestCase):
    def test_uses_diary_goals_and_includes_fat(self) -> None:
        day = {
            "totals": {
                "energy_kcal": 500,
                "protein_g": 40,
                "fat_g": 20,
                "fiber_g": 10,
            },
            "goals": {
                "energy_kcal": 2000,
                "protein_g": 100,
                "fat_g": 80,
                "fiber_g": 25,
            },
            "incomplete_nutrients": [],
        }

        output = render_progress.render_dashboard(day, language="en")

        self.assertIn("Calories", output)
        self.assertIn("500 / 2000", output)
        self.assertIn("Protein", output)
        self.assertIn("40 / 100 g", output)
        self.assertIn("Fat", output)
        self.assertIn("20 / 80 g", output)
        self.assertIn("Fiber", output)
        self.assertIn("10 / 25 g", output)

    def test_shows_nutrients_without_configured_goals(self) -> None:
        day = {
            "totals": {"energy_kcal": 500, "protein_g": 40, "fat_g": 20},
            "goals": {"energy_kcal": 2000, "protein_g": 100},
            "incomplete_nutrients": [],
        }

        output = render_progress.render_dashboard(day, language="en")

        self.assertIn("Calories", output)
        self.assertIn("Protein", output)
        self.assertIn("Fat        20 g · goal not set", output)
        self.assertIn("Fiber      0 g · goal not set", output)
        fat_line = next(line for line in output.splitlines() if "Fat" in line)
        self.assertNotIn("█", fat_line)
        self.assertNotIn("░", fat_line)
        self.assertNotIn("%", fat_line)

    def test_marks_incomplete_totals_as_lower_bounds(self) -> None:
        day = {
            "totals": {"fiber_g": 7.5},
            "goals": {"fiber_g": 30},
            "incomplete_nutrients": ["fiber_g"],
        }

        output = render_progress.render_dashboard(day, language="en")

        self.assertIn("≥7.5 / 30 g", output)
        self.assertIn("· ≥25%", output)

    def test_incomplete_totals_are_floored_at_display_precision(self) -> None:
        day = {
            "totals": {"fiber_g": 7.46},
            "goals": {"fiber_g": 30},
            "incomplete_nutrients": ["fiber_g"],
        }

        output = render_progress.render_dashboard(day, language="en")

        self.assertIn("≥7.4 / 30 g", output)
        self.assertIn("· ≥24%", output)

    def test_prepare_day_uses_snapshot_fiber_without_catalog_lookup(self) -> None:
        day = {
            "totals": {"fiber_g": 7.46},
            "goals": {"fiber_g": 30},
            "incomplete_nutrients": ["fiber_g"],
            "meals": {
                "dinner": [
                    {
                        "item_id": "r::mutable-recipe",
                        "amount": 100,
                        "unit": "g",
                        "nutrients": {},
                    }
                ]
            },
        }

        with patch.object(render_progress, "run_json", side_effect=AssertionError("catalog lookup")):
            prepared = render_progress.prepare_day(day)

        self.assertEqual(prepared["totals"]["fiber_g"], 7.46)
        self.assertIn("fiber_g", prepared["incomplete_nutrients"])

    def test_preserves_fractional_target_and_uses_it_for_percentage(self) -> None:
        day = {
            "totals": {"fat_g": 31.25},
            "goals": {"fat_g": 62.5},
            "incomplete_nutrients": [],
        }

        output = render_progress.render_dashboard(day, language="en")

        self.assertIn("31.3 / 62.5 g", output)
        self.assertIn("· 50%", output)

    def test_russian_output_uses_decimal_comma(self) -> None:
        day = {
            "totals": {"protein_g": 36.2},
            "goals": {"protein_g": 160},
            "incomplete_nutrients": [],
        }

        output = render_progress.render_dashboard(day, language="ru")

        self.assertIn("36,2 / 160 г", output)


if __name__ == "__main__":
    unittest.main()
