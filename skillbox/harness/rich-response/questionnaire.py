#!/usr/bin/env python3
"""Author, publish and wait for live questionnaires using only the standard library."""
from __future__ import annotations

import argparse
import html
from html.parser import HTMLParser
import json
import math
from pathlib import Path
import re
import secrets
import shlex
import subprocess
import sys
import time

import server

SKILL_DIR = Path(__file__).resolve().parent
QUESTIONNAIRE_DIR = server.STATE_DIR / "questionnaires"


class Node:
    def __init__(self, tag: str, attrs=()):
        self.tag = tag
        self.attrs = dict(attrs)
        self.children = []

    def find(self, tag: str) -> list[Node]:
        return [node for child in self.children if isinstance(child, Node)
                for node in ([child] if child.tag == tag else []) + child.find(tag)]

    def text(self) -> str:
        return " ".join(child.text() if isinstance(child, Node) else child for child in self.children)


class FragmentParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = Node("root")
        self.stack = [self.root]

    def handle_starttag(self, tag, attrs):
        node = Node(tag, attrs)
        self.stack[-1].children.append(node)
        if tag not in {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}:
            self.stack.append(node)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if self.stack[-1].tag == tag:
            self.stack.pop()

    def handle_endtag(self, tag):
        if self.stack[-1].tag != tag:
            raise ValueError(f"unbalanced HTML near </{tag}>")
        self.stack.pop()

    def handle_data(self, data):
        self.stack[-1].children.append(data)


def wording(node: Node) -> str:
    return " ".join(node.text().split())


def parse_questions(body: str) -> list[dict]:
    parser = FragmentParser()
    parser.feed(body)
    parser.close()
    if len(parser.stack) != 1:
        raise ValueError("unclosed HTML tag")
    forms = parser.root.find("form")
    if len(forms) != 1 or "questionnaire" not in forms[0].attrs.get("class", "").split():
        raise ValueError('use exactly one <form class="questionnaire">')
    form = forms[0]
    if any(key in form.attrs for key in ("action", "method", "onsubmit")):
        raise ValueError("the runtime owns form submission")
    if form.find("button") or form.find("select"):
        raise ValueError("use radio, checkbox or textarea controls; Submit is added automatically")
    questions = []
    used_names = set()
    controls = []
    for fieldset in form.find("fieldset"):
        legends = fieldset.find("legend")
        if fieldset.find("fieldset") or len(legends) != 1 or not wording(legends[0]):
            raise ValueError("each question needs one fieldset and a nonempty legend")
        inputs = fieldset.find("input")
        texts = fieldset.find("textarea")
        notes = [node for node in texts if "data-notes" in node.attrs]
        primary = inputs or [node for node in texts if "data-notes" not in node.attrs]
        if not primary or len(notes) > 1 or (inputs and len(texts) != len(notes)):
            raise ValueError("use one choice group or textarea, plus at most one data-notes textarea")
        kind = primary[0].attrs.get("type") if inputs else "text"
        if kind not in {"radio", "checkbox", "text"} or (kind == "text" and (inputs or len(primary) != 1)):
            raise ValueError("supported controls: radio, checkbox, textarea")
        name = primary[0].attrs.get("name", "")
        if not re.fullmatch(r"[a-zA-Z][a-zA-Z0-9_-]*", name) or name in used_names:
            raise ValueError("questions need unique names containing letters, digits, _ or -")
        used_names.add(name)
        options = {}
        for control in inputs + texts:
            if any(key in control.attrs for key in ("checked", "disabled", "readonly", "form", "autofocus")) or control.text().strip():
                raise ValueError("start every control unanswered and enabled")
            labels = [label for label in fieldset.find("label") if control in label.find(control.tag)]
            if len(labels) != 1 or not wording(labels[0]):
                raise ValueError("wrap each control in a label with human-readable wording")
            if control in primary:
                if control.attrs.get("name") != name or (inputs and control.attrs.get("type") != kind):
                    raise ValueError("a fieldset must contain a single named choice group")
                if inputs:
                    value = control.attrs.get("value", "")
                    if not value or value in options:
                        raise ValueError("choices need distinct nonempty values")
                    options[value] = wording(labels[0])
                    if kind == "checkbox" and "required" in control.attrs:
                        raise ValueError("use data-required on the fieldset for checkbox groups")
            elif "required" in control.attrs:
                raise ValueError("notes must be optional")
        if notes:
            note_name = notes[0].attrs.get("name", "")
            if not re.fullmatch(r"[a-zA-Z][a-zA-Z0-9_-]*", note_name) or note_name in used_names:
                raise ValueError("notes need their own unique name")
            used_names.add(note_name)
        questions.append({"name": name, "question": wording(legends[0]), "kind": kind,
                          "required": "data-required" in fieldset.attrs or any("required" in c.attrs for c in primary),
                          "options": options, "notes": notes[0].attrs["name"] if notes else None})
        controls.extend(inputs + texts)
    if not questions or set(controls) != set(form.find("input") + form.find("textarea")):
        raise ValueError("put all answer controls inside question fieldsets")
    return questions


def answer_markdown(metadata: dict, values: object) -> str:
    if not isinstance(values, dict):
        raise ValueError("answers must be an object")
    allowed = {name for q in metadata["questions"] for name in (q["name"], q["notes"]) if name}
    if values.keys() - allowed:
        raise ValueError("unknown answer field")
    # Escape Markdown syntax so user wording remains literal, including multiline notes.
    def literal(value):
        return re.sub(r"([\\`*_\[\]<>])", r"\\\1", value)
    lines = [f'# {literal(metadata["title"])}', "", f'Questionnaire: {metadata["id"]}', ""]
    for number, q in enumerate(metadata["questions"], 1):
        value = values.get(q["name"], [] if q["kind"] == "checkbox" else "")
        if q["kind"] == "checkbox":
            if not isinstance(value, list) or any(not isinstance(v, str) for v in value) or len(set(value)) != len(value):
                raise ValueError(f'{q["name"]}: expected distinct choices')
            choices = value
        else:
            if not isinstance(value, str):
                raise ValueError(f'{q["name"]}: expected text')
            choices = [value] if value.strip() else []
        if q["required"] and not choices:
            raise ValueError(f'{q["question"]}: an answer is required')
        if q["kind"] != "text" and any(v not in q["options"] for v in choices):
            raise ValueError(f'{q["name"]}: unknown choice')
        lines.extend([f'## {number}. {literal(q["question"])}', ""])
        if q["kind"] == "text":
            lines.extend(["> " + literal(line) for line in value.strip().splitlines()] or ["Not answered."])
        else:
            lines.extend([f'- {literal(q["options"][v])}' for v in q["options"] if v in choices] or ["No selection."])
        if q["notes"]:
            note = values.get(q["notes"], "")
            if not isinstance(note, str):
                raise ValueError("notes must be text")
            if note.strip():
                lines.extend(["", "Notes:", *["> " + literal(line) for line in note.strip().splitlines()]])
        lines.append("")
    return "\n".join(lines)


def render(title: str, body: str, open_browser: bool) -> dict:
    questions = parse_questions(body)
    identifier = secrets.token_hex(16)
    token = secrets.token_urlsafe(32)
    directory = QUESTIONNAIRE_DIR / identifier
    directory.mkdir(parents=True, mode=0o700)
    answer = directory / "answers.md"
    metadata = {"id": identifier, "token": token, "title": title, "questions": questions}
    (directory / "questionnaire.json").write_text(json.dumps(metadata), encoding="utf-8")
    template = (SKILL_DIR / "template.html").read_text()
    style = (SKILL_DIR / "questionnaire.css").read_text()
    script = (SKILL_DIR / "questionnaire.js").read_text()
    config = json.dumps({"endpoint": f"/api/answers/{identifier}/{token}", "questions": questions}).replace("<", "\\u003c")
    document = template.replace("{{TITLE}}", html.escape(title)).replace("{{BODY}}", body)
    document = document.replace("</head>", f"<style>{style}</style></head>")
    document = document.replace("</body>", f'<script id="questionnaire-config" type="application/json">{config}</script><script>{script}</script></body>')
    output = directory / f"questionnaire-{identifier}.html"
    output.write_text(document, encoding="utf-8")
    subprocess.run([str(SKILL_DIR / "validate.sh"), str(output)], check=True, stdout=sys.stderr)
    urls = server.publish(str(output), open_browser=open_browser)
    return {"id": identifier, "answerPath": str(answer), "htmlPath": str(output), **urls,
            "waitCommand": f"python3 {shlex.quote(str(Path(__file__).resolve()))} wait {shlex.quote(str(answer))} --timeout 60"}


def wait_for_answer(path: Path, timeout: float) -> int:
    deadline = time.monotonic() + timeout
    while True:
        try:
            content = path.read_text(encoding="utf-8")
        except FileNotFoundError:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                print(f"pending: {path}", file=sys.stderr)
                return 2
            time.sleep(min(0.25, remaining))
        else:
            print(content, end="")
            return 0


def timeout_seconds(value: str) -> float:
    seconds = float(value)
    if not math.isfinite(seconds) or seconds < 0:
        raise argparse.ArgumentTypeError("timeout must be a finite nonnegative number")
    return seconds


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    create = sub.add_parser("render", help="read a semantic HTML fragment on stdin; print JSON receipt")
    create.add_argument("title")
    create.add_argument("--no-open", action="store_true")
    wait = sub.add_parser("wait", help="print completed Markdown; exit 2 if still pending at timeout")
    wait.add_argument("answer_path", type=Path)
    wait.add_argument("--timeout", type=timeout_seconds, default=60)
    args = parser.parse_args()
    if args.command == "render":
        print(json.dumps(render(args.title, sys.stdin.read(), not args.no_open), indent=2))
    else:
        sys.exit(wait_for_answer(args.answer_path, args.timeout))


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, RuntimeError, subprocess.CalledProcessError) as error:
        raise SystemExit(f"questionnaire: {error}") from error
