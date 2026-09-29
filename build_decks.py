#!/usr/bin/env python3
"""Build flashcard decks:  decks/src/**/*.tsv (or *.txt)  ->  decks/<id>.json + decks/index.json

HIERARCHY  Subject > Topic > Deck.  Source files live in one folder per subject and topic:

    decks/src/<subject-slug>/<topic-slug>/NN-name.tsv
    e.g. decks/src/eng205/middle-ages-intro/01-definitions.tsv

HOW TO ADD A SUBJECT / TOPIC / DECK
  * New deck:    drop a TSV into the topic folder, named NN-name.tsv (NN = position 1..n in the topic).
  * New topic:   make a new folder under the subject (course), e.g. decks/src/eng205/renaissance/.
  * New subject: make a new folder under decks/src, e.g. decks/src/mat101/limits/01-basics.tsv.
  Then run  python3 build_decks.py  and commit decks/ (the JSON is what the site serves).
  Subject/topic names are inferred from folder names ("math" -> "Math", "calc1-limits" -> "Calc1 Limits");
  add '# subject:' / '# topic:' headers for nicer names (headers always win over folders),
  e.g. '# subject: ENG-205' and '# topic: Middle Ages Intro'.  Folder names become the URL: #/eng205/middle-ages-intro.
  Files outside a subject folder (or without a subject header) go under subject "Other" / topic "Other".

Source file format (one card per line):   term<TAB>definition
Optional header lines at the top of the file (all optional):
    # subject: ENG-205                          (course; top level on the home screen; default = folder name or "Other")
    # topic:   Middle Ages Intro                (group inside the subject; default = folder name or "Other")
    # title:   ENG-205 Middle Ages Intro — 1 Definitions
    # short:   1 Definitions                    (label inside the topic)
    # order:   1                                (sort within topic; default = last number in filename)
    # expect:  26                               (build fails if card count differs)
    # id:      eng205-01-definitions            (deck id = saved-progress key; default = <topic-slug>-<filename>)
Other lines starting with '#' and blank lines are ignored.
Deck ids must be unique and should never change once you've studied a deck (progress is keyed by id).

index.json layout:
    {"subjects": [{"name","slug","topics": [{"name","slug","decks": [{id,title,short,order,count,file,...}]}]}],
     "decks": [flat list of every deck, each with subject/subjectSlug/topic/topicSlug]}
"""
import json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC, OUT = ROOT / "decks" / "src", ROOT / "decks"
RESERVED = {"deck", "misses", "import"}  # used by app routes (#/deck/..., #/misses, #/import)


def slugify(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-") or "other"


def from_folder(name):
    return name.replace("-", " ").replace("_", " ").strip().title()


def parse(path):
    rel = path.relative_to(SRC)
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
            errors.append(f"{rel}:{n}: no TAB separator")
            continue
        term, definition = line.split("\t", 1)
        term, definition = term.strip(), definition.strip()
        if not term or not definition:
            errors.append(f"{rel}:{n}: empty term or definition")
            continue
        cards.append({"id": f"c{len(cards)}", "term": term, "def": definition})
    return meta, cards, errors


def main():
    files = sorted(p for p in SRC.rglob("*") if p.is_file() and p.suffix.lower() in (".tsv", ".txt"))
    decks, problems, seen = [], [], {}
    for p in files:
        meta, cards, errors = parse(p)
        rel = p.relative_to(SRC)
        problems += errors
        folders = rel.parts[:-1]
        subj_dir = folders[0] if len(folders) >= 1 else None
        topic_dir = folders[1] if len(folders) >= 2 else None
        subject = meta.get("subject") or (from_folder(subj_dir) if subj_dir else "Other")
        topic = meta.get("topic") or (from_folder(topic_dir) if topic_dir else "Other")
        stem = slugify(p.stem)
        deck_id = slugify(meta["id"]) if meta.get("id") else (f"{slugify(topic_dir)}-{stem}" if topic_dir else stem)
        if deck_id in seen:
            problems.append(f"{rel}: duplicate deck id '{deck_id}' (also {seen[deck_id]}) - add a '# id:' header")
            continue
        seen[deck_id] = rel
        nums = re.findall(r"\d+", p.stem)
        order = int(meta.get("order") or (nums[-1] if nums else 999))
        title = meta.get("title") or p.stem.replace("-", " ").title()
        short = meta.get("short") or title
        if "expect" in meta and int(meta["expect"]) != len(cards):
            problems.append(f"{rel}: expected {meta['expect']} cards, got {len(cards)}")
        deck = {"id": deck_id, "title": title, "subject": subject, "topic": topic, "short": short,
                "order": order, "count": len(cards), "cards": cards}
        (OUT / f"{deck_id}.json").write_text(json.dumps(deck, ensure_ascii=False, indent=1), encoding="utf-8")
        decks.append((deck, subj_dir, topic_dir))
        print(f"  {deck_id:28s} {len(cards):3d} cards  [{subject} > {topic}] {title}")

    # Build subjects -> topics -> decks. Slug = folder name when the deck lives in that folder, else slug of the name.
    subjects = {}
    for deck, sdir, tdir in decks:
        s = subjects.setdefault(deck["subject"].lower(), {"name": deck["subject"], "slug": None, "topics": {}})
        s["slug"] = s["slug"] or (slugify(sdir) if sdir else None)
        t = s["topics"].setdefault(deck["topic"].lower(), {"name": deck["topic"], "slug": None, "decks": []})
        t["slug"] = t["slug"] or (slugify(tdir) if tdir else None)
        t["decks"].append(deck)
    out_subjects, flat, used = [], [], set()
    for s in sorted(subjects.values(), key=lambda s: (s["name"] == "Other", s["name"].lower())):
        s["slug"] = s["slug"] or slugify(s["name"])
        if s["slug"] in RESERVED or s["slug"] in used:
            s["slug"] += "-subject"
        used.add(s["slug"])
        topics, tused = [], set()
        for t in sorted(s["topics"].values(), key=lambda t: (t["name"] == "Other", t["name"].lower())):
            t["slug"] = t["slug"] or slugify(t["name"])
            while t["slug"] in tused:
                t["slug"] += "-2"
            tused.add(t["slug"])
            entries = []
            for d in sorted(t["decks"], key=lambda d: (d["order"], d["id"])):
                e = {k: d[k] for k in ("id", "title", "short", "order", "count")} | {"file": f"{d['id']}.json"}
                entries.append(e)
                flat.append(e | {"subject": s["name"], "subjectSlug": s["slug"], "topic": t["name"], "topicSlug": t["slug"]})
            topics.append({"name": t["name"], "slug": t["slug"], "count": sum(e["count"] for e in entries), "decks": entries})
        out_subjects.append({"name": s["name"], "slug": s["slug"], "count": sum(t["count"] for t in topics), "topics": topics})
    (OUT / "index.json").write_text(json.dumps({"subjects": out_subjects, "decks": flat}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"Wrote {len(flat)} decks in {len(out_subjects)} subject(s) to decks/index.json")
    for s in out_subjects:
        print(f"  {s['name']} (#/{s['slug']}): " + ", ".join(f"{t['name']} (#/{s['slug']}/{t['slug']}, {len(t['decks'])} decks)" for t in s["topics"]))
    if problems:
        print("PROBLEMS:\n  " + "\n  ".join(problems), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
