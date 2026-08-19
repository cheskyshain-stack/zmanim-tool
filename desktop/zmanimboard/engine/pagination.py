"""Splitting a season's weeks across printable pages (js/pagination.js)."""


def validate_page_sizes(total: int, sizes) -> str | None:
    total_given = sum(int(s or 0) for s in sizes)
    if total_given != total:
        return f"Page sizes add up to {total_given}, but there are {total} weeks. They must add up to exactly {total}."
    if any(int(s) < 0 for s in sizes):
        return "Page sizes cannot be negative."
    return None


def default_page_sizes(total: int, num_pages: int):
    """An even split, earlier pages absorbing the remainder one at a time. Pre-fills the
    page size inputs before anyone adjusts them."""
    base, rem = divmod(total, num_pages)
    return [base + (1 if i < rem else 0) for i in range(num_pages)]


def align_page_sizes_to(source_weeks, source_sizes, target_weeks):
    """Per page counts that break target_weeks at the same dates source_sizes breaks
    source_weeks, so a Weekday chart's page 1 covers the same stretch of the year as its
    Shabbos sheet's page 1 even though the two lists are different lengths. A target week
    falling in the gap between two source pages lands on the earlier one, matching how the
    season boundaries themselves are assigned."""
    cutoffs = []  # the serial of the first source week on each page after the first
    idx = 0
    for i in range(len(source_sizes) - 1):
        idx += int(source_sizes[i] or 0)
        cutoffs.append(source_weeks[idx].serial if idx < len(source_weeks) else float("inf"))
    counts = [0] * len(source_sizes)
    for week in target_weeks:
        page = 0
        while page < len(cutoffs) and week.serial >= cutoffs[page]:
            page += 1
        counts[page] += 1
    return counts


def split_weeks_into_pages(weeks, sizes):
    pages, i = [], 0
    for size in sizes:
        size = int(size)
        pages.append(weeks[i:i + size])
        i += size
    return pages
