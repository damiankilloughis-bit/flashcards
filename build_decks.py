#!/usr/bin/env python3
"""Build flashcard decks: decks/src/*.tsv (or *.txt)  ->  decks/<id>.json + decks/index.json

Source file format (one card per line):   term<TAB>definition
Optional header lines at the top of the file (all optional):
    # title:  ENG-205 Middle Ages Intro — 1 Definitions
    # topic:  ENG-205 Middle Ages Intro        (home screen group)
    # short:  1 Definitions                     (label inside the group)
    # order:  1                                 (sort within topic; default = last number in filename)
    # expect: 28                                (build fails if card count differs)
Other lines starting with '#' and blank lines are ignored.
Deck id = filename without extension.  Run:  python3 build_decks.py
"""
import json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC, OUT = ROOT / "decks" / "src", ROOT / "decks"


def parse(path):
    meta, cards, errors = {}, [], []
    for n, raw in enumerate(path.read_text(encoding="utf-8-sig").splitlines(), 1):
        line = raw.rstrip("\r\n")
        if not line.strip():
            continue
        m = re.match(r"^#\s*(\w+)\s*:\s*(.*)$", line)
        if m:
            meta[m.group(1).lower()] = m.group(2).strip()
            continue
        if line.startswith("#"):
            continue
        if "\t" not in line:
            errors.append(f"{path.name}:{n}: no TAB separator")
            continue
        term, definition = line.split("\t", 1)
        term, definition = term.strip(), definition.strip()
        if not term or not definition:
            errors.append(f"{path.name}:{n}: empty term or definition")
            continue
        cards.append({"id": f"c{len(cards)}", "term": term, "def": definition})
    return meta, cards, errors


def main():
    files = sorted(p for p in SRC.iterdir() if p.suffix.lower() in (".tsv", ".txt"))
    manifest, problems = [], []
    for p in files:
        meta, cards, errors = parse(p)
        problems += errors
        deck_id = re.sub(r"[^a-z0-9-]+", "-", p.stem.lower()).strip("-")
        nums = re.findall(r"\d+", p.stem)
        order = int(meta.get("order") or (nums[-1] if nums else 999))
        title = meta.get("title") or p.stem.replace("-", " ").title()
        topic = meta.get("topic") or "Other"
        short = meta.get("short") or title
        if "expect" in meta and int(meta["expect"]) != len(cards):
            problems.append(f"{p.name}: expected {meta['expect']} cards, got {len(cards)}")
        deck = {"id": deck_id, "title": title, "topic": topic, "short": short,
                "order": order, "count": len(cards), "cards": cards}
        (OUT / f"{deck_id}.json").write_text(json.dumps(deck, ensure_ascii=False, indent=1), encoding="utf-8")
        manifest.append({k: deck[k] for k in ("id", "title", "topic", "short", "order", "count")} | {"file": f"{deck_id}.json"})
        print(f"  {deck_id:28s} {len(cards):3d} cards  [{topic}] {title}")
    manifest.sort(key=lambda d: (d["topic"], d["order"], d["id"]))
    (OUT / "index.json").write_text(json.dumps({"decks": manifest}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"Wrote {len(manifest)} decks to decks/index.json")
    if problems:
        print("PROBLEMS:\n  " + "\n  ".join(problems), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
