"""Editing a rule.

A rule is a standing exception: "שבת הגדול has a different Mincha because of the drasha",
said once and reapplied every year, as against an override, which is a one-off on one sheet.
Getting that distinction across is most of what this dialog is for, so it is laid out as a
sentence: when this happens, do this to these columns.
"""
from PySide6.QtWidgets import (
    QCheckBox,
    QComboBox,
    QDialog,
    QDialogButtonBox,
    QFormLayout,
    QGridLayout,
    QGroupBox,
    QLabel,
    QLineEdit,
    QVBoxLayout,
)

from .engine.sheets.choref import CHOREF_COLUMNS
from .engine.sheets.kayitz import KAYITZ_COLUMNS
from .htmlfield import HtmlField

# Which conditions a rule can carry, in the order they are worth reaching for. specialParsha
# first because it is what the shipped rules use and what a shul's own exceptions are almost
# always about.
CONDITIONS = [
    ("specialParsha", "On a special Shabbos", "Shuva, Hagadol, Zachor, Parah, Shekalim, Hachodesh, Shira, Chazon, Nachamu. Hebrew or English, comma separated."),
    ("parsha", "On a parsha", "The parsha's name, comma separated for more than one."),
    ("hebrewDate", "On a Hebrew date", 'Month and day, counting Nissan as 1: "5-9" is ט׳ באב. This recurs every year.'),
    ("dateISO", "On one date", "YYYY-MM-DD. This fires once and never again."),
    ("always", "Every week", "Every week on every sheet. For a blanket change."),
]
MODES = [("append", "Add a line to whatever the cell works out to"), ("replace", "Replace the cell entirely")]


def describe(rule: dict) -> str:
    """A rule in a line, for the list."""
    condition = rule.get("condition") or {}
    for key, label, _hint in CONDITIONS:
        if key not in condition:
            continue
        if key == "always":
            return "Every week"
        return f"{label}: " + ", ".join(str(v) for v in condition[key])
    return "Never"


def describe_target(rule: dict) -> str:
    columns = rule.get("columnKeys") or ([rule["columnKey"]] if rule.get("columnKey") else [])
    what = "Adds" if rule.get("mode") == "append" else "Replaces"
    return f"{what} {', '.join(columns)}"


class RuleDialog(QDialog):
    def __init__(self, parent, rule: dict | None = None):
        super().__init__(parent)
        self.setWindowTitle("Rule" if rule else "New rule")
        self.setMinimumWidth(560)
        rule = rule or {"enabled": True, "mode": "append", "condition": {"specialParsha": []}, "columnKeys": [], "value": ""}
        self.original = rule

        layout = QVBoxLayout(self)
        form = QFormLayout()
        self.name = QLineEdit(rule.get("name", ""))
        form.addRow("Name", self.name)
        self.enabled = QCheckBox("On")
        self.enabled.setChecked(bool(rule.get("enabled", True)))
        form.addRow("", self.enabled)

        self.condition = QComboBox()
        for key, label, _hint in CONDITIONS:
            self.condition.addItem(label, key)
        current = next((key for key, _l, _h in CONDITIONS if key in (rule.get("condition") or {})), "specialParsha")
        self.condition.setCurrentIndex([key for key, _l, _h in CONDITIONS].index(current))
        form.addRow("When", self.condition)

        self.values = QLineEdit(", ".join(str(v) for v in (rule.get("condition") or {}).get(current, []) if v is not True))
        form.addRow("", self.values)
        self.hint = QLabel()
        self.hint.setWordWrap(True)
        self.hint.setStyleSheet("color: #6b7280;")
        form.addRow("", self.hint)
        layout.addLayout(form)

        # Column keys are season qualified because the same bare letter means a different
        # cell on each chart: קיץ column I is a Plag Mincha variant while חורף column I is
        # the main Erev Shabbos Mincha. Qualifying lets one rule cover both charts'
        # equivalent cell without ever touching the wrong column on the other.
        chosen = set(rule.get("columnKeys") or [])
        self.boxes = {}
        for season, columns in (("kayitz", KAYITZ_COLUMNS), ("choref", CHOREF_COLUMNS)):
            group = QGroupBox("שבת קיץ" if season == "kayitz" else "שבת חורף")
            grid = QGridLayout(group)
            for index, (key, header) in enumerate(columns):
                box = QCheckBox(f"{key}  {header.replace(chr(10), ' ')}")
                box.setChecked(f"{season}:{key}" in chosen)
                grid.addWidget(box, index // 3, index % 3)
                self.boxes[f"{season}:{key}"] = box
            layout.addWidget(group)

        mode_form = QFormLayout()
        self.mode = QComboBox()
        for key, label in MODES:
            self.mode.addItem(label, key)
        self.mode.setCurrentIndex([key for key, _l in MODES].index(rule.get("mode", "append")))
        mode_form.addRow("Then", self.mode)
        self.value = HtmlField(rule.get("value", ""), height=70)
        mode_form.addRow("This text", self.value)
        layout.addLayout(mode_form)

        buttons = QDialogButtonBox(QDialogButtonBox.Save | QDialogButtonBox.Cancel)
        buttons.accepted.connect(self.accept)
        buttons.rejected.connect(self.reject)
        layout.addWidget(buttons)

        self.condition.currentIndexChanged.connect(self._condition_changed)
        self._condition_changed()

    def _condition_changed(self):
        key = self.condition.currentData()
        self.hint.setText(next(hint for k, _l, hint in CONDITIONS if k == key))
        self.values.setVisible(key != "always")

    def rule(self) -> dict:
        key = self.condition.currentData()
        if key == "always":
            condition = {"always": True}
        else:
            condition = {key: [v.strip() for v in self.values.text().split(",") if v.strip()]}
        return {
            **self.original,
            "id": self.original.get("id") or f'rule-{abs(hash(self.name.text() + key)) % (10 ** 8)}',
            "name": self.name.text().strip() or "Rule",
            "enabled": self.enabled.isChecked(),
            "condition": condition,
            "columnKeys": [key for key, box in self.boxes.items() if box.isChecked()],
            "mode": self.mode.currentData(),
            "value": self.value.value(),
        }
