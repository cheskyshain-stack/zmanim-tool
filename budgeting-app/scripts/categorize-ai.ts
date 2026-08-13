#!/usr/bin/env node --experimental-strip-types
/**
 * Run the model over everything the deterministic stages could not handle.
 *
 * Usage:
 *   npm run categorize -- --dry-run      show batches and prompt size, call nothing
 *   npm run categorize -- --limit 60     classify at most 60 transactions
 *   npm run categorize                   classify the whole queue
 *
 * Needs ANTHROPIC_API_KEY.
 */
import {
  MODEL, BATCH_SIZE, AUTO_APPLY,
  pending, classify, record, taxonomy, buildSystemPrompt, buildUserPrompt, buildSchema,
} from '../src/lib/ai-categorize.ts';

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const li = args.indexOf('--limit');
const LIMIT = li >= 0 ? Number(args[li + 1]) : 100000;

const queue = pending(LIMIT);
console.log(`queue: ${queue.length} transactions with no suggestion yet`);
if (!queue.length) process.exit(0);

const batches: (typeof queue)[] = [];
for (let i = 0; i < queue.length; i += BATCH_SIZE) batches.push(queue.slice(i, i + BATCH_SIZE));
console.log(`model: ${MODEL}`);
console.log(`batches: ${batches.length} of up to ${BATCH_SIZE}`);
console.log(`auto-apply at confidence >= ${AUTO_APPLY}`);

if (DRY) {
  const cats = taxonomy();
  const sys = buildSystemPrompt(cats);
  const user = buildUserPrompt(batches[0]);
  const schema = buildSchema(cats);
  const tok = (s: string) => Math.round(s.length / 3.7);
  console.log(`\ntaxonomy: ${cats.length} categories`);
  console.log(`system prompt: ${sys.length} chars (~${tok(sys)} tokens, cached after the first call)`);
  console.log(`user prompt:   ${user.length} chars (~${tok(user)} tokens per batch)`);
  console.log(`schema enum:   ${schema.properties.results.items.properties.category.enum.length} allowed categories`);
  const cachedReads = batches.length - 1;
  console.log(
    `\nrough input cost shape: ~${tok(sys)} tokens written to cache once, ` +
    `then read ${cachedReads} more times at about a tenth of the price`
  );
  console.log('\n--- first batch, as the model will see it ---');
  console.log(user.split('\n').slice(0, 9).join('\n'));
  console.log('\nnothing was sent.');
  process.exit(0);
}

if (!process.env.ANTHROPIC_API_KEY) {
  console.error(
    '\nANTHROPIC_API_KEY is not set. Add it to .env.local and run again.\n' +
    'Use --dry-run to inspect the batches and prompt without calling anything.'
  );
  process.exit(1);
}

let applied = 0, queued = 0, failed = 0;
for (const [i, batch] of batches.entries()) {
  process.stdout.write(`batch ${i + 1}/${batches.length} (${batch.length}) ... `);
  try {
    const r = record(await classify(batch));
    applied += r.applied; queued += r.queued;
    console.log(`applied ${r.applied}, queued ${r.queued}`);
  } catch (e) {
    failed += batch.length;
    console.log(`failed: ${(e as Error).message}`);
  }
}
console.log(`\napplied automatically : ${applied}`);
console.log(`sent to review        : ${queued}`);
if (failed) console.log(`failed                : ${failed}`);
