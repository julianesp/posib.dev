/**
 * Informe mensual de ventas para el tendero (PDF).
 *
 * Se ofrece al abrir el sistema durante el mes siguiente (ver
 * components/dashboard/monthly-report-modal.tsx). Analiza las ventas del mes
 * cerrado y responde lo que más le sirve a una tienda de barrio:
 *   - cuánto vendió y ganó, comparado con el mes anterior;
 *   - qué productos no le pueden faltar (los más vendidos) y cuáles pedir ya;
 *   - qué días y horas se vende más, cómo le pagan y cuánto quedó fiado;
 *   - qué mercancía no se movió (plata quieta);
 *   - cuánto lleva en el año, a cuánto cerraría y si le tocaría facturar
 *     electrónicamente (tope de 3.500 UVT de la DIAN).
 *
 * Todo se calcula en el navegador con las ventas y productos ya cacheados.
 */

import type jsPDF from "jspdf";
import type { Product, Sale, SaleItem } from "./cloudflare-api";
import { getItemCost, getItemRevenue } from "./profit-helpers";
import { tracksInventory } from "./types";
// Única fuente de la UVT por año (también la usa el Worker para las alertas).
import { E_INVOICE_UVT, uvtFor } from "../cloudflare-migration/src/utils/dian-thresholds";

const MONTHS = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];
const WEEKDAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const PAYMENT_LABELS: Record<string, string> = {
  efectivo: "Efectivo",
  nequi: "Nequi",
  daviplata: "Daviplata",
  tarjeta: "Tarjeta",
  transferencia: "Transferencia",
  credito: "Fiado (crédito)",
};

/** Mes del informe: año y mes (0-11) en hora local de la tienda. */
export interface ReportMonth {
  year: number;
  month: number;
}

export function previousMonth(today = new Date()): ReportMonth {
  const d = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  return { year: d.getFullYear(), month: d.getMonth() };
}

export function monthKey(m: ReportMonth): string {
  return `${m.year}-${String(m.month + 1).padStart(2, "0")}`;
}

export function monthLabel(m: ReportMonth): string {
  return `${MONTHS[m.month]} ${m.year}`;
}

// --- Meses ya descargados -----------------------------------------------------
// La fuente principal es el Worker (tabla monthly_report_downloads, vale en todos
// los dispositivos). El navegador guarda una copia para no esperar la red y por
// si el Worker no responde.

const localDownloadKey = (tenant: string, month: string) =>
  `posib:monthly-report:downloaded:${tenant}:${month}`;

export function isDownloadedLocally(tenant: string, month: string): boolean {
  try {
    return localStorage.getItem(localDownloadKey(tenant, month)) === "1";
  } catch {
    return false;
  }
}

export function markDownloadedLocally(tenant: string, month: string): void {
  try {
    localStorage.setItem(localDownloadKey(tenant, month), "1");
  } catch {
    /* sin almacenamiento: queda solo el registro del Worker */
  }
}

/**
 * Fecha de una venta. SQLite guarda datetime('now') en UTC sin zona
 * ("2026-10-18 15:30:00"); se interpreta como UTC y se pasa a hora local.
 */
export function saleDate(createdAt: string): Date {
  const hasZone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(createdAt);
  return new Date(hasZone ? createdAt : `${createdAt.replace(" ", "T")}Z`);
}

function inMonth(sale: Sale, m: ReportMonth): boolean {
  const d = saleDate(sale.created_at);
  return d.getFullYear() === m.year && d.getMonth() === m.month;
}

const isValidSale = (s: Sale) => s.status !== "cancelada";

export interface ProductLine {
  productId: string;
  name: string;
  units: number;
  revenue: number;
  profit: number | null;
  /** Unidades actuales (null = sin control de inventario o producto borrado). */
  stock: number | null;
  /** Días que alcanza el stock al ritmo de venta del mes. */
  daysOfCover: number | null;
}

export interface MonthlyReport {
  month: ReportMonth;
  storeName: string | null;
  salesCount: number;
  revenue: number;
  /** null si casi ningún producto vendido tiene costo de compra. */
  profit: number | null;
  avgTicket: number;
  unitsSold: number;
  previous: { revenue: number; salesCount: number } | null;
  bestDay: { date: Date; revenue: number } | null;
  byWeekday: Array<{ day: string; revenue: number; count: number }>;
  byTimeOfDay: Array<{ label: string; revenue: number; count: number }>;
  byPayment: Array<{ label: string; revenue: number; count: number }>;
  credit: { count: number; total: number; pending: number };
  topByUnits: ProductLine[];
  topByRevenue: ProductLine[];
  topByProfit: ProductLine[];
  reorder: ProductLine[];
  idle: { count: number; value: number; examples: string[] };
  /** Acumulado del año del informe hasta el mes del informe (incluido). */
  year: YearToDate;
  tips: string[];
}

export interface YearToDate {
  year: number;
  /** De enero al mes del informe. */
  months: Array<{ month: number; revenue: number }>;
  total: number;
  /** Promedio de los meses desde el primero con ventas; null sin ventas. */
  avgPerMonth: number | null;
  /** Cierre de año si sigue al promedio; null sin datos. */
  projected: number | null;
  /** Tope de facturación electrónica (3.500 UVT) de ese año. */
  eInvoiceCap: number;
  uvtEstimated: boolean;
}

/** Ventas del año del informe, mes a mes, y proyección al cierre. */
export function buildYearToDate(allSales: Sale[], m: ReportMonth): YearToDate {
  const months = Array.from({ length: m.month + 1 }, (_, i) => ({ month: i, revenue: 0 }));
  for (const sale of allSales) {
    if (!isValidSale(sale)) continue;
    const d = saleDate(sale.created_at);
    if (d.getFullYear() !== m.year || d.getMonth() > m.month) continue;
    months[d.getMonth()].revenue += Number(sale.total) || 0;
  }
  const total = months.reduce((sum, x) => sum + x.revenue, 0);
  // Una tienda que empezó en posib a mitad de año no tiene ventas antes: no
  // se cuentan esos meses en el promedio.
  const first = months.findIndex((x) => x.revenue > 0);
  const counted = first === -1 ? 0 : m.month - first + 1;
  const avgPerMonth = counted > 0 ? total / counted : null;
  const projected = avgPerMonth === null ? null : Math.round(total + avgPerMonth * (11 - m.month));
  const { uvt, estimated } = uvtFor(m.year);
  return { year: m.year, months, total, avgPerMonth, projected, eInvoiceCap: E_INVOICE_UVT * uvt, uvtEstimated: estimated };
}

export interface MonthSummary {
  month: ReportMonth;
  key: string;
  salesCount: number;
  revenue: number;
}

/** Meses con ventas, del más reciente al más antiguo, con su resumen. */
export function monthsWithSales(sales: Sale[]): MonthSummary[] {
  const byKey = new Map<string, MonthSummary>();
  for (const sale of sales) {
    if (!isValidSale(sale)) continue;
    const d = saleDate(sale.created_at);
    if (Number.isNaN(d.getTime())) continue;
    const month = { year: d.getFullYear(), month: d.getMonth() };
    const key = monthKey(month);
    const entry = byKey.get(key) ?? { month, key, salesCount: 0, revenue: 0 };
    entry.salesCount++;
    entry.revenue += Number(sale.total) || 0;
    byKey.set(key, entry);
  }
  return [...byKey.values()].sort((a, b) => b.key.localeCompare(a.key));
}

export function hasSalesIn(sales: Sale[], m: ReportMonth): boolean {
  return sales.some((s) => isValidSale(s) && inMonth(s, m));
}

export function buildMonthlyReport(
  allSales: Sale[],
  products: Product[],
  m: ReportMonth,
  storeName: string | null,
): MonthlyReport {
  const productsById = new Map(products.map((p) => [p.id, p]));
  const sales = allSales.filter((s) => isValidSale(s) && inMonth(s, m));
  const daysInMonth = new Date(m.year, m.month + 1, 0).getDate();

  const prevMonth = { year: m.month === 0 ? m.year - 1 : m.year, month: (m.month + 11) % 12 };
  const prevSales = allSales.filter((s) => isValidSale(s) && inMonth(s, prevMonth));

  const revenue = sales.reduce((sum, s) => sum + (Number(s.total) || 0), 0);

  // Por producto
  const lines = new Map<string, ProductLine & { costKnown: boolean }>();
  let unitsSold = 0;
  let costedRevenue = 0;
  let itemsRevenue = 0;
  let totalCost = 0;
  for (const sale of sales) {
    for (const item of (sale.items ?? []) as Array<SaleItem & { product?: { name?: string } }>) {
      const product = productsById.get(item.product_id);
      const qty = Number(item.quantity) || 0;
      const itemRevenue = getItemRevenue(item);
      const cost = getItemCost(item, product);
      const costKnown = !!product && (product.cost_price || 0) > 0;
      unitsSold += qty;
      itemsRevenue += itemRevenue;
      if (costKnown) {
        costedRevenue += itemRevenue;
        totalCost += cost;
      }
      const line = lines.get(item.product_id) ?? {
        productId: item.product_id,
        name: product?.name ?? item.product?.name ?? "Producto borrado",
        units: 0,
        revenue: 0,
        profit: 0,
        stock: product && tracksInventory(product) ? Number(product.stock) || 0 : null,
        daysOfCover: null,
        costKnown,
      };
      line.units += qty;
      line.revenue += itemRevenue;
      line.profit = costKnown && line.profit !== null ? line.profit + itemRevenue - cost : null;
      lines.set(item.product_id, line);
    }
  }
  for (const line of lines.values()) {
    const perDay = line.units / daysInMonth;
    line.daysOfCover = line.stock !== null && perDay > 0 ? line.stock / perDay : null;
  }
  const allLines = [...lines.values()];
  // La ganancia solo es confiable si la mayoría de lo vendido tiene costo de compra.
  const profit = itemsRevenue > 0 && costedRevenue / itemsRevenue >= 0.6 ? costedRevenue - totalCost : null;

  const topByUnits = [...allLines].sort((a, b) => b.units - a.units).slice(0, 15);
  const topByRevenue = [...allLines].sort((a, b) => b.revenue - a.revenue).slice(0, 10);
  const topByProfit = allLines
    .filter((l) => l.profit !== null && l.profit > 0)
    .sort((a, b) => (b.profit ?? 0) - (a.profit ?? 0))
    .slice(0, 10);
  // Pedir ya: de los 40 más vendidos, los que alcanzan para menos de una semana.
  const reorder = [...allLines]
    .sort((a, b) => b.units - a.units)
    .slice(0, 40)
    .filter((l) => l.daysOfCover !== null && l.daysOfCover < 7)
    .sort((a, b) => (a.daysOfCover ?? 0) - (b.daysOfCover ?? 0))
    .slice(0, 15);

  // Por día
  const byDate = new Map<string, { date: Date; revenue: number }>();
  const weekday = WEEKDAYS.map((day) => ({ day, revenue: 0, count: 0 }));
  const slots = [
    { label: "Madrugada (antes de 7 a. m.)", from: 0, to: 7 },
    { label: "Mañana (7 a. m. a 12 m.)", from: 7, to: 12 },
    { label: "Tarde (12 m. a 6 p. m.)", from: 12, to: 18 },
    { label: "Noche (después de 6 p. m.)", from: 18, to: 24 },
  ].map((s) => ({ ...s, revenue: 0, count: 0 }));
  const payments = new Map<string, { label: string; revenue: number; count: number }>();
  const credit = { count: 0, total: 0, pending: 0 };
  for (const sale of sales) {
    const d = saleDate(sale.created_at);
    const total = Number(sale.total) || 0;
    const key = d.toDateString();
    const day = byDate.get(key) ?? { date: d, revenue: 0 };
    day.revenue += total;
    byDate.set(key, day);
    weekday[d.getDay()].revenue += total;
    weekday[d.getDay()].count++;
    const slot = slots.find((s) => d.getHours() >= s.from && d.getHours() < s.to)!;
    slot.revenue += total;
    slot.count++;
    const method = String(sale.payment_method || "efectivo");
    const pay = payments.get(method) ?? { label: PAYMENT_LABELS[method] ?? method, revenue: 0, count: 0 };
    pay.revenue += total;
    pay.count++;
    payments.set(method, pay);
    if (method === "credito") {
      credit.count++;
      credit.total += total;
      credit.pending += Number(sale.amount_pending ?? (sale.payment_status === "pagado" ? 0 : total)) || 0;
    }
  }
  const bestDay = [...byDate.values()].sort((a, b) => b.revenue - a.revenue)[0] ?? null;

  // Plata quieta: productos con unidades que no se vendieron en todo el mes.
  const idleProducts = products.filter(
    (p) => tracksInventory(p) && (Number(p.stock) || 0) > 0 && !lines.has(p.id),
  );
  const idleValue = idleProducts.reduce(
    (sum, p) => sum + (Number(p.stock) || 0) * (Number(p.cost_price) || 0),
    0,
  );
  const idle = {
    count: idleProducts.length,
    value: idleValue,
    examples: [...idleProducts]
      .sort((a, b) => b.stock * (b.cost_price || 0) - a.stock * (a.cost_price || 0))
      .slice(0, 5)
      .map((p) => p.name),
  };

  const previous = prevSales.length
    ? { revenue: prevSales.reduce((sum, s) => sum + (Number(s.total) || 0), 0), salesCount: prevSales.length }
    : null;

  const report: MonthlyReport = {
    month: m,
    storeName,
    salesCount: sales.length,
    revenue,
    profit,
    avgTicket: sales.length ? revenue / sales.length : 0,
    unitsSold,
    previous,
    bestDay,
    byWeekday: [...weekday.slice(1), weekday[0]], // lunes a domingo
    byTimeOfDay: slots.filter((s) => s.count > 0),
    byPayment: [...payments.values()].sort((a, b) => b.revenue - a.revenue),
    credit,
    topByUnits,
    topByRevenue,
    topByProfit,
    reorder,
    idle,
    year: buildYearToDate(allSales, m),
    tips: [],
  };
  report.tips = buildTips(report);
  return report;
}

const cop = (v: number) =>
  `$${Math.round(v).toLocaleString("es-CO")}`;
const num = (v: number) => Math.round(v).toLocaleString("es-CO");
const daysLabel = (d: number | null) =>
  d === null ? "—" : d < 1 ? "Menos de 1 día" : `${Math.floor(d)} ${Math.floor(d) === 1 ? "día" : "días"}`;

function buildTips(r: MonthlyReport): string[] {
  const tips: string[] = [];
  if (r.reorder.length > 0) {
    tips.push(
      `Pida ya ${r.reorder.slice(0, 3).map((l) => l.name).join(", ")}: con lo que hay no alcanza para una semana.`,
    );
  }
  if (r.topByUnits.length > 0) {
    tips.push(
      `Nunca deje agotar ${r.topByUnits.slice(0, 3).map((l) => l.name).join(", ")}: son lo que más le compran.`,
    );
  }
  const bestWeekday = [...r.byWeekday].sort((a, b) => b.revenue - a.revenue)[0];
  if (bestWeekday && bestWeekday.revenue > 0) {
    tips.push(`El ${bestWeekday.day} es el día de más ventas: tenga la tienda bien surtida desde el día anterior.`);
  }
  if (r.idle.count > 0 && r.idle.value > 0) {
    tips.push(
      `Hay ${cop(r.idle.value)} en mercancía que no se vendió en el mes. Póngala en oferta o compre menos de esos productos.`,
    );
  }
  if (r.credit.pending > 0) {
    tips.push(`Quedan ${cop(r.credit.pending)} fiados por cobrar de este mes. Revise la lista de deudores.`);
  }
  const y = r.year;
  if (y.projected !== null && y.projected >= y.eInvoiceCap * 0.7) {
    tips.push(
      y.total >= y.eInvoiceCap
        ? `Ya vendió ${cop(y.total)} en ${y.year}, más que el tope de la DIAN: debe facturar electrónicamente. Hable con su contador.`
        : `A este ritmo cerraría ${y.year} con unos ${cop(y.projected)}${y.projected >= y.eInvoiceCap ? ", por encima" : ", cerca"} del tope de ${cop(y.eInvoiceCap)} para facturar electrónicamente. Prepárese con su contador.`,
    );
  }
  if (r.profit === null) {
    tips.push("Agregue el precio de compra a sus productos para ver cuánto gana realmente cada mes.");
  }
  if (r.previous && r.previous.revenue > 0) {
    const change = ((r.revenue - r.previous.revenue) / r.previous.revenue) * 100;
    if (change <= -10) {
      tips.push("Las ventas bajaron frente al mes anterior. Revise si le faltó algún producto de los más vendidos.");
    }
  }
  return tips;
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

const BRAND: [number, number, number] = [0, 124, 128]; // --brand #007c80
const BRAND_LIGHT: [number, number, number] = [230, 244, 244]; // --brand-light
const INK: [number, number, number] = [31, 41, 55];
const MUTED: [number, number, number] = [107, 114, 128];
const WARN: [number, number, number] = [180, 83, 9];

export async function downloadMonthlyReportPdf(r: MonthlyReport): Promise<void> {
  const doc = await buildMonthlyReportPdf(r);
  doc.save(`Informe de ventas ${monthLabel(r.month)}.pdf`);
}

export async function buildMonthlyReportPdf(r: MonthlyReport): Promise<jsPDF> {
  const JsPDF = (await import("jspdf")).default;
  const doc: jsPDF = new JsPDF({ unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 16;
  let y = 0;

  const ensure = (needed: number) => {
    if (y + needed > H - 16) {
      doc.addPage();
      y = 18;
    }
  };
  const text = (value: string, x: number, size = 10, color = INK, style: "normal" | "bold" = "normal") => {
    doc.setFont("helvetica", style);
    doc.setFontSize(size);
    doc.setTextColor(...color);
    doc.text(value, x, y);
  };
  const paragraph = (value: string, size = 10, color = INK) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(size);
    doc.setTextColor(...color);
    const rows = doc.splitTextToSize(value, W - 2 * M) as string[];
    ensure(rows.length * size * 0.45 + 2);
    doc.text(rows, M, y);
    y += rows.length * size * 0.45 + 2;
  };
  const ROW_H = 6.2;
  /** Alto de una tabla de `rows` filas (con encabezado). */
  const tableH = (rows: number) => (rows + 1) * ROW_H + 2;
  /** Lo que se mantiene junto al título: la tabla entera si es corta, si no el inicio. */
  const keepFor = (rows: number) => (tableH(rows) <= 110 ? tableH(rows) : tableH(3));
  /** `keep`: alto del contenido que debe quedar en la misma página que el título. */
  const section = (title: string, subtitle?: string, keep = 20) => {
    ensure(14 + (subtitle ? 6 : 0) + keep);
    y += 6;
    doc.setFillColor(...BRAND);
    doc.rect(M, y - 4.2, 1.6, 5.6, "F");
    text(title, M + 4, 13, INK, "bold");
    y += 5;
    if (subtitle) {
      paragraph(subtitle, 9, MUTED);
    }
    y += 1;
  };
  /** Tabla simple: columnas con ancho y alineación. */
  const table = (
    headers: string[],
    rows: string[][],
    widths: number[],
    align: Array<"left" | "right">,
    highlight?: (row: number) => boolean,
  ) => {
    const lineH = ROW_H;
    const drawHeader = () => {
      doc.setFillColor(...BRAND_LIGHT);
      doc.rect(M, y - 4.3, W - 2 * M, lineH, "F");
      let x = M + 2;
      headers.forEach((h, i) => {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8.5);
        doc.setTextColor(...BRAND);
        const cx = align[i] === "right" ? x + widths[i] - 2 : x;
        doc.text(h, cx, y, { align: align[i] });
        x += widths[i];
      });
      y += lineH;
    };
    // Una tabla corta no se parte entre páginas.
    ensure(keepFor(rows.length));
    drawHeader();
    rows.forEach((row, r) => {
      if (y + lineH > H - 16) {
        doc.addPage();
        y = 18;
        drawHeader();
      }
      let x = M + 2;
      row.forEach((cell, i) => {
        doc.setFont("helvetica", i === 0 ? "bold" : "normal");
        doc.setFontSize(9);
        doc.setTextColor(...(highlight?.(r) && i === row.length - 1 ? WARN : INK));
        const maxW = widths[i] - 3;
        const value = (doc.splitTextToSize(cell, maxW) as string[])[0] ?? "";
        const cx = align[i] === "right" ? x + widths[i] - 2 : x;
        doc.text(value, cx, y, { align: align[i] });
        x += widths[i];
      });
      doc.setDrawColor(229, 231, 235);
      doc.line(M, y + 2, W - M, y + 2);
      y += lineH;
    });
    y += 2;
  };

  // Encabezado de marca
  doc.setFillColor(...BRAND);
  doc.rect(0, 0, W, 34, "F");
  y = 14;
  text("INFORME MENSUAL DE VENTAS", M, 9, [255, 255, 255], "bold");
  y = 24;
  const title = monthLabel(r.month);
  text(title.charAt(0).toUpperCase() + title.slice(1), M, 20, [255, 255, 255], "bold");
  if (r.storeName) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(12);
    doc.setTextColor(255, 255, 255);
    doc.text(r.storeName, W - M, 24, { align: "right" });
  }
  y = 46;

  // Resumen en cifras
  const change =
    r.previous && r.previous.revenue > 0 ? ((r.revenue - r.previous.revenue) / r.previous.revenue) * 100 : null;
  const yearPct = r.year.eInvoiceCap > 0 ? (r.year.total / r.year.eInvoiceCap) * 100 : 0;
  const cards: Array<[string, string, string?]> = [
    ["Vendió", cop(r.revenue), change === null ? undefined : `${change >= 0 ? "+" : ""}${change.toFixed(0)}% vs. mes anterior`],
    ["Ventas", num(r.salesCount), `Promedio ${cop(r.avgTicket)} por venta`],
    r.profit !== null
      ? ["Ganó (estimado)", cop(r.profit), `Margen ${r.revenue > 0 ? ((r.profit / r.revenue) * 100).toFixed(0) : 0}%`]
      : ["Unidades vendidas", num(r.unitsSold), undefined],
    [
      `Lleva en ${r.year.year}`,
      cop(r.year.total),
      `${yearPct.toLocaleString("es-CO", { maximumFractionDigits: 0 })}% del tope DIAN`,
    ],
  ];
  const cardW = (W - 2 * M - 4 * (cards.length - 1)) / cards.length;
  cards.forEach(([label, value, note], i) => {
    const x = M + i * (cardW + 4);
    doc.setFillColor(...BRAND_LIGHT);
    doc.roundedRect(x, y - 6, cardW, 24, 2, 2, "F");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(...MUTED);
    doc.text(label, x + 4, y);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    // El acumulado del año se pinta de naranja si pasa el 70 % del tope.
    doc.setTextColor(...(i === 3 && yearPct >= 70 ? WARN : BRAND));
    doc.text(value, x + 4, y + 8);
    if (note) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(...MUTED);
      doc.text(note, x + 4, y + 14);
    }
  });
  y += 26;
  if (r.bestDay) {
    paragraph(
      `Su mejor día fue el ${WEEKDAYS[r.bestDay.date.getDay()]} ${r.bestDay.date.getDate()} de ${MONTHS[r.bestDay.date.getMonth()]}, con ${cop(r.bestDay.revenue)} en ventas.`,
      10,
      INK,
    );
  }

  if (r.tips.length > 0) {
    section("Lo más importante para este mes");
    r.tips.forEach((tip) => {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      const rows = doc.splitTextToSize(tip, W - 2 * M - 6) as string[];
      ensure(rows.length * 4.5 + 2);
      doc.setFillColor(...BRAND);
      doc.circle(M + 1.2, y - 1.2, 0.9, "F");
      doc.setTextColor(...INK);
      doc.text(rows, M + 5, y);
      y += rows.length * 4.5 + 2;
    });
  }

  // Lo que no le debe faltar (con los que hay que pedir ya resaltados)
  const topIds = new Set(r.topByUnits.map((l) => l.productId));
  const mustHave = [...r.topByUnits, ...r.reorder.filter((l) => !topIds.has(l.productId))];
  const daysInMonth = new Date(r.month.year, r.month.month + 1, 0).getDate();
  section(
    "Productos que no le deben faltar",
    r.reorder.length > 0
      ? "Los que más vende. En naranja, los que hay que pedir ya: no alcanzan para una semana."
      : "Los que más unidades vendió en el mes. Si alguno se agota, pierde ventas.",
    keepFor(mustHave.length),
  );
  table(
    ["Producto", "Vendió", "Al día", "Hay hoy", "Alcanza para"],
    mustHave.map((l) => {
      const perDay = l.units / daysInMonth;
      return [
        l.name,
        num(l.units),
        perDay < 1 ? perDay.toFixed(1).replace(".", ",") : num(perDay),
        l.stock === null ? "Sin control" : num(l.stock),
        daysLabel(l.daysOfCover),
      ];
    }),
    [76, 22, 22, 24, 34],
    ["left", "right", "right", "right", "right"],
    (i) => (mustHave[i].daysOfCover ?? 99) < 7,
  );

  // Plata y ganancia en una sola tabla
  const hasProfit = r.topByRevenue.some((l) => l.profit !== null);
  section(
    "Los que más plata dejaron",
    hasProfit ? "Ganancia = lo vendido menos el precio de compra actual." : undefined,
    keepFor(r.topByRevenue.length),
  );
  table(
    hasProfit ? ["Producto", "Unidades", "Vendido", "Ganancia"] : ["Producto", "Unidades", "Vendido"],
    r.topByRevenue.map((l) =>
      hasProfit
        ? [l.name, num(l.units), cop(l.revenue), l.profit === null ? "—" : cop(l.profit)]
        : [l.name, num(l.units), cop(l.revenue)],
    ),
    hasProfit ? [88, 26, 32, 32] : [118, 30, 30],
    hasProfit ? ["left", "right", "right", "right"] : ["left", "right", "right"],
  );

  section("Cuándo vende más", undefined, keepFor(r.byWeekday.length));
  table(
    ["Día", "Ventas", "Vendido"],
    r.byWeekday.map((d) => [d.day.charAt(0).toUpperCase() + d.day.slice(1), num(d.count), cop(d.revenue)]),
    [118, 30, 30],
    ["left", "right", "right"],
  );
  if (r.byTimeOfDay.length > 0) {
    table(
      ["Horario", "Ventas", "Vendido"],
      r.byTimeOfDay.map((s) => [s.label, num(s.count), cop(s.revenue)]),
      [118, 30, 30],
      ["left", "right", "right"],
    );
  }

  section("Cómo le pagaron", undefined, keepFor(r.byPayment.length));
  table(
    ["Forma de pago", "Ventas", "Total"],
    r.byPayment.map((p) => [p.label, num(p.count), cop(p.revenue)]),
    [118, 30, 30],
    ["left", "right", "right"],
  );
  if (r.credit.count > 0) {
    paragraph(
      `Fió ${num(r.credit.count)} ${r.credit.count === 1 ? "venta" : "ventas"} por ${cop(r.credit.total)}; de eso quedan ${cop(r.credit.pending)} por cobrar.`,
    );
  }

  // Acumulado del año y tope de la DIAN
  const yr = r.year;
  if (yr.total > 0) {
    section(
      `Cuánto lleva vendido en ${yr.year}`,
      "Sirve para saber a cuánto cerraría el año y si le tocaría facturar electrónicamente.",
      keepFor(yr.months.filter((x) => x.revenue > 0).length),
    );
    table(
      ["Mes", "Vendido"],
      yr.months
        .filter((x) => x.revenue > 0)
        .map((x) => [MONTHS[x.month].charAt(0).toUpperCase() + MONTHS[x.month].slice(1), cop(x.revenue)]),
      [118, 60],
      ["left", "right"],
    );
    paragraph(`Total del año hasta ${MONTHS[r.month.month]}: ${cop(yr.total)}.`, 10, INK);
    if (yr.avgPerMonth !== null && yr.projected !== null && r.month.month < 11) {
      paragraph(
        `Vende en promedio ${cop(yr.avgPerMonth)} al mes. Si sigue así, cerraría ${yr.year} con unos ${cop(yr.projected)}.`,
      );
    }
    const closing = yr.projected ?? yr.total;
    const capText = `El tope para facturar electrónicamente en ${yr.year} es ${cop(yr.eInvoiceCap)} (3.500 UVT)`;
    if (yr.total >= yr.eInvoiceCap) {
      paragraph(`${capText} y ya lo superó: debe expedir factura electrónica y es responsable de IVA. Hable con su contador.`, 10, WARN);
    } else if (closing >= yr.eInvoiceCap) {
      paragraph(`${capText}. A este ritmo lo pasaría antes de terminar el año: prepárese desde ya con su contador.`, 10, WARN);
    } else {
      paragraph(`${capText}. A este ritmo le quedarían unos ${cop(yr.eInvoiceCap - closing)} de margen.`);
    }
    paragraph(
      `Calculado solo con las ventas registradas en posib. La DIAN cuenta todos sus ingresos: confírmelo con su contador.${yr.uvtEstimated ? ` La UVT de ${yr.year} aún no está publicada; se usó la del año anterior.` : ""}`,
      8,
      MUTED,
    );
  }

  if (r.idle.count > 0) {
    section(
      "Mercancía que no se movió",
      "Productos con unidades en la tienda que no se vendieron ni una vez en el mes.",
      14,
    );
    paragraph(
      `${num(r.idle.count)} ${r.idle.count === 1 ? "producto" : "productos"}${r.idle.value > 0 ? `, con ${cop(r.idle.value)} invertidos (a precio de compra)` : ""}. ${r.idle.examples.length > 0 ? `Por ejemplo: ${r.idle.examples.join(", ")}.` : ""}`,
    );
  }

  // Pie en cada página
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(`posib.dev · Informe de ${monthLabel(r.month)}`, M, H - 8);
    doc.text(`Página ${i} de ${pages}`, W - M, H - 8, { align: "right" });
  }

  return doc;
}
