# Budgeting app

A private, single-user budgeting site: bank and card transactions in one place,
categorised automatically, with a review queue for anything uncertain and a clean
split between business and personal money.

Milestone 1 of the plan in [`../docs/budgeting-app-plan.md`](../docs/budgeting-app-plan.md).

> **This should move to its own private repository before it is deployed.** It
> currently lives beside an unrelated project because that is the branch it was
> started on. No credentials or financial data are committed (`/data` and
> `.env.local` are ignored), but the app deserves its own home.

## What works now

- Password login, single user, signed httpOnly session cookie
- Transactions list with search, category filter, and inline recategorising
- Review queue, biggest amounts first, with three suggestions per transaction
- "Apply to similar" and "Always" (writes a rule) so you are never asked twice
- Dashboard: money in and out, spend by kind, business versus personal, biggest categories
- Transfer pairing: matches the two halves of a movement between your own accounts

## Running it

```bash
npm install
cp .env.example .env.local        # then edit both values

# 1. ingest: spreadsheet -> normalised JSON
python3 scripts/export-from-workbook.py /path/to/workbook.xlsx data/transactions.json

# 2. load into the database
node scripts/import.mjs

# 3. match the two halves of internal transfers and owner draws
node scripts/pair-transfers.mjs --dry-run   # inspect first
node scripts/pair-transfers.mjs

npm run dev
```

Then open http://localhost:3000 and sign in with `APP_PASSWORD`.

## How categorisation works

Four stages, in order. The first confident answer wins, so most transactions
never reach a model call.

| Stage | What it does | Cost |
|-------|--------------|------|
| 1. Normalise | `SQ *JOES PIZZA 4471 LAKEWOOD NJ` becomes `joes pizza` | free |
| 2. Rules | Explicit rules you wrote. Highest priority, never guesses | free |
| 3. Memory | Have we categorised this merchant before? | free |
| 4. Model | Only for merchants never seen before | pennies |

Stage 4 is not wired up yet. `suggest()` in `src/app/review/page.tsx` currently
uses nearest-merchant and similar-amount heuristics; replacing its body with a
Claude call is the next step, and nothing around it has to change.

**Why the order matters:** rules alone plateau. A rule only fires on a merchant
somebody already wrote a rule for, so every new merchant falls through forever.
That is why hundreds of rules can coexist with a large uncategorised share.

## Design decisions worth knowing

- **Transfers are explicit, never blank.** Leaving them uncategorised excludes
  them for the wrong reason, and the exclusion breaks the moment someone tidies up.
- **Transfer pairing matches on amount and date, not text.** The paying side
  often names the recipient while the receiving side is generic, so text matching
  misses roughly half of them.
- **A cross-entity pair is an owner draw, not a transfer.** The business side is
  internal; the personal side is income. That distinction is the one a
  spreadsheet cannot make, and getting it wrong overstates personal income.
- **`entity_id` is on the transaction, not just the account**, so a personal card
  used for a business purchase can be reclassified individually.
- **`category_events` is an append-only log.** You can see that the model said X
  at 0.62, you overrode it, and a rule now handles it.
- **`is_one_time` exists from the start.** A projection that cannot tell a
  temporary cost from a recurring one will annualise the temporary one.

## Data

SQLite at `data/budget.db`, gitignored. Moving to Postgres for a hosted deploy
means changing `src/lib/db.ts` and nothing else.

The ingestion adapter (`scripts/export-from-workbook.py`) is the only file that
knows about spreadsheets. Connecting a bank API later means writing a sibling
that emits the same JSON, and changing nothing else.

## Not built yet

Budgets and savings goals, forecasting, per-property rental tracking, receipt and
email enrichment, multi-user. See the plan for the order and the reasoning.
