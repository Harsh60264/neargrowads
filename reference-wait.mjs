export default async function run(page, ui) {
  await page.waitForTimeout(12000);
  return { snapshot: await ui.snapshot({ full: true }), title: await page.title(), text: await page.locator('body').innerText() };
}
