import {mkdir} from 'node:fs/promises';
import path from 'node:path';

// The shared browser audit serves built assets itself. Every requested date is
// calculated; identical exact chart content shares a browser representative.
// AUDIT_END is inclusive, matching the date range printed in the report.
const output=path.resolve(process.env.AUDIT_OUT||'../../../outputs/twenty-year-pairing');
await mkdir(output,{recursive:true});
process.env.YEAR_LAYOUT_START=process.env.AUDIT_START||'2026-09-24';
process.env.YEAR_LAYOUT_END=process.env.AUDIT_END||'2046-09-23';
process.env.YEAR_LAYOUT_DEDUP='1';
process.env.YEAR_LAYOUT_REPORT=path.join(output,'report.json');
process.env.YEAR_LAYOUT_SCREENSHOT_DIR=path.join(output,'screenshots');
await import('./year-layout-browser.mjs');
