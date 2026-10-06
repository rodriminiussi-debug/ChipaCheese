import { chromium } from "@playwright/test";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, locale: "es-AR" });
const page = await ctx.newPage();
await page.goto("http://localhost:3400/login");
await page.getByLabel("Usuario o email").fill("logistica");
await page.getByLabel("Contraseña").fill("chipa1234");
await page.getByRole("button", { name: "Ingresar" }).click();
await page.waitForURL((u) => !u.pathname.startsWith("/login"));
const id = process.argv[2];
await page.goto("http://localhost:3400/despacho/rutas/" + id, { waitUntil: "networkidle" });
console.log((await page.locator("main").innerText()).slice(0, 1800));

const cards = page.getByTestId("stop-card");
console.log("cards", await cards.count());
for (let i = 0; i < (await cards.count()); i++) console.log(i, (await cards.nth(i).innerText()).replace(/\n+/g, " | ").slice(-160), await cards.nth(i).getByRole("button", { name: "Marcar hecha" }).count());
await page.getByLabel("Km final (tablero)").fill("12085");
await page.getByLabel("Temperatura del equipo de frío (°C)").fill("-20");
await page.getByLabel("Combustible (litros)").fill("9,5");
await page.getByLabel("Combustible ($)").fill("18000");
const btn = page.getByRole("button", { name: "Cerrar ruta" });
console.log("enabled", await btn.isEnabled());
await btn.click();
for (let i = 0; i < 12; i++) {
  await page.waitForTimeout(2000);
  console.log(i, "TOASTS", await page.locator("[data-sonner-toast]").allInnerTexts(), "ALERT", await page.locator("[role=alert]").allInnerTexts());
}
await b.close();
