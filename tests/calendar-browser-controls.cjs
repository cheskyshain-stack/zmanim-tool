// Shared accounts keep management controls in Calendar options. Device previews
// retain their original toolbar because they have no shared account to manage.
async function calendarOptions(page) {
  if (!await page.locator('.cal-dialog [data-cal-close]').count()) await page.locator('[data-cal-options]').click();
}
async function calendarAdd(page) {
  if (!await page.locator('.cal-brand [data-cal-add]').count()) await calendarOptions(page);
  await page.locator('[data-cal-add]').first().click();
}
async function calendarAccess(page) {
  if (!await page.locator('[data-cal-access]').count()) await calendarOptions(page);
  await page.locator('[data-cal-access]').click();
}
async function calendarView(page, role) {
  if (!await page.locator('[data-cal-view]').count()) await calendarOptions(page);
  await page.locator('[data-cal-view]').selectOption(role);
}
async function calendarJump(page, month) {
  if (await page.locator('[data-cal-jump]').count()) await page.locator('[data-cal-jump]').click();
  else { await calendarOptions(page); await page.locator('[data-cal-choose-month]').click(); }
  await page.locator('.cal-dialog input[name=month]').fill(month);
  await page.getByRole('button', {name:'Show month',exact:true}).click();
}
module.exports = { calendarOptions, calendarAdd, calendarAccess, calendarView, calendarJump };
