import { buildMonthlyReport, buildYearToDate } from "../monthly-sales-report";
import type { Sale } from "../cloudflare-api";

const sale = (id: string, total: number, created_at: string, status = "completada") =>
  ({ id, total, created_at, status, payment_method: "efectivo", items: [] }) as unknown as Sale;

describe("acumulado del año en el informe mensual", () => {
  const sales = [
    sale("a", 10_000_000, "2026-03-10T15:00:00.000Z"),
    sale("b", 20_000_000, "2026-04-10T15:00:00.000Z"),
    sale("c", 99_000_000, "2026-04-11T15:00:00.000Z", "cancelada"),
    sale("d", 5_000_000, "2026-05-10T15:00:00.000Z"), // después del mes del informe
    sale("e", 7_000_000, "2025-04-10T15:00:00.000Z"), // otro año
  ];

  it("suma de enero al mes del informe, sin anuladas ni otros años", () => {
    const y = buildYearToDate(sales, { year: 2026, month: 3 }); // abril
    expect(y.months.map((m) => m.revenue)).toEqual([0, 0, 10_000_000, 20_000_000]);
    expect(y.total).toBe(30_000_000);
  });

  it("promedia desde el primer mes con ventas y proyecta el cierre de año", () => {
    const y = buildYearToDate(sales, { year: 2026, month: 3 });
    expect(y.avgPerMonth).toBe(15_000_000); // marzo y abril
    expect(y.projected).toBe(30_000_000 + 15_000_000 * 8); // mayo a diciembre
    expect(y.eInvoiceCap).toBe(183_309_000); // 3.500 UVT de 2026
  });

  it("si la proyección se acerca al tope, lo dice en las recomendaciones", () => {
    const r = buildMonthlyReport(sales, [], { year: 2026, month: 3 }, null);
    expect(r.tips.some((t) => t.includes("facturar electrónicamente"))).toBe(true);
  });

  it("sin ventas no proyecta", () => {
    const y = buildYearToDate([], { year: 2026, month: 3 });
    expect(y.avgPerMonth).toBeNull();
    expect(y.projected).toBeNull();
  });
});
