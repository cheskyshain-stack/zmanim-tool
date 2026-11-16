module.exports = async page => {
  const options = page.locator('#print-options');
  if (await options.getAttribute('open') === null) await options.locator(':scope > summary').click();
};
