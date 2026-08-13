# Budgeting System: Build Plan

A personal and business budgeting website with automatic bank and card sync, AI assisted
categorization, savings allocation, forecasting, receipt level enrichment, and a clean
separation between business money and personal money.

This document is the plan, not the code. It is ordered so that each phase is usable on its
own, and so that the things everything else depends on (categorization quality and entity
separation) get built and validated first.

---

## 1. The short version

Seven systems, in dependency order:

| # | System | What it does |
|---|--------|--------------|
| 1 | **Ingestion** | Pulls transactions from banks and cards on a schedule, plus file import as a permanent fallback |
| 2 | **Normalization** | Cleans messy merchant strings into a stable merchant identity |
| 3 | **Categorization** | Rules first, memory second, AI last, with a review queue for anything uncertain |
| 4 | **Entity ledger** | Every account and transaction belongs to an entity (personal, business), with transfer pairing so moving money is never counted as income or expense |
| 5 | **Budgeting** | Fixed, variable, and savings buckets, with percentage based savings allocation |
| 6 | **Forecasting** | Recurring detection plus seasonal variable spend, projected forward as a range rather than a single number |
| 7 | **Enrichment** | Receipt and order line items pulled from email and data exports, attached to the matching transaction |

The AI does one job well: deciding a category for a transaction it has never seen, and
offering you options when it is unsure. Everything numeric (budgets, forecasts, balances)
stays in deterministic code so the numbers are reproducible and auditable.

---

## 2. Stack recommendation

| Layer | Choice | Why |
|-------|--------|-----|
| Frontend | Next.js + TypeScript + Tailwind | One language across the whole app, good mobile behavior out of the box |
| Backend | Next.js route handlers plus a worker process | Sync and categorization are background jobs, they should not run in a request |
| Database | Postgres (Supabase, Neon, or self hosted) | Financial data is relational, and you will want real SQL for reports |
| Job queue | pg-boss (Postgres backed) or Inngest | Avoids adding Redis for a single user system |
| AI | Claude API (`claude-opus-5`, `claude-haiku-4-5`) | Structured outputs, batch API, prompt caching, all covered in section 5 |
| Hosting | Vercel or a single VPS | Either is fine, see the security note in section 10 |

If you would rather not run a server at all, everything except the scheduled bank sync can
live in the browser. The sync needs a server, because the aggregator credentials cannot be
exposed to a browser.

---

## 3. Bank and card ingestion

### 3.1 Choosing an aggregator

This is the one decision with real cost attached, so it is worth getting right.

| Provider | Coverage | Cost shape | Notes |
|----------|----------|-----------|-------|
| **Plaid** | Best in the US, including small banks and credit unions | Transactions is a monthly subscription per connected login, plus one time fees for some products. Pay as you go is available to US companies with no monthly minimum, exact rates are quoted during production access | The default choice. Webhooks, recurring transaction detection, and a decent enrichment layer |
| **Teller** | Good US bank coverage, developer friendly | Free developer tier covering roughly 100 live connections, paid above that | The best price to capability ratio for a personal build. Fewer enterprise features |
| **SimpleFIN Bridge** | Broad but read only, daily refresh | About $15 per year | The cheapest real option. No webhooks, no enrichment, daily granularity. Perfectly adequate for budgeting |
| **MX** | Strong data cleansing and categorization | Enterprise, sales led | Worth knowing about, likely overkill here |
| **Finicity / Akoya** | Direct bank connections | Enterprise | Same |
| **File import** | Everything | Free | Not optional. Build it regardless |

**Recommendation:** write the ingestion layer against your own internal interface, not
against a vendor SDK, then implement that interface twice: once for a file importer and
once for your chosen aggregator. Start with Teller or SimpleFIN to keep the monthly cost
near zero, and keep the door open to Plaid if coverage forces it. The provider is the part
of this system most likely to change, so it should be the easiest part to swap.

Costs quoted publicly for these services go stale quickly. Confirm the current numbers
during signup rather than budgeting off anything written here.

### 3.2 What you actually get, and what you do not

Every aggregator returns roughly the same shape: date, amount, account, a raw description
string, a cleaned merchant name, a pending flag, and the provider's own category guess.

What none of them return is **what you bought**. A $214.83 charge from Amazon is a single
opaque line. Section 8 is about closing that gap.

### 3.3 Things that will bite you, so design for them now

- **Pending to posted transitions.** A pending charge and its posted version are two
  different records with different IDs and often different amounts (restaurant tips, gas
  station holds). Track the provider's pending linkage field and merge, do not create
  duplicates.
- **Re-authentication.** Bank connections break. A user visible "reconnect this account"
  flow is not a nice to have, you will use it monthly.
- **Backfill.** Pull 24 months of history on first connect. Forecasting needs at least 12
  months to see seasonality, and more is better.
- **Idempotency.** Dedupe on provider transaction ID. Store the raw provider payload
  untouched in a JSON column alongside your normalized fields, forever. When something
  looks wrong in six months, the raw payload is how you find out why.
- **Reconciliation sweep.** Webhooks drop. Run a nightly job that re-pulls the last 14 days
  and diffs against what you have.

---

## 4. Data model

The tables that matter, with the fields that carry the weight:

```
entities            id, name, type (personal | business), tax_year_start
accounts            id, entity_id, provider, provider_account_id, name, mask,
                    type (checking | savings | credit | loan | investment), is_active
transactions        id, account_id, entity_id, posted_date, amount, direction,
                    raw_description, merchant_id, category_id, subcategory_id,
                    is_transfer, transfer_group_id, is_pending, is_split_parent,
                    needs_review, provider_payload (jsonb)
transaction_splits  id, transaction_id, amount, category_id, entity_id, note
merchants           id, normalized_name, display_name, default_category_id, logo_url
categories          id, parent_id, name, kind (fixed | variable | savings | income |
                    transfer | business), tax_line (Schedule C mapping, nullable)
category_events     id, transaction_id, category_id, source (rule | memory | provider |
                    model | user), confidence, model_id, created_at
rules               id, priority, conditions (jsonb), actions (jsonb), is_active
transfer_links      id, from_transaction_id, to_transaction_id, treatment
                    (internal | owner_draw | capital_contribution), confidence
budgets             id, entity_id, category_id, period, amount, kind
savings_goals       id, name, target_amount, target_date, priority, current_balance,
                    allocation_percent, floor_amount
recurring_series    id, merchant_id, category_id, cadence, expected_amount,
                    amount_tolerance, next_expected_date, confidence
receipts            id, transaction_id, source (email | export | manual), merchant_id,
                    order_id, total, raw_source_ref
receipt_line_items  id, receipt_id, description, quantity, unit_price, amount,
                    category_id
forecast_runs       id, created_at, assumptions (jsonb), horizon_months
```

Three design decisions inside that sketch are worth calling out:

1. **`category_events` is an append only log, not a single column.** You want to know that
   the model said "Dining" with 0.62 confidence, you overrode it to "Business Meals", and a
   rule now handles it. That history is what makes the learning loop trustworthy and
   debuggable.
2. **`transaction_splits` exists from day one.** A single Amazon order spanning groceries
   and office supplies, or a card charge that is 60% business, is the normal case, not an
   edge case. Retrofitting splits later means rewriting every report.
3. **`entity_id` lives on the transaction, not only on the account.** A personal card used
   for a business purchase needs to be reclassifiable per transaction.

---

## 5. The categorization engine

This is the part you asked about most, so it gets the most detail.

### 5.1 The pipeline

Every transaction runs through these stages in order. The first stage that produces a
confident answer wins.

**Stage 1: Normalize the merchant.**
Raw descriptors are hostile: `SQ *JOES PIZZA 4471 LAKEWOOD NJ`, `TST* THE COFFEE-`,
`AMZN Mktp US*RT4XY1234`. Strip processor prefixes (`SQ *`, `TST*`, `PAYPAL *`, `SP `),
trailing store and reference numbers, city and state suffixes, and normalize case. The
output is a stable merchant key. This one step does more for accuracy than anything else in
the pipeline, and it is plain string handling, no AI needed.

**Stage 2: Memory.**
Have you categorized this merchant before, on this account? Use that. After about a month
of use this stage alone handles the large majority of transactions, instantly and for free.

**Stage 3: Rules.**
Explicit rules you wrote, evaluated by priority. Conditions on merchant, amount range,
account, direction, and date. Actions set category, subcategory, entity, tags, or mark as
transfer. Rules beat memory, because a rule is you being deliberate.

Example: `merchant contains "SHOPRITE" AND account = personal_visa -> Groceries`,
`amount = 2450.00 AND day_of_month between 1 and 5 -> Rent (fixed)`.

**Stage 4: Provider category as a prior, never as the answer.**
Aggregators guess. Their taxonomy is not yours, and they are wrong often enough that you
should treat their answer as a hint fed into stage 5, not as a result.

**Stage 5: The AI classifier.**
Only unknown merchants reach this stage. The call returns a constrained JSON object:

```json
{
  "category_id": "dining",
  "subcategory_id": "takeout",
  "confidence": 0.83,
  "alternatives": [
    { "category_id": "groceries", "confidence": 0.09 },
    { "category_id": "business_meals", "confidence": 0.05 },
    { "category_id": "entertainment", "confidence": 0.03 }
  ],
  "entity_hint": "personal",
  "rationale": "TST* prefix indicates Toast restaurant POS"
}
```

Use structured outputs (`output_config.format` with a JSON schema) so the category IDs are
constrained to your actual taxonomy and the response is always parseable. No regex, no
retry-on-bad-JSON loop.

The prompt carries: your full category tree with one line describing each, 20 to 40 worked
examples drawn from your own corrected history, the entity and account context, and the
batch of transactions to classify.

**Stage 6: Confidence gate.**
Above your threshold (start at 0.80 and tune), auto apply. Below it, the transaction lands
in a review queue.

**Stage 7: Review queue.**
This is your "options to choose from" requirement. Each uncertain transaction shows as a
card with the top three suggestions as one tap buttons, plus a search box for anything
else. Two extra controls on each card:

- **"Always do this"** creates a rule from the correction, so you are never asked again.
- **"Apply to N similar"** finds other transactions from the same merchant and fixes them
  in one action.

**Stage 8: Feedback loop.**
Every correction writes a merchant memory entry and appends to `category_events`. Once a
quarter, regenerate the few shot examples in the AI prompt from your most recent
corrections. The classifier gets better at your specific spending without any retraining.

### 5.2 Model choice and cost

| Model | Model ID | Input / Output per million tokens |
|-------|----------|-----------------------------------|
| Claude Opus 5 | `claude-opus-5` | $5 / $25 |
| Claude Haiku 4.5 | `claude-haiku-4-5` | $1 / $5 |

**Two tier approach:** send the batch to Haiku 4.5 first. Anything Haiku returns below the
confidence threshold gets escalated to Opus 5 before it reaches your review queue. Most
transactions are easy, and the hard ones are worth the better model.

Three cost levers, all of which stack:

- **Batch multiple transactions per request.** 25 to 50 per call. The taxonomy and
  instructions are the expensive part of the prompt, so amortize them.
- **Prompt caching.** Your taxonomy, instructions, and examples are byte identical on every
  call. Put them in a cached system prefix and repeated calls read that prefix at roughly a
  tenth of the input price. One caveat: the minimum cacheable prefix is model dependent,
  512 tokens on Opus 5 but 4096 on Haiku 4.5, so a short prompt will silently not cache on
  Haiku. Check `usage.cache_read_input_tokens` on a real response to confirm it is working
  rather than assuming.
- **Batch API for the backfill.** Categorizing 24 months of history is not latency
  sensitive. The Message Batches API runs it asynchronously at 50% of standard price.

**Realistic steady state cost:** if you run 1,500 transactions a month and the memory and
rules stages absorb 80% of them after the first couple of months, roughly 300 reach the
model. At 30 per request that is 10 requests a month, with most of the input served from
cache. That is cents per month, not dollars. The initial backfill of two years of history
is the largest single spend and it is still small, well under ten dollars through the batch
API.

The point of the layered pipeline is not primarily cost, it is that deterministic stages
are instant, free, and never change their mind. But the cost profile is a pleasant side
effect.

### 5.3 Starting taxonomy

Seed the category tree from the PROSPR workbook already in use, with the corrections noted
in the separate plan review. Categories carry a `kind` so the budgeting and forecasting
engines know how to treat them.

| Group | Subcategories | Kind |
|-------|---------------|------|
| **Shelter** | Mortgage, Gas / Oil, Electric, Water / Sewer, Phone, Internet, Home Repairs, Home Maintenance, HOA | fixed, except repairs and maintenance |
| **Subscriptions** | Computer apps, software, digital services | fixed |
| **Food** | Grocery, Eating Out, Health Food / Vitamins | variable |
| **Household** | Household Supplies, Housekeeping Help | variable, help is fixed |
| **Medical** | Health Insurance, Co-Pay / Out of Network, Therapy, Glasses / Lenses, Dentist, Pharmacy | mixed |
| **Insurance** | Life, Auto, Homeowners, Umbrella | fixed |
| **Education** | Tuition (per child), Bussing, Tutoring, Private Lessons, School Supplies / Seforim, School Events, Teacher Gifts, Day Care | fixed, except supplies |
| **Children** | Summer Camp, Camp Supplies, Babysitting, Toys | mixed |
| **Personal Care** | Date Night, Haircuts, Shaitel, Manicure / Pedicure, Cosmetics, Dry Cleaning | variable |
| **Clothing** | Clothing, Shoes | variable, heavily seasonal |
| **Transportation** | Auto Payment, Gas, EZ Pass / Tolls, Auto Repair, Car Maintenance, Taxi / Uber / Bus | mixed |
| **Yom Tov** | Rosh Hashana / Yom Kippur, Succos, Chanukah, Purim, Pesach, Shavuos | variable, seasonal |
| **Entertainment** | Entertainment, Vacation, Swimming, Outings | variable |
| **Tzedaka** | Maaser, other charity | percentage of income |
| **Professional** | Accountant, Coaching, legal, professional development | fixed |
| **Financial** | Bank Fees, Credit Card Interest, Taxes | mixed |
| **One-time events** | Chasunah / Bar Mitzva, appliance, furniture, computer, device purchases, medical events | excluded from run rate |
| **Savings** | Emergency Cushion, Kids' Savings, Simcha Savings, Home / Car Purchase, Life Happens | savings |
| **Debt Repayment** | Per loan and per card | fixed |

Four structural points, each of which came from a real error in the current workbook:

1. **Yom Tov is its own group, not blended into Grocery and Clothing.** Without this, the
   monthly grocery and clothing figures describe no actual month. The classifier should
   learn to route Pesach-season grocery spend to the Pesach category by date proximity plus
   merchant plus amount anomaly, and put anything ambiguous in the review queue.
2. **One-time events are a separate group excluded from the run rate.** A single large
   medical or simcha expense inside a twelve month plan makes the forecast useless. The
   recurring detector marks a series as recurring or not, and the forecast uses only the
   recurring set plus explicitly planned one-time events.
3. **Household help is not food.** Any category whose total is dominated by an unrelated
   subcategory is a category that cannot answer a question.
4. **Insurance is its own group.** Life insurance is not a medical expense and auto
   insurance is not really a transportation variable, they are fixed protection costs and
   they behave alike.

### 5.4 What the model never sees

Send merchant name, amount, date, account nickname, account type, and direction. That is
everything needed to categorize. Do not send account numbers, balances, or your full
transaction history. Categorization quality does not improve with the extra data, and the
exposure is not worth it.

---

## 6. Budgeting model

You asked for fixed, non fixed, and savings. Model them as three `kind` values on a
category, because they behave differently:

**Fixed.** Rent or mortgage, insurance, tuition, loan payments, subscriptions. These are
known in advance both in amount and in timing. The recurring detector (section 7) finds
them automatically and populates a monthly obligations list. Your fixed total is your real
floor, and it is the single most useful number in the whole system.

**Variable.** Groceries, gas, dining, clothing, household. Budgeted as an envelope per
period. The UI should show burn rate and days remaining, not just a total, because "you
have spent 70% of groceries with 12 days left" is actionable and "you spent $580" is not.

**Savings.** Not a leftover, an allocation. Details below.

### 6.1 Savings allocation

Set the allocation as a percentage of net income, with a priority waterfall so the
percentages behave sensibly when income varies:

```
1. Business tax reserve      25% of business income      (hard priority, off the top)
2. Emergency fund            until it holds 6 months of fixed expenses, then stop
3. Retirement                15% of remaining
4. Tuition / children        10%
5. Big purchase / vacation   5%
6. Unallocated               remainder, flows to general savings
```

Each goal carries a target amount, a target date, a priority, and an optional floor. When
income lands, the allocation engine splits it down the waterfall and records planned versus
actual. The dashboard shows both, because the gap between them is the thing you actually
want to see.

The business tax reserve deserves its own line and its own priority. It is the most common
place a business owner overstates how much money they have.

---

## 7. Forecasting

### 7.1 Recurring transaction detection

Cluster transactions by normalized merchant, then look for regular cadence within a cluster:
weekly, biweekly, semi monthly, monthly, quarterly, annual. Score each candidate series on
how consistent the interval is and how consistent the amount is. Series above a confidence
threshold become `recurring_series` rows with a next expected date.

Two behaviors matter here: detect **amount drift** (rent goes up, insurance renews higher)
and detect **series death** (a subscription you cancelled should stop appearing in the
forecast, and should raise a "this stopped, was that intentional?" prompt).

### 7.2 The projection

```
forecast(month) =
    sum(known recurring obligations due that month)
  + sum(variable category baseline × month seasonality index)
  + planned one off events on the timeline
  - projected income
```

- **Variable baseline** is the trailing 6 or 12 month median per category, median rather
  than mean so one anomalous month does not distort it.
- **Seasonality index** is that category's historical spend in that period relative to its
  annual average. This is what captures predictable heavy months, tuition cycles, insurance
  renewals, and Yom Tov.

  **Index against the Hebrew calendar, not the Gregorian one.** This is not a detail, it is
  the difference between a forecast that works and one that does not. Pesach lands in March
  some years and April others, so a plain month-of-year index smears the Nisan spike across
  two months and understates both. The same applies to Tishrei against September and
  October. Build the index on Hebrew months, then project it back onto Gregorian dates for
  display. Since you already have Hebrew date handling in another project, the conversion
  logic is a solved problem rather than new work.

  Practically: compute a `weeks_before_yom_tov` feature per transaction and index on that.
  Grocery and clothing spend ramps in the two to three weeks before Pesach and Succos
  regardless of where those weeks fall on a Gregorian calendar, and that ramp is what you
  actually want to forecast.
- **Planned events** are a user editable timeline: a car purchase in March, a loan that
  finishes in August, a child starting school next year.

### 7.3 Ranges, not points

A single projected number is false precision and you will stop trusting it the first time
it is wrong. Instead, run a few thousand Monte Carlo iterations that resample historical
variable spend per category, and report p10 / p50 / p90. The output reads as "next March
lands between $9,100 and $14,800, most likely around $11,200", which is both honest and
more useful.

### 7.4 Multi year

Same engine, extended, with explicit assumptions you can edit: income growth rate,
inflation per category (food and tuition inflate faster than a fixed mortgage payment),
known step changes, and savings contribution growth. Save assumption sets as named
scenarios so you can compare "baseline" against "save 5% more" against "income drops 20%"
side by side.

### 7.5 Where AI belongs here, and where it does not

Do the math in code. It must be reproducible, testable, and explainable, and a language
model is the wrong tool for arithmetic you will make decisions on.

Use the model for the layer on top: explaining why a forecast moved, spotting anomalies
worth a look ("dining is running 40% above its 12 month median for the third month"),
proposing scenarios to test, and writing the monthly narrative summary. That is genuine
value and none of it puts the model in the path of a number.

---

## 8. Merchant enrichment: Amazon and everything else

The honest situation first: **Amazon has no public API for consumer order history.** The
Selling Partner API is for sellers, and the Amazon Business APIs (including order and
spend reporting) require an Amazon Business account. Neither covers a personal Amazon
account. So there are four real paths, in the order I would build them:

**1. Email receipt parsing. Build this one.**
Nearly every merchant emails an itemized receipt. One pipeline covers Amazon, Uber,
DoorDash, Apple, airlines, hotels, Target, home improvement stores, and hundreds more.
Connect Gmail via the API, search for receipt shaped mail, and have Claude extract each
into a structured schema of line items. Then match the receipt to a bank transaction on
amount plus a date window plus merchant. This is the highest leverage single feature in
this document: it turns "$214.83 Amazon" into an itemized, categorizable, splittable
purchase, and it generalizes far beyond Amazon.

**2. Amazon "Request My Data" export.**
Amazon will generate a full order history file on request. Official, sanctioned, and
complete, but manual and slow (it can take a day or more to arrive). Good as a one time
historical backfill and as a quarterly top up. Build a drag and drop importer for the
order history CSV.

**3. Amazon Business API, if the business account qualifies.**
If your business purchasing runs through an Amazon Business account, its reporting APIs
give you real programmatic order and line item data. Worth checking, since it would cover
the business half properly.

**4. Unofficial scrapers, mentioned for completeness only.**
Libraries and browser extensions exist that scrape order history from the Amazon website.
They work until Amazon changes its markup, and automated access sits awkwardly against the
terms of use. Do not put one on the critical path.

Other direct integrations worth having, depending on what you use: Stripe, Square, or
PayPal if the business receives payments through them (these give full line item and fee
detail), and any utility or telecom portal that offers statements by API.

**Splitting on line items.** Once receipts exist, a single transaction can be split across
categories automatically: the Amazon order that is $40 of diapers and $175 of a monitor
becomes two categorized splits under one transaction. This is where the enrichment work
pays off in the budget rather than just in the detail view.

---

## 9. Business and personal separation

This is the second half of your question and it is where most budgeting apps fall down.

### 9.1 Entities

Every account belongs to an entity. Every transaction inherits its account's entity by
default and can be overridden individually. Start with two, personal and the business, and
let the model handle more.

### 9.1a Rental property is a third kind of entity

A rental portfolio is neither personal nor a normal operating business, and lumping it into
either produces the exact double counting problem the plan review found. Model each
property as its own entity so that every property answers, on its own:

```
gross rent collected
  - mortgage principal and interest
  - property tax
  - insurance
  - repairs and maintenance
  - management fees
  - vacancy allowance
= net cash flow for this property
```

Roll those up to a portfolio total, and let the portfolio total be the **only** number that
flows into the household cash flow. Never enter a rental figure at both the gross and net
level in the same view, which is where double counting comes from.

Two properties worth of detail that the portfolio view should surface:

- **Cash flow per property**, so an underperformer is visible rather than averaged away.
  A portfolio can look fine in total while one high-rate mortgage quietly consumes the
  returns from the others.
- **Rate and term per mortgage**, so refinance opportunities are obvious. A spread from
  3.125% to 9.625% across a portfolio is a large difference in what each property costs to
  hold, and the highest-rate loan is the one worth attacking first.

### 9.2 Transfer pairing, the single most important rule

When you move $10,000 from the business account to your personal account, a naive system
records $10,000 of business expense and $10,000 of personal income. Both numbers are wrong,
and every report built on them is wrong.

Detect transfers by matching: opposite signs, equal or near equal amounts, within a short
date window, between two accounts you own. Confirm ambiguous matches through the review
queue rather than guessing. Link the pair in `transfer_links` and exclude both sides from
income and expense totals.

### 9.3 But an owner draw is real personal income

A transfer is not always neutral. Give each linked pair a `treatment`:

| Treatment | Business books | Personal budget |
|-----------|---------------|-----------------|
| `internal` | No effect (checking to savings, same entity) | No effect |
| `owner_draw` | Equity distribution, not an expense | **Income** |
| `capital_contribution` | Equity in | Expense or savings out |

So the money leaving the business is not a business expense, and the money arriving in
personal is personal income. Both sets of books stay correct, which is exactly the
distinction you described.

### 9.4 Mixed use

Two mechanisms:

- **Splits.** One transaction, 60% business and 40% personal, across two entities and two
  categories.
- **Reimbursables.** A personal card used for a business expense gets flagged
  `pending_reimbursement`, and the eventual reimbursement transfer clears the flag. The
  dashboard shows the outstanding total, which is money the business owes you.

### 9.5 The reports that answer your question

- **Personal cash flow.** Owner draws count as income. Business expenses do not appear at
  all.
- **Business profit and loss.** Revenue and business expenses. Draws appear as equity, not
  expense. Categories carry an optional tax line mapping, so this exports cleanly for your
  accountant.
- **Available to draw.** This is the "which money is not personal" number, computed as:

  ```
  business cash
    - tax reserve set aside
    - known upcoming payables and recurring obligations
    - operating cushion you define
  = safe to draw
  ```

  Show it on the dashboard as a headline figure. It is the number that keeps you from
  spending money that is already committed.

- **Combined household view.** Everything together, for net worth and long range planning,
  with a toggle for whether business equity counts.

---

## 10. Security

This database holds a complete picture of your financial life. A few things are not
optional:

- **Encrypt aggregator access tokens at rest** with a managed key (KMS or equivalent), not
  a plaintext environment variable.
- **Row level security in Postgres**, scoped per user, even at one user. It costs an hour
  now and prevents an entire class of mistake later.
- **MFA on app login.** Passkeys are the easiest good option.
- **No account numbers or balances in application logs**, and none in AI prompts (section
  5.3).
- **Single tenant deployment.** Since this is for your household, deploy it for your
  household. A system with no signup flow, no password reset email, and no other users has
  dramatically less attack surface than a SaaS. If you later decide to let other people in,
  understand that you inherit real obligations at that moment, and treat it as a separate
  project decision rather than a feature toggle.
- **Backups you have actually restored from.** An untested backup is not a backup.

---

## 11. Build order

Each phase produces something you can use. Do not skip ahead, because phases 3 and 4 are
what make every later number correct.

| Phase | Scope | Outcome |
|-------|-------|---------|
| **0** | Schema, CSV and OFX import, manual categorization UI | Real data in the system before you pay any vendor. Validates the data model cheaply |
| **1** | One aggregator connected, scheduled sync, merchant normalization, memory and rules engine | Transactions arrive by themselves and mostly categorize themselves |
| **2** | AI classifier with structured output, confidence gate, review queue with top three options, feedback loop | The categorization requirement, complete |
| **3** | Entities, transfer pairing, owner draw treatment, splits, available to draw | Business and personal separation, and the point where your numbers become trustworthy |
| **4** | Budgets by fixed / variable / savings, savings goals and allocation waterfall, tax reserve | The budgeting requirement, complete |
| **5** | Recurring detection, forecast engine with p10/p50/p90, multi year scenarios | The forecasting requirement, complete |
| **6** | Gmail receipt parsing, Amazon data export importer, line items and automatic splits | The enrichment requirement, complete |
| **7** | Reports, tax line mapping, accountant export, anomaly and narrative summaries | Handoff and polish |

Phases 0 through 2 are the core loop and are worth doing properly before anything else.
Phase 3 is deceptively important: getting entity separation wrong silently corrupts every
budget and forecast built on top of it, and it is painful to retrofit.

---

## 12. Running cost

| Item | Frugal | Comfortable |
|------|--------|-------------|
| Aggregator | $15 / year (SimpleFIN) | $30 to $60 / month (Plaid, depending on institution count) |
| Hosting | $0 (Vercel hobby) | $20 / month (small VPS) |
| Database | $0 (Supabase free tier) | $25 / month |
| Claude API | a few dollars / month | a few dollars / month |
| Email parsing | included in the above | included |
| **Total** | **under $10 / month** | **roughly $75 / month** |

The AI is not the expensive part. The bank connection is.

---

## 12a. You are already halfway, which changes the plan

The existing setup is a sync-backed spreadsheet, not a static template. That means the ingestion
layer in section 3 is already solved, and several other pieces are partly built. Measured
against the seven systems in section 1:

| System | Status | What is missing |
|--------|--------|-----------------|
| **Ingestion** | **Done** | Nothing. Banks and cards already sync automatically |
| **Normalization** | Partial | AutoCat matches description substrings, but there is no stable merchant identity |
| **Categorization** | Rules only | 221 rules exist and roughly a quarter of transactions still land uncategorized. The AI fallback stage is the gap |
| **Entity ledger** | Not started | A `Business` column exists and is entirely empty. Transfers are untagged |
| **Budgeting** | Present | Categories exist but mix unrelated things, and Yom Tov is not separated |
| **Forecasting** | Naive | Projection is the last three months multiplied by four, with no recurring versus one-time distinction |
| **Enrichment** | Not started | No receipt or line item data |

**The rules-only ceiling is the thing to understand.** A rule fires on a merchant somebody
already wrote a rule for. Every new merchant falls through and stays uncategorized until a
human writes another rule. Adding more rules raises the ceiling slowly and never reaches
it, which is why hundreds of rules can coexist with a large uncategorized share. That is
precisely the gap the classifier fills, and it is the reason the pipeline in section 5 puts
the AI stage *after* the rules rather than in place of them.

This reorders the build phases considerably. Phase 1 is largely done, so the highest value
work is now:

| Priority | Work | Fixes |
|---|---|---|
| 1 | Recurring versus one-time detection | Temporary costs being annualized into the forecast |
| 2 | AI categorization for unseen merchants | The uncategorized remainder that rules cannot reach |
| 3 | Transfer tagging and pairing | Card payments and inter-account moves counted as spending |
| 4 | Entity separation | Business revenue booked as personal income |

Two of those four can be done inside the existing sheet without building an application at
all, which is the next section.

## 13. Three options, not two

Given how much already works, building from scratch is now the least attractive option.

**Option A: extend the existing workbook.** Tag transfers, populate the business column,
add a Yom Tov category group, and split the projection into recurring and one-time. This is
a day of work, no code, and it fixes the largest errors. It does not fix the categorization
ceiling, because a spreadsheet cannot call a model on a new merchant.

**Option B: add a categorization service alongside the sheet.** A small scheduled job reads
uncategorized rows, calls the classifier with the taxonomy in a cached prompt, writes back
a category and a confidence, and flags low-confidence rows for review. Everything else stays
exactly as it is. This is a few hundred lines and it targets the one problem that more
rules will never solve. **This is the recommended starting point**, because it delivers the
distinctive value with the least disruption.

**Option C: build the full application in section 1.** Justified when the entity model,
per-property rental tracking, forecasting with ranges, and receipt enrichment all matter at
once and the spreadsheet is genuinely in the way. Real, but it should follow B rather than
replace it.

Existing products worth an hour before committing to C:

- **Actual Budget.** Open source, self hostable, envelope budgeting, has an API.
- **Lunch Money.** Hosted, good API, supports rules. Weaker on multi entity separation.
- **Firefly III.** Open source, self hosted, strong multi account ledger.

None of them do business versus personal separation with owner draw treatment, per property
rental tracking, or AI categorization with a learning loop. Those remain the genuinely
differentiated requirements.

## 14. Decisions I need from you

| Question | My recommendation |
|----------|-------------------|
| Option A, B, or C from section 13? | **B.** Keep the existing sync, add the classifier alongside it |
| Which aggregator? | None needed. Keep the existing one, it already works |
| Self host or managed hosting? | Managed (Vercel plus Supabase) unless you specifically want the data on your own hardware |
| One business entity or several? | Model the schema for several regardless, it costs nothing now |
| Is the Amazon account a personal or Amazon Business account? | Changes whether path 3 in section 8 is available |
| Web only, or a mobile app later? | Build the web app responsive first, it covers phone use fine, and revisit native later |
| Just you, or does a spouse also use it? | Changes the auth model, decide before phase 1 |
