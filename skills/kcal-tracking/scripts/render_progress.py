#!/usr/bin/env python3
"""Render goal-aware daily nutrition progress bars from kcal CLI data."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from decimal import Decimal, ROUND_FLOOR, ROUND_HALF_UP
from typing import Any

LABELS = {
    "en": {
        "energy_kcal": ("🔥", "Calories", ""),
        "protein_g": ("💪", "Protein", "g"),
        "fat_g": ("🥑", "Fat", "g"),
        "fiber_g": ("🌾", "Fiber", "g"),
    },
    "ru": {
        "energy_kcal": ("🔥", "Ккал", ""),
        "protein_g": ("💪", "Белок", "г"),
        "fat_g": ("🥑", "Жиры", "г"),
        "fiber_g": ("🌾", "Клетчатка", "г"),
    },
}

NO_GOAL = {"en": "goal not set", "ru": "цель не задана"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("date", nargs="?", help="Diary date (YYYY-MM-DD); defaults to today")
    parser.add_argument("--lang", choices=sorted(LABELS), default="en", help="Output language")
    return parser.parse_args()


def run_json(command: list[str]) -> dict[str, Any]:
    result = subprocess.run(command, check=False, text=True, capture_output=True)
    if result.returncode != 0:
        message = result.stderr.strip() or result.stdout.strip() or f"{' '.join(command)} failed"
        raise RuntimeError(message)
    return json.loads(result.stdout)


def load_day(date: str | None) -> dict[str, Any]:
    command = ["kcal", "diary", "day"]
    if date:
        command.append(date)
    return run_json(command)


def load_goals() -> dict[str, Any]:
    return run_json(["kcal", "goal", "show"]).get("goals") or {}


def rounded(value: float, digits: int = 0, rounding: str = ROUND_HALF_UP) -> Decimal:
    quantum = Decimal("1").scaleb(-digits)
    return Decimal(str(value)).quantize(quantum, rounding=rounding)


def decimal(value: float, digits: int = 1, separator: str = ".", floor: bool = False) -> str:
    number = rounded(value, digits, ROUND_FLOOR if floor else ROUND_HALF_UP)
    if digits == 0:
        return str(number)
    text = f"{number:.{digits}f}".rstrip("0").rstrip(".")
    return text.replace(".", separator)


def exact_decimal(value: float, separator: str = ".") -> str:
    text = format(Decimal(str(value)), "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text.replace(".", separator)


def progress(current: float, target: float, minimum: bool = False) -> tuple[str, int]:
    ratio = current / target if target > 0 else 0
    filled = max(0, min(10, int(rounded(ratio * 10))))
    exact_ratio = Decimal(str(current)) / Decimal(str(target)) if target > 0 else Decimal(0)
    percent = int((exact_ratio * 100).quantize(Decimal("1"), rounding=ROUND_FLOOR if minimum else ROUND_HALF_UP))
    return "█" * filled + "░" * (10 - filled), percent


def render_line(icon: str, label: str, current: float, target: float, unit: str, minimum: bool, separator: str) -> str:
    bar, percent = progress(current, target, minimum)
    marker = "≥" if minimum else ""
    digits = 0 if label in {"Calories", "Ккал"} else 1
    value = f"{marker}{decimal(current, digits, separator, floor=minimum)} / {exact_decimal(target, separator)}"
    if unit:
        value += f" {unit}"
    return f"{icon} {label:<10} {bar}  {value} · {marker}{percent}%"


def render_without_goal(icon: str, label: str, current: float, unit: str, minimum: bool, language: str) -> str:
    marker = "≥" if minimum else ""
    digits = 0 if label in {"Calories", "Ккал"} else 1
    separator = "," if language == "ru" else "."
    display_unit = unit or ("ккал" if language == "ru" else "kcal")
    value = decimal(current, digits, separator, floor=minimum)
    return f"{icon} {label:<10} {marker}{value} {display_unit} · {NO_GOAL[language]}"


def render_dashboard(day: dict[str, Any], language: str = "en") -> str:
    labels = LABELS[language]
    totals = day.get("totals") or {}
    goals = day.get("goals") or {}
    incomplete = set(day.get("incomplete_nutrients") or [])
    lines: list[str] = []

    for nutrient in ("energy_kcal", "protein_g", "fat_g", "fiber_g"):
        target = goals.get(nutrient)
        current = totals.get(nutrient)
        if not isinstance(current, (int, float)):
            current = 0
        icon, label, unit = labels[nutrient]
        minimum = nutrient in incomplete
        if not isinstance(target, (int, float)) or target <= 0:
            lines.append(render_without_goal(icon, label, float(current), unit, minimum, language))
            continue
        separator = "," if language == "ru" else "."
        lines.append(render_line(icon, label, float(current), float(target), unit, minimum, separator))

    return "\n".join(lines)


def prepare_day(day: dict[str, Any]) -> dict[str, Any]:
    prepared = dict(day)
    prepared["totals"] = dict(day.get("totals") or {})
    prepared["goals"] = dict(day.get("goals") or load_goals())
    return prepared


def main() -> int:
    args = parse_args()
    try:
        day = prepare_day(load_day(args.date))
        output = render_dashboard(day, language=args.lang)
    except (RuntimeError, json.JSONDecodeError, KeyError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1

    if not output:
        print("No nutrition goals configured." if args.lang == "en" else "Цели питания не настроены.")
        return 0
    print(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
