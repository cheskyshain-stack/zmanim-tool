# Announcements awaiting the user's publication review

These JSON files are local drafts. They are not seeded into the live database or
served automatically by the display. The review gallery includes them explicitly
so the user can approve their text and layout before the next push.

## Rav's Derech Hashem shiur

`rav-derech-hashem.json` was transcribed from the user's uploaded
`1000038742.jpg` on September 28, 2026. All visible substantive information is
included: the Rav, Tuesday night, 11:00 PM, Ezras Nashim, beginning Part IV,
and its discussion of understanding and deepening the topics of the order of
tefillah, Shabbos, and Yom Tov. The magnet obscures only introductory wording.

After the user approves publication, create this as an editable announcement
through the existing authenticated admin flow. Check its source ID and internal
name for an existing record before adding it; retain any server-assigned ID for
retries. Group it under The Rav, preserve `sectionPosition: "first"` (Position
within area: First), and set its actual publication start then. The explicit
position keeps this notice first even when publication assigns a new record ID.
Do not replace any existing announcement. The poster
specifies a recurring Tuesday-night shiur without an end date.
