import Anthropic from '@anthropic-ai/sdk';
import { db } from './db.ts';
import { normalizeMerchant } from './categorize.ts';

/**
 * Stage 4 of the pipeline: the only stage that costs money.
 *
 * It never sees a transaction a rule or the memory table could have handled, so
 * its job is narrow: an unfamiliar merchant, and a category from a fixed list.
 *
 * Three things keep it cheap. The taxonomy and instructions are identical on
 * every call and sit behind a cache breakpoint, so repeat calls read them at a
 * fraction of the price. Transactions are batched, so the expensive prefix is
 * paid once per batch rather than once per transaction. And the response is a
 * constrained schema, so there is no retry-on-bad-JSON loop.
 */

export const MODEL = process.env.CATEGORIZER_MODEL ?? 'claude-opus-5';
export const BATCH_SIZE = Number(process.env.CATEGORIZER_BATCH ?? 30);
/** At or above this we apply automatically; below it goes to the review queue. */
export const AUTO_APPLY = Number(process.env.CATEGORIZER_THRESHOLD ?? 0.85);

export type Candidate = {
  id: number;
  date: string;
  amount: number;
  description: string;
  account: string | null;
};

export type Verdict = {
  id: number;
  category: string;
  confidence: number;
  alternatives: string[];
  reason: string;
};

/** Categories the model is allowed to choose from. */
export function taxonomy() {
  return db()
    .prepare(
      `SELECT name, parent, kind FROM categories
        WHERE kind NOT IN ('review')
        ORDER BY parent, name`
    )
    .all() as Array<{ name: string; parent: string | null; kind: string }>;
}

export function buildSystemPrompt(cats: ReturnType<typeof taxonomy>) {
  const lines = cats.map(
    (c) => `- ${c.name}${c.parent ? ` (group: ${c.parent})` : ''} [${c.kind}]`
  );
  return `You categorise bank and credit card transactions for one household.

The household has personal spending, a consulting business, and a rental
property portfolio, so the same merchant can legitimately belong to different
categories depending on the account it hit.

Choose exactly one category per transaction from this list:

${lines.join('\n')}

Guidance that matters for this household:

- A payment to a credit card, or a move between two accounts the household
  owns, is "Transfer - Internal". It is not spending. Descriptions like
  "Payment to Chase card ending in ####" or "Payment Thank You" are transfers.
- A mortgage servicer (Lakeview, Rushmore, PennyMac, ShellPoint, NewRez) is
  "Rental Expenses". Santander is the personal residence, so it is "Mortgage".
- Money set aside for tax from the business is "Tax Reserve", which is savings,
  not an expense.
- A yeshiva, cheder or school is tuition. A morah paid directly is "Day Care".
- Purchases in the weeks before Pesach or Succos may belong to a Yom Tov
  category rather than Grocery, but only when the description supports it.
  Do not guess a Yom Tov category from the date alone.
- A large one-off tied to buying, selling or refinancing a property is
  "Property Purchase / Refinance", which belongs on the balance sheet.

Confidence rules. Report honestly, because anything below the threshold is
shown to a human rather than applied:
- 0.9 and above: the merchant is unambiguous.
- 0.7 to 0.9: likely, but the description is partly generic.
- Below 0.7: genuinely unclear. Prefer this over a confident wrong answer.

Give two alternatives per transaction, different from your main choice, so a
human reviewing it has real options to pick from.`;
}

export function buildSchema(cats: ReturnType<typeof taxonomy>) {
  const names = cats.map((c) => c.name);
  return {
    type: 'object',
    properties: {
      results: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            category: { type: 'string', enum: names },
            confidence: { type: 'number' },
            alternatives: { type: 'array', items: { type: 'string', enum: names } },
            reason: { type: 'string' },
          },
          required: ['id', 'category', 'confidence', 'alternatives', 'reason'],
          additionalProperties: false,
        },
      },
    },
    required: ['results'],
    additionalProperties: false,
  } as const;
}

export function buildUserPrompt(batch: Candidate[]) {
  const rows = batch.map(
    (t) =>
      `id=${t.id} | ${t.date} | ${t.amount < 0 ? 'spent' : 'received'} ${Math.abs(
        t.amount
      ).toFixed(2)} | account: ${t.account ?? 'unknown'} | "${t.description}"`
  );
  return `Categorise these ${batch.length} transactions. Return one result per id.\n\n${rows.join('\n')}`;
}

/**
 * Only merchant, amount, date and account nickname are sent. Account numbers
 * and balances are deliberately withheld: they do not improve the answer and
 * there is no reason to expose them.
 */
export async function classify(batch: Candidate[]): Promise<Verdict[]> {
  if (!batch.length) return [];
  const cats = taxonomy();
  const client = new Anthropic();

  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    system: [
      {
        type: 'text',
        text: buildSystemPrompt(cats),
        // Identical on every call, so it is read from cache after the first.
        cache_control: { type: 'ephemeral' },
      },
    ],
    output_config: {
      effort: 'low',
      format: { type: 'json_schema', schema: buildSchema(cats) },
    },
    messages: [{ role: 'user', content: buildUserPrompt(batch) }],
  } as Parameters<typeof client.messages.create>[0]);

  const msg = res as Anthropic.Message;
  if (msg.stop_reason === 'refusal') {
    throw new Error('the model declined to answer this batch');
  }
  const text = msg.content.find((b) => b.type === 'text');
  if (!text || text.type !== 'text') throw new Error('no text block in response');
  const parsed = JSON.parse(text.text) as { results: Verdict[] };
  return parsed.results ?? [];
}

/** Persist what the model said, then auto-apply only the confident ones. */
export function record(verdicts: Verdict[], model = MODEL) {
  const d = db();
  const catId = new Map(
    (d.prepare('SELECT id,name,kind FROM categories').all() as Array<{
      id: number; name: string; kind: string;
    }>).map((c) => [c.name, c])
  );

  const insS = d.prepare(
    `INSERT INTO ai_suggestions(transaction_id,category_id,rank,confidence,reason,model)
     VALUES(?,?,?,?,?,?)`
  );
  const clearS = d.prepare('DELETE FROM ai_suggestions WHERE transaction_id=?');
  const apply = d.prepare(
    `UPDATE transactions SET category_id=?, is_transfer=?, is_one_time=?,
            needs_review=0, source='model', confidence=? WHERE id=?`
  );
  const logEvent = d.prepare(
    `INSERT INTO category_events(transaction_id,category_id,source,confidence)
     VALUES(?,?,'model',?)`
  );

  let applied = 0, queued = 0;
  const run = d.transaction(() => {
    for (const v of verdicts) {
      const main = catId.get(v.category);
      if (!main) continue;
      clearS.run(v.id);
      insS.run(v.id, main.id, 0, v.confidence, v.reason, model);
      v.alternatives.slice(0, 2).forEach((a, i) => {
        const alt = catId.get(a);
        if (alt && alt.id !== main.id) insS.run(v.id, alt.id, i + 1, null, null, model);
      });

      if (v.confidence >= AUTO_APPLY) {
        apply.run(
          main.id,
          main.kind === 'transfer' ? 1 : 0,
          main.kind === 'one_time' ? 1 : 0,
          v.confidence,
          v.id
        );
        logEvent.run(v.id, main.id, v.confidence);
        applied++;
      } else {
        queued++;
      }
    }
  });
  run();
  return { applied, queued };
}

/** Transactions that reached stage 4: unknown to both the rules and the memory. */
export function pending(limit: number): Candidate[] {
  return db()
    .prepare(
      `SELECT t.id, t.posted_date AS date, t.amount, t.raw_description AS description,
              a.name AS account
         FROM transactions t
         LEFT JOIN accounts a ON a.id = t.account_id
        WHERE t.needs_review = 1
          AND NOT EXISTS (SELECT 1 FROM ai_suggestions s WHERE s.transaction_id = t.id)
        ORDER BY ABS(t.amount) DESC
        LIMIT ?`
    )
    .all(limit) as Candidate[];
}

export { normalizeMerchant };
