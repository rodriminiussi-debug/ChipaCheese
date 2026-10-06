import { chromium } from "@playwright/test";
const [role, ...paths] = process.argv.slice(2);
const BASE = "http://localhost:3400";
const USERS: Record<string, [string, string?]> = {
  nahuel: ["nahuel"], af: ["af"], logistica: ["logistica"], rtecnico: ["rtecnico"], contadora: ["contadora"], local1: ["local1"], jt: ["jt"],
};
const vp = { nahuel: [1280, 800], af: [1280, 800], rtecnico: [1280, 800], contadora: [1280, 800], logistica: [390, 844], local1: [1024, 768], jt: [1024, 768] }[role] as number[];
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: vp[0], height: vp[1] }, locale: "es-AR", timezoneId: "America/Argentina/Buenos_Aires", serviceWorkers: "block" });
const page = await ctx.newPage();
await page.addInitScript("window.__name = (f) => f");
await page.clock.setSystemTime(new Date("2026-10-02T10:00:00-03:00"));
await page.goto(BASE + "/login");
await page.getByLabel("Usuario o email").fill(USERS[role]![0]);
await page.getByLabel("Contraseña").fill("chipa1234");
await page.getByRole("button", { name: "Ingresar" }).click();
await page.waitForURL((u) => !u.pathname.startsWith("/login"));
for (const p of paths) {
  await page.goto(BASE + p, { waitUntil: "networkidle" });
  console.log("=====", p, "->", page.url());
  const info = await page.evaluate(() => {
    const t = (e: Element) => (e.textContent ?? "").replace(/\s+/g, " ").trim();
    const btns = [...document.querySelectorAll("button, a[href], [role=tab], input, select, textarea, [role=combobox]")].filter((e) => !e.closest("[data-sidebar], aside, nav") && !(e as HTMLElement).innerText?.includes("Toggle Sidebar") && (e as HTMLElement).innerText?.trim()!=="Salir").map((e) => {
      const el = e as HTMLElement;
      const tag = el.tagName.toLowerCase();
      const label = el.getAttribute("aria-label") ?? (el as HTMLInputElement).placeholder ?? "";
      return `${tag}${el.getAttribute("role") ? "[" + el.getAttribute("role") + "]" : ""}${(el as HTMLInputElement).type && tag === "input" ? ":" + (el as HTMLInputElement).type : ""} "${t(el).slice(0, 70)}"${label ? " aria=" + label : ""}${tag === "a" ? " -> " + el.getAttribute("href") : ""}${(el as HTMLInputElement).id ? " #" + (el as HTMLInputElement).id : ""}`;
    });
    const main = document.querySelector("main") ?? document.body;
    return { text: (main as HTMLElement).innerText.replace(/\n{2,}/g, "\n").slice(0, 2500), btns };
  });
  console.log(info.text.slice(0, Number(process.env.MAXT ?? 2500)));
  if (process.env.CTRL) console.log("--- controls\n" + info.btns.slice(0, Number(process.env.LIM ?? 40)).join("\n"));
  if (process.env.SHOT) await page.screenshot({ path: `/tmp/probe-${role}-${p.replace(/\W+/g, "_")}.jpg`, type: "jpeg", quality: 70 });
}
await b.close();
