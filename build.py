#!/usr/bin/env python3
"""Inline web/ + data/meals.json into one offline file: dist/family-meal-planner.html."""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))


def rd(rel):
    with open(os.path.join(HERE, rel), encoding="utf-8") as f:
        return f.read()


def main():
    meals_path = os.path.join(HERE, "data", "meals.json")
    with open(meals_path, encoding="utf-8") as f:
        meals = json.load(f)
    meals_js = json.dumps(meals, ensure_ascii=False)
    html = rd("web/index.html")
    html = html.replace("/*__CSS__*/", rd("web/app.css"))
    html = html.replace("/*__MEALS__*/ null /*__/MEALS__*/", meals_js)
    app = rd("web/app.js").replace("</script", "<\\/script")
    html = html.replace("/*__APP__*/", app)
    os.makedirs(os.path.join(HERE, "dist"), exist_ok=True)
    out = os.path.join(HERE, "dist", "family-meal-planner.html")
    with open(out, "w", encoding="utf-8") as f:
        f.write(html)
    n = len(meals.get("meals", []))
    print(f"built {out} ({os.path.getsize(out):,} bytes) · meals={n}")


if __name__ == "__main__":
    main()
