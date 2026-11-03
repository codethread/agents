"""Pure authoring and answer-contract regressions; no server or browser needed."""
import unittest

from questionnaire import answer_markdown, parse_questions

BODY = '''<form class="questionnaire">
<fieldset><legend>Which direction?</legend>
<label><input type="radio" name="direction" value="keep" required>Keep it simple</label>
<label><input type="radio" name="direction" value="discuss">Let's discuss</label>
<label>Notes<textarea name="notes" data-notes></textarea></label></fieldset>
<fieldset data-required><legend>Priorities?</legend>
<label><input type="checkbox" name="priorities" value="phone">Phone access</label>
<label><input type="checkbox" name="priorities" value="file">Readable Markdown</label></fieldset>
<fieldset><legend>Anything else?</legend><label>Thoughts<textarea name="thoughts"></textarea></label></fieldset>
</form>'''


class QuestionnaireTests(unittest.TestCase):
    def metadata(self):
        return {"id": "unique-questionnaire", "title": "Alignment", "questions": parse_questions(BODY)}

    def test_markdown_contains_wording_choices_and_multiline_notes(self):
        result = answer_markdown(self.metadata(), {
            "direction": "discuss", "priorities": ["file", "phone"],
            "notes": "A different approach.\nConsider the phone.", "thoughts": "Yes → next step.",
        })
        self.assertEqual(result, """# Alignment

Questionnaire: unique-questionnaire

## 1. Which direction?

- Let's discuss

Notes:
> A different approach.
> Consider the phone.

## 2. Priorities?

- Phone access
- Readable Markdown

## 3. Anything else?

> Yes → next step.
""")

    def test_server_rejects_invalid_or_missing_answers(self):
        valid = {"direction": "keep", "priorities": ["phone"]}
        for invalid in [None, {}, {**valid, "direction": "invented"},
                        {**valid, "direction": ["keep"]}, {**valid, "priorities": []},
                        {**valid, "priorities": ["phone", "phone"]},
                        {**valid, "priorities": "phone"}, {**valid, "priorities": [1]},
                        {**valid, "notes": []}, {**valid, "extra": "surprise"}]:
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                answer_markdown(self.metadata(), invalid)

    def test_optional_answers_are_explicit_and_text_stays_literal(self):
        result = answer_markdown(self.metadata(), {"direction": "keep", "priorities": ["phone"]})
        self.assertIn("Not answered.", result)
        result = answer_markdown(self.metadata(), {"direction": "keep", "priorities": ["phone"], "thoughts": "<script>\n**words**"})
        self.assertIn("> \\<script\\>\n> \\*\\*words\\*\\*", result)

    def test_malformed_authoring_fails_before_publication(self):
        for invalid in [BODY.replace(' required', ' checked'),
                        BODY.replace('name="thoughts"', 'name="direction"'),
                        BODY.replace('value="discuss"', 'value="keep"'),
                        BODY.replace('</fieldset>', '', 1),
                        BODY.replace('name="priorities"', 'name="priorities" required'),
                        BODY.replace('<textarea name="thoughts"></textarea>', '<textarea name="thoughts">default</textarea>'),
                        BODY.replace('<form class="questionnaire">', '<form>')]:
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                parse_questions(invalid)

    def test_human_labels_include_nested_context_with_spacing(self):
        questions = parse_questions(BODY.replace('Keep it simple</label>', 'Keep it simple<small>Recommended</small></label>'))
        self.assertEqual(questions[0]["options"]["keep"], "Keep it simple Recommended")


if __name__ == "__main__":
    unittest.main()
