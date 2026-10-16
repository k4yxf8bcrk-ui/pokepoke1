#!/usr/bin/env python3
import argparse
import json
import re
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE = "https://slo-navi.com/data/{date}-12100/"
KEYWORD = "\u30b8\u30e3\u30b0\u30e9\u30fc"
DATA_PATH = Path("data.json")
JST = timezone(timedelta(hours=9))


def to_num(value):
    if value is None:
        return 0
    s = str(value).strip().replace(",", "").replace("＋", "+").replace("−", "-")
    s = re.sub(r"[^0-9+\-.]", "", s)
    if s in ("", "+", "-", "."):
        return 0
    try:
        return int(float(s))
    except ValueError:
        return 0


def clean_text(value):
    return re.sub(r"\s+", " ", str(value or "")).strip()


def parse_full_table(soup, date):
    records = []
    seen = set()
    for tr in soup.find_all("tr"):
        cells = [clean_text(x.get_text(" ", strip=True)) for x in tr.find_all(["th", "td"])]
        if len(cells) < 6:
            continue
        model = cells[0]
        if KEYWORD not in model:
            continue
        no = re.sub(r"\D", "", cells[1])
        if not no:
            continue
        games = to_num(cells[2])
        diff = to_num(cells[3])
        bb = to_num(cells[4])
        rb = to_num(cells[5])
        key = (date, no)
        if key in seen:
            continue
        seen.add(key)
        records.append({
            "date": date,
            "machineNo": no,
            "machine": model,
            "games": games,
            "diff": diff,
            "bb": bb,
            "rb": rb,
        })
    return records


def parse_section_tables(soup, date):
    records = []
    seen = set()
    for table in soup.find_all("table"):
        heading = table.find_previous(["h1", "h2", "h3", "h4", "h5", "strong"])
        model = clean_text(heading.get_text(" ", strip=True)) if heading else ""
        if KEYWORD not in model:
            continue
        for tr in table.find_all("tr"):
            cells = [clean_text(x.get_text(" ", strip=True)) for x in tr.find_all("td")]
            if len(cells) < 5:
                continue
            no = re.sub(r"\D", "", cells[0])
            if not no or "平均" in cells[0]:
                continue
            key = (date, no)
            if key in seen:
                continue
            seen.add(key)
            records.append({
                "date": date,
                "machineNo": no,
                "machine": model,
                "games": to_num(cells[1]),
                "diff": to_num(cells[2]),
                "bb": to_num(cells[3]),
                "rb": to_num(cells[4]),
            })
    return records


def fetch_day(session, date, timeout=25):
    url = BASE.format(date=date)
    try:
        r = session.get(url, timeout=timeout)
    except requests.RequestException as exc:
        print(f"{date}: request error: {exc}")
        return []
    if r.status_code == 404:
        print(f"{date}: not available")
        return []
    if r.status_code != 200:
        print(f"{date}: HTTP {r.status_code}")
        return []
    soup = BeautifulSoup(r.text, "html.parser")
    records = parse_full_table(soup, date)
    if not records:
        records = parse_section_tables(soup, date)
    print(f"{date}: {len(records)} rows")
    return records


def load_existing():
    if not DATA_PATH.exists():
        return []
    try:
        obj = json.loads(DATA_PATH.read_text(encoding="utf-8"))
        if isinstance(obj, list):
            return obj
        if isinstance(obj, dict) and isinstance(obj.get("records"), list):
            return obj["records"]
    except Exception as exc:
        print(f"existing data read error: {exc}")
    return []


def merge(existing, incoming):
    merged = {}
    for row in existing + incoming:
        date = str(row.get("date", ""))
        no = str(row.get("machineNo", ""))
        if not date or not no:
            continue
        merged[(date, no)] = {
            "date": date,
            "machineNo": no,
            "machine": str(row.get("machine", "Unknown")),
            "games": to_num(row.get("games")),
            "diff": to_num(row.get("diff")),
            "bb": to_num(row.get("bb")),
            "rb": to_num(row.get("rb")),
        }
    return sorted(merged.values(), key=lambda x: (x["date"], int(x["machineNo"]) if x["machineNo"].isdigit() else x["machineNo"]))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=4, help="lookback including today")
    ap.add_argument("--start", default="")
    ap.add_argument("--end", default="")
    ap.add_argument("--delay", type=float, default=1.35)
    args = ap.parse_args()

    today = datetime.now(JST).date()
    if args.end:
        end = datetime.strptime(args.end, "%Y-%m-%d").date()
    else:
        end = today
    if args.start:
        start = datetime.strptime(args.start, "%Y-%m-%d").date()
    else:
        start = end - timedelta(days=max(1, args.days) - 1)
    if start > end:
        raise SystemExit("start must be <= end")

    session = requests.Session()
    session.headers.update({
        "User-Agent": "Mozilla/5.0 (compatible; D-data-refresh/1.0)",
        "Accept-Language": "ja,en;q=0.8",
    })

    existing = load_existing()
    incoming = []
    day = start
    while day <= end:
        incoming.extend(fetch_day(session, day.isoformat()))
        day += timedelta(days=1)
        if day <= end:
            time.sleep(max(0.8, args.delay))

    records = merge(existing, incoming)
    latest = max((x["date"] for x in records), default=None)
    models = sorted({x["machine"] for x in records})
    payload = {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "latestDate": latest,
        "recordCount": len(records),
        "machineCount": len({x["machineNo"] for x in records}),
        "modelCount": len(models),
        "records": records,
    }
    DATA_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"saved: {len(records)} rows / latest={latest} / models={len(models)}")


if __name__ == "__main__":
    main()
