import re

LINE_RE = re.compile(r"^(\d{1,2}):(\d{2})\s*[-–—]\s*(\d{1,2}):(\d{2})$")
TIME_RE = re.compile(r"^(\d{1,2}):(\d{2})$")


class ScheduleError(ValueError):
    pass


def _hm(h: int, m: int, where: str) -> str:
    if h > 23 or m > 59:
        raise ScheduleError(f"{where}: некорректное время {h}:{m:02d}")
    return f"{h:02d}:{m:02d}"


def normalize_time(value: str, where: str = "Время") -> str:
    m = TIME_RE.match(value.strip())
    if not m:
        raise ScheduleError(f"{where}: ожидается формат HH:MM")
    return _hm(int(m[1]), int(m[2]), where)


def normalize_breaks(items: list[tuple[str, str]]) -> list[tuple[str, str]]:
    result = []
    for i, (start, end) in enumerate(items, 1):
        s = normalize_time(start, f"Перемена {i}")
        e = normalize_time(end, f"Перемена {i}")
        if s >= e:
            raise ScheduleError(f"Перемена {s}-{e}: начало должно быть раньше конца")
        result.append((s, e))
    result.sort()
    for (s1, e1), (s2, e2) in zip(result, result[1:]):
        if s2 < e1:
            raise ScheduleError(f"Перемены {s1}-{e1} и {s2}-{e2} пересекаются")
    return result


def parse_schedule(text: str) -> list[tuple[str, str]]:
    items = []
    for n, raw in enumerate(text.splitlines(), 1):
        line = raw.strip().lstrip("﻿")
        if not line or line.startswith("#"):
            continue
        m = LINE_RE.match(line)
        if not m:
            raise ScheduleError(f"Строка {n}: «{line}» — ожидается формат HH:MM-HH:MM")
        where = f"Строка {n}"
        items.append((_hm(int(m[1]), int(m[2]), where), _hm(int(m[3]), int(m[4]), where)))
    return normalize_breaks(items)


def format_schedule(items: list[tuple[str, str]]) -> str:
    return "".join(f"{s}-{e}\n" for s, e in items)
