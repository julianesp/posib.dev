import type { ComponentType } from "react";
import {
  Bot,
  Boxes,
  CircleCheck,
  HandCoins,
  PackagePlus,
  Package,
  Plus,
  ScanLine,
  Send,
  ShoppingCart,
  Store,
  type LucideIcon,
} from "lucide-react";
import s from "./ProcessShowcase.module.css";
import {
  AppBar,
  Badge,
  Btn,
  Field,
  Layer,
  Pop,
  ProductRow,
  Tap,
  Toast,
  Typed,
} from "./ui";

export interface Scene {
  id: string;
  tab: string;
  icon: LucideIcon;
  badge?: string;
  title: string;
  blurb: string;
  steps: { title: string; text: string }[];
  Screen: ComponentType<{ step: number }>;
}

/* ───────────── 1. Registrar un producto ───────────── */

function ProductoScreen({ step }: { step: number }) {
  return (
    <>
      <Layer active={step === 0 || step === 4}>
        <AppBar title="Productos" />
        <div className="flex-1 space-y-2 p-3">
          <Btn tap={step === 0} tapDelay={700}>
            <Plus className="h-3.5 w-3.5" />
            Producto nuevo
          </Btn>
          {step === 4 && (
            <ProductRow
              fresh
              highlight="brand"
              name="Arroz Diana 500 g"
              sub="$ 3.500"
              right={<Badge tone="green">24 uds.</Badge>}
            />
          )}
          <ProductRow
            name="Aceite Girasol 1 L"
            sub="$ 12.500"
            right={<Badge tone="green">8 uds.</Badge>}
          />
          <ProductRow
            name="Panela 500 g"
            sub="$ 3.800"
            right={<Badge tone="green">30 uds.</Badge>}
          />
          <ProductRow
            name="Huevos AA x30"
            sub="$ 13.000"
            right={<Badge tone="green">7 uds.</Badge>}
          />
        </div>
        <Toast show={step === 4} delay={500}>
          Producto creado
        </Toast>
      </Layer>

      <Layer active={step >= 1 && step <= 3}>
        <AppBar title="Nuevo producto" />
        <div className="flex-1 space-y-2.5 p-3">
          <Field label="Nombre *" active={step === 1}>
            {step >= 1 && <Typed text="Arroz Diana 500 g" instant={step > 1} />}
          </Field>
          <Field label="Código de barras" active={step === 1}>
            {step >= 1 && (
              <Typed text="7701234567890" delayMs={1000} instant={step > 1} />
            )}
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Precio de Compra *" active={step === 2}>
              {step >= 2 && <Typed text="$ 2.800" instant={step > 2} />}
            </Field>
            <Field label="Precio de Venta *" active={step === 2}>
              {step >= 2 && (
                <Typed text="$ 3.500" delayMs={700} instant={step > 2} />
              )}
            </Field>
            <Field label="Cantidad Disponible *" active={step === 2}>
              {step >= 2 && <Typed text="24" delayMs={1300} instant={step > 2} />}
            </Field>
            <Field label="Mínimo Disponible *" active={step === 2}>
              {step >= 2 && <Typed text="5" delayMs={1700} instant={step > 2} />}
            </Field>
          </div>
        </div>
        <div className="p-3">
          <Btn tap={step === 3} tapDelay={600}>
            Crear Producto
          </Btn>
        </div>
      </Layer>
    </>
  );
}

/* ───────────── 2. Vender ───────────── */

const CART = [
  { name: "Arroz Diana 500 g", price: "$ 3.500" },
  { name: "Aceite Girasol 1 L", price: "$ 12.500" },
  { name: "Huevos AA x30", price: "$ 13.000" },
];

function VentaScreen({ step }: { step: number }) {
  const shown = step === 0 ? 1 : 3;
  const total = step === 0 ? "$ 3.500" : "$ 29.000";
  const pay = step >= 2 ? "nequi" : "efectivo";
  return (
    <>
      <AppBar title="Punto de venta" />
      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="relative flex h-9 items-center gap-2 rounded-lg border border-slate-300 bg-white px-2.5 text-[12px] text-slate-400">
          <ScanLine className="h-4 w-4 text-brand" />
          Escanea o busca un producto
          <Tap show={step === 0} delay={200} />
        </div>

        <div className="space-y-1.5">
          {CART.slice(0, shown).map((item, i) => (
            <Pop key={item.name} delay={i === 0 ? 700 : (i - 1) * 450 + 150}>
              <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-[12px]">
                <span className="truncate">{item.name}</span>
                <span className="ml-2 shrink-0 font-medium">{item.price}</span>
              </div>
            </Pop>
          ))}
        </div>

        <Pop key={total} delay={step === 0 ? 900 : 1000}>
          <div className="flex items-center justify-between rounded-lg bg-slate-900 px-3 py-2 text-slate-50">
            <span className="text-[11px] opacity-80">Total</span>
            <span className="text-[15px] font-bold">{total}</span>
          </div>
        </Pop>

        <div className="grid grid-cols-3 gap-1.5">
          {[
            ["efectivo", "Efectivo"],
            ["nequi", "Nequi"],
            ["credito", "Crédito"],
          ].map(([id, label]) => (
            <div
              key={id}
              className={`relative rounded-lg border px-1 py-2 text-center text-[11px] font-medium transition-colors duration-300 ${
                pay === id
                  ? "border-brand bg-brand/10 text-brand"
                  : "border-slate-200 bg-white text-slate-500"
              }`}
            >
              {label}
              <Tap show={step === 2 && id === "nequi"} delay={300} />
            </div>
          ))}
        </div>

        <div className="mt-auto">
          <Btn tap={step === 3} tapDelay={300}>
            Cobrar {total}
          </Btn>
        </div>
      </div>

      {step === 3 && (
        <div
          className={`${s.pop} absolute inset-0 z-20 flex flex-col items-center justify-center gap-1.5 bg-white text-center`}
          style={{ animationDelay: "1000ms" }}
        >
          <CircleCheck className="h-14 w-14 text-emerald-500" />
          <div className="text-[14px] font-semibold text-slate-800">
            Venta registrada
          </div>
          <div className="text-[11px] text-slate-500">$ 29.000 · Nequi</div>
          <div className="text-[11px] text-slate-500">
            El inventario se descuenta solo
          </div>
        </div>
      )}
    </>
  );
}

/* ───────────── 3. Fiados ───────────── */

function DebtRow({
  name,
  since,
  amount,
  fresh = false,
  highlight = false,
  amountKey,
}: {
  name: string;
  since: string;
  amount: string;
  fresh?: boolean;
  highlight?: boolean;
  amountKey?: string;
}) {
  const body = (
    <div
      className={`flex items-center gap-2 rounded-lg border bg-white p-2 transition-all duration-500 ${
        highlight ? "border-brand/50 ring-2 ring-brand/20" : "border-slate-200"
      }`}
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-600">
        {name[0]}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12px] font-medium text-slate-800">
          {name}
        </div>
        <div className="text-[10px] text-slate-500">{since}</div>
      </div>
      <Pop key={amountKey ?? amount} delay={amountKey ? 900 : 300}>
        <div className="text-[12px] font-semibold text-red-600">{amount}</div>
      </Pop>
    </div>
  );
  return fresh ? <Pop delay={300}>{body}</Pop> : body;
}

function FiadoScreen({ step }: { step: number }) {
  const paid = step >= 3;
  return (
    <>
      <Layer active={step === 0}>
        <AppBar title="Punto de venta" />
        <div className="flex flex-1 flex-col gap-2 p-3">
          <Pop delay={200}>
            <div className="flex items-center gap-2 rounded-lg border border-brand/40 bg-brand/5 p-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-brand text-[11px] font-semibold text-white">
                M
              </div>
              <div>
                <div className="text-[12px] font-medium text-slate-800">
                  Doña Marta Pérez
                </div>
                <div className="text-[10px] text-slate-500">Cliente</div>
              </div>
            </div>
          </Pop>
          <div className="space-y-1 rounded-lg border border-slate-200 bg-white p-2.5 text-[12px]">
            <div className="flex justify-between">
              <span>Aceite Girasol 1 L</span>
              <span>$ 12.500</span>
            </div>
            <div className="flex justify-between">
              <span>Huevos AA x30</span>
              <span>$ 13.000</span>
            </div>
            <div className="flex justify-between">
              <span>Arroz Diana 500 g x5</span>
              <span>$ 17.500</span>
            </div>
            <div className="flex justify-between border-t border-slate-200 pt-1 font-bold">
              <span>Total</span>
              <span>$ 43.000</span>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {["Efectivo", "Nequi", "Crédito"].map((label) => (
              <div
                key={label}
                className={`relative rounded-lg border px-1 py-2 text-center text-[11px] font-medium ${
                  label === "Crédito"
                    ? "border-brand bg-brand/10 text-brand"
                    : "border-slate-200 bg-white text-slate-500"
                }`}
              >
                {label}
                <Tap show={step === 0 && label === "Crédito"} delay={900} />
              </div>
            ))}
          </div>
          <div className="mt-auto">
            <Btn>Registrar venta a crédito</Btn>
          </div>
        </div>
      </Layer>

      <Layer active={step >= 1}>
        <AppBar title="Deudores" />
        <div className="flex-1 space-y-2 p-3">
          <div className="rounded-lg bg-brand p-3 text-white">
            <div className="text-[10px] opacity-80">Total por cobrar</div>
            <Pop key={paid ? "pagado" : "inicial"} delay={paid ? 1000 : 0}>
              <div className="text-[18px] font-bold">
                {paid ? "$ 116.000" : "$ 136.000"}
              </div>
            </Pop>
          </div>
          {step >= 1 && (
            <DebtRow
              fresh={step === 1}
              highlight={step >= 1}
              name="Doña Marta Pérez"
              since="Fiado desde hoy"
              amount={paid ? "$ 23.000" : "$ 43.000"}
              amountKey={paid ? "pagado" : undefined}
            />
          )}
          <DebtRow name="Don Jorge Ruiz" since="Hace 9 días" amount="$ 60.000" />
          <DebtRow name="Yesenia Mora" since="Hace 3 días" amount="$ 33.000" />
        </div>
      </Layer>

      <div
        className={`absolute inset-0 z-10 bg-black/30 transition-opacity duration-500 motion-reduce:transition-none ${
          step === 2 ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />
      <div
        className={`absolute inset-x-0 bottom-0 z-20 space-y-2 rounded-t-2xl bg-white p-3 transition-all duration-500 motion-reduce:transition-none ${
          step === 2
            ? "translate-y-0 shadow-[0_-8px_24px_rgba(0,0,0,0.2)]"
            : "translate-y-full"
        }`}
      >
        <div>
          <div className="text-[13px] font-semibold text-slate-800">
            Registrar abono
          </div>
          <div className="text-[11px] text-slate-500">Doña Marta Pérez</div>
        </div>
        <Field label="Valor del abono" active>
          {step >= 2 && <Typed text="$ 20.000" delayMs={500} instant={step > 2} />}
        </Field>
        <Btn tap={step === 2} tapDelay={2000}>
          Registrar abono
        </Btn>
      </div>
    </>
  );
}

/* ───────────── 5. Inventario, stock bajo y vencimientos ───────────── */

function InventarioScreen({ step }: { step: number }) {
  const alerts = step >= 2 ? 2 : step >= 1 ? 1 : 0;
  const offer = step >= 3;
  return (
    <>
      <AppBar title="Inventario" />
      <div className="flex-1 space-y-2 p-3">
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-slate-200 bg-white p-2">
            <div className="text-[10px] text-slate-500">Productos</div>
            <div className="text-[15px] font-bold text-slate-800">128</div>
          </div>
          <div
            className={`rounded-lg border p-2 transition-colors duration-500 ${
              alerts > 0
                ? "border-amber-300 bg-amber-50"
                : "border-slate-200 bg-white"
            }`}
          >
            <div className="text-[10px] text-slate-500">Con alerta</div>
            <Pop key={alerts} delay={200}>
              <div className="text-[15px] font-bold text-slate-800">
                {alerts}
              </div>
            </Pop>
          </div>
        </div>

        <ProductRow
          name="Arroz Diana 500 g"
          sub="$ 3.500"
          right={<Badge tone="green">24 unid.</Badge>}
        />
        <ProductRow
          name="Aceite Girasol 1 L"
          sub="$ 12.500 · mínimo 5"
          highlight={step === 1 ? "red" : undefined}
          right={
            step >= 1 ? (
              <Badge tone="red">Stock bajo</Badge>
            ) : (
              <Badge tone="slate">3 unid.</Badge>
            )
          }
        />
        <ProductRow
          name="Panela 500 g"
          sub="$ 3.800"
          right={<Badge tone="green">30 unid.</Badge>}
        />
        <ProductRow
          name="Sal Refisal 500 g"
          sub="$ 1.700"
          right={<Badge tone="green">20 unid.</Badge>}
        />
        <ProductRow
          name="Yogurt 1 L"
          highlight={step === 2 ? "amber" : offer ? "brand" : undefined}
          sub={
            offer ? (
              <>
                <span className="text-slate-400 line-through">$ 3.200</span>{" "}
                <span className="font-semibold text-emerald-600">$ 2.560</span>
              </>
            ) : (
              "$ 3.200"
            )
          }
          right={
            offer ? (
              <Badge tone="green">Oferta -20 %</Badge>
            ) : step >= 2 ? (
              <Badge tone="amber">Vence en 5 días</Badge>
            ) : (
              <Badge tone="slate">6 unid.</Badge>
            )
          }
        />
        {step === 2 && (
          <Pop delay={300}>
            <Btn outline tap tapDelay={1500}>
              Poner en oferta (-20 %)
            </Btn>
          </Pop>
        )}
      </div>
      <Toast show={step === 3} delay={300}>
        Oferta creada: Yogurt 1 L
      </Toast>
    </>
  );
}

/* ───────────── 6. Reporte diario por Telegram ───────────── */

const SALES = [
  ["8:12 a. m.", "$ 12.500", "Efectivo"],
  ["9:40 a. m.", "$ 8.900", "Nequi"],
  ["11:05 a. m.", "$ 43.000", "Crédito"],
  ["12:30 p. m.", "$ 6.200", "Efectivo"],
  ["2:15 p. m.", "$ 15.700", "Nequi"],
];

function ReporteScreen({ step }: { step: number }) {
  return (
    <>
      <Layer active={step === 0}>
        <AppBar title="Ventas del día" />
        <div className="flex-1 space-y-2 p-3">
          <div className="rounded-lg bg-brand p-3 text-white">
            <div className="text-[10px] opacity-80">Total del día</div>
            <div className="text-[18px] font-bold">$ 386.500</div>
            <div className="text-[10px] opacity-80">42 ventas</div>
          </div>
          {step === 0 &&
            SALES.map(([time, amount, method], i) => (
              <Pop key={time} delay={300 + i * 450}>
                <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-[12px]">
                  <div>
                    <div className="font-medium text-slate-800">{amount}</div>
                    <div className="text-[10px] text-slate-500">
                      {time} · {method}
                    </div>
                  </div>
                  <Badge tone="green">Cobrada</Badge>
                </div>
              </Pop>
            ))}
        </div>
      </Layer>

      <Layer active={step >= 1}>
        <div className="flex items-center gap-2 bg-[#4a76a8] px-3 pb-2.5 pt-8 text-slate-50">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20">
            <Bot className="h-4 w-4" />
          </div>
          <div>
            <div className="text-[12px] font-semibold">posib alertas</div>
            <div className="text-[10px] opacity-80">bot</div>
          </div>
        </div>
        <div className="flex-1 space-y-2 bg-[#dfe7ee] p-3">
          {step === 1 && (
            <div className="flex w-14 items-center justify-center gap-1 rounded-2xl rounded-bl-sm bg-white py-3 shadow-sm">
              <span className={s.dot} />
              <span className={s.dot} />
              <span className={s.dot} />
            </div>
          )}
          {step >= 2 && (
            <Pop className="space-y-2 rounded-2xl rounded-bl-sm bg-white p-2.5 text-[11px] leading-snug text-slate-800 shadow-sm">
              <div className="text-[12px] font-bold">Resumen de tu tienda</div>
              <div>
                <div className="font-bold">Ventas de ayer</div>
                <div>$ 386.500 en 42 ventas</div>
                <div className="text-slate-500">
                  Más vendidos: Huevos AA x30 (18), Arroz Diana 500 g (15)
                </div>
              </div>
              <div>
                <div className="font-bold">Stock por reponer</div>
                <div>• Aceite Girasol 1 L — quedan 3</div>
                <div>• Panela 500 g — agotado</div>
              </div>
              <div>
                <div className="font-bold">Fiado por cobrar</div>
                <div>Te deben $ 116.000 entre 3 clientes</div>
              </div>
              <div className="text-right text-[9px] text-slate-400">
                8:00 a. m.
              </div>
            </Pop>
          )}
        </div>
      </Layer>
    </>
  );
}

/* ───────────── 7. Tienda online ───────────── */

const STORE_PRODUCTS = [
  { name: "Arroz Diana 500 g", price: "$ 3.500", added: false },
  { name: "Aceite Girasol 1 L", price: "$ 12.500", added: true },
  { name: "Huevos AA x30", price: "$ 13.000", added: true },
  { name: "Panela 500 g", price: "$ 3.800", added: false },
];

function TiendaScreen({ step }: { step: number }) {
  return (
    <>
      <Layer active={step <= 1}>
        <div className="flex items-center justify-between bg-brand px-4 pb-3 pt-8 text-white">
          <span className="text-[13px] font-semibold">Tienda Don Pepe</span>
          <span className="relative">
            <ShoppingCart className="h-4 w-4" />
            {step >= 1 && (
              <Pop
                delay={1700}
                className="absolute -right-2 -top-2 flex h-4 w-4 items-center justify-center rounded-full bg-amber-400 text-[9px] font-bold text-slate-900"
              >
                2
              </Pop>
            )}
          </span>
        </div>
        <div className="grid flex-1 grid-cols-2 content-start gap-2 p-3">
          {STORE_PRODUCTS.map((product, idx) => {
            const added = product.added && step >= 1;
            const tapDelay =
              400 + STORE_PRODUCTS.slice(0, idx).filter((p) => p.added).length * 700;
            return (
              <div
                key={product.name}
                className="rounded-lg border border-slate-200 bg-white p-2"
              >
                <div className="mb-1.5 flex h-16 items-center justify-center rounded-md bg-slate-100">
                  <Package className="h-6 w-6 text-slate-300" />
                </div>
                <div className="truncate text-[11px] font-medium text-slate-800">
                  {product.name}
                </div>
                <div className="text-[11px] font-semibold text-brand">
                  {product.price}
                </div>
                <div className="relative mt-1.5">
                  <div className="rounded-md bg-brand py-1 text-center text-[10px] font-semibold text-white">
                    Agregar
                  </div>
                  {added && (
                    <Pop
                      delay={tapDelay + 250}
                      className="absolute inset-0 flex items-center justify-center rounded-md bg-emerald-100 text-[10px] font-semibold text-emerald-700"
                    >
                      Agregado
                    </Pop>
                  )}
                  <Tap show={added && step === 1} delay={tapDelay} />
                </div>
              </div>
            );
          })}
        </div>
      </Layer>

      <Layer active={step === 2}>
        <AppBar title="Tu pedido" />
        <div className="flex-1 space-y-2 p-3">
          <div className="space-y-1 rounded-lg border border-slate-200 bg-white p-2.5 text-[12px]">
            <div className="flex justify-between">
              <span>Aceite Girasol 1 L</span>
              <span>$ 12.500</span>
            </div>
            <div className="flex justify-between">
              <span>Huevos AA x30</span>
              <span>$ 13.000</span>
            </div>
            <div className="flex justify-between border-t border-slate-200 pt-1 font-bold">
              <span>Total</span>
              <span>$ 25.500</span>
            </div>
          </div>
          <div className="text-[10px] font-medium text-slate-500">
            Método de pago
          </div>
          <div className="rounded-lg border border-brand bg-brand/10 px-2.5 py-2 text-[12px] font-medium text-brand">
            Nequi
          </div>
          <Field label="Referencia del pago" active>
            {step >= 2 && <Typed text="M4821937" delayMs={300} />}
          </Field>
        </div>
        <div className="p-3">
          <Btn tap={step === 2} tapDelay={2100}>
            Enviar pedido
          </Btn>
        </div>
      </Layer>

      <Layer active={step === 3}>
        <AppBar title="Pedidos" />
        <div className="flex-1 space-y-2 p-3">
          {step === 3 && (
            <Pop className="rounded-lg border border-amber-300 bg-white p-2.5 ring-2 ring-amber-100">
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-semibold text-slate-800">
                  Pedido de Ana G.
                </span>
                <span className="relative block w-[78px]">
                  <span className="block w-full rounded-full bg-amber-100 px-2 py-0.5 text-center text-[10px] font-medium text-amber-800">
                    Por verificar
                  </span>
                  <Pop
                    delay={1800}
                    className="absolute inset-0 flex items-center justify-center rounded-full bg-emerald-500 text-[10px] font-medium text-slate-50"
                  >
                    Confirmado
                  </Pop>
                </span>
              </div>
              <div className="mt-1 text-[11px] text-slate-500">
                $ 25.500 · Nequi · Ref. M4821937
              </div>
              <div className="mt-2">
                <Btn tap tapDelay={1100}>
                  Confirmar pago
                </Btn>
              </div>
            </Pop>
          )}
        </div>
        <Toast show={step === 3} delay={2100}>
          Pago confirmado · stock descontado
        </Toast>
      </Layer>
    </>
  );
}

/* ───────────── Catálogo de escenas ───────────── */

export const SCENES: Scene[] = [
  {
    id: "producto",
    tab: "Registrar producto",
    icon: PackagePlus,
    title: "Registra un producto en segundos",
    blurb:
      "Lo escribes una vez y ya queda listo para vender. Sin hojas de cálculo.",
    steps: [
      {
        title: "Abre «Producto nuevo»",
        text: "Desde Productos, un toque abre el formulario.",
      },
      {
        title: "Nombre y código de barras",
        text: "Escríbelos o escanea el código con la cámara del celular.",
      },
      {
        title: "Precios y cantidad",
        text: "Cuánto te costó, en cuánto lo vendes y cuántos tienes. Fija un mínimo y posib te avisa cuando se acabe.",
      },
      {
        title: "Toca «Crear Producto»",
        text: "Se guarda al instante.",
      },
      {
        title: "Listo para vender",
        text: "Aparece en tu inventario y en el punto de venta.",
      },
    ],
    Screen: ProductoScreen,
  },
  {
    id: "venta",
    tab: "Vender",
    icon: ShoppingCart,
    title: "Cobra una venta en menos de un minuto",
    blurb: "Escanea, cobra y sigue con el siguiente cliente.",
    steps: [
      {
        title: "Escanea o busca el producto",
        text: "Con la cámara del celular o escribiendo el nombre.",
      },
      {
        title: "La cuenta se arma sola",
        text: "Suma cada producto y calcula el total.",
      },
      {
        title: "Elige cómo paga",
        text: "Efectivo, Nequi o crédito (fiado).",
      },
      {
        title: "Cobra y listo",
        text: "La venta queda registrada y el inventario se descuenta solo.",
      },
    ],
    Screen: VentaScreen,
  },
  {
    id: "fiado",
    tab: "Fiados",
    icon: HandCoins,
    title: "Lleva los fiados sin cuaderno",
    blurb:
      "Quién te debe, cuánto y desde cuándo, sin que se pierda ninguna cuenta.",
    steps: [
      {
        title: "Vende a crédito",
        text: "Elige el cliente y el método «Crédito».",
      },
      {
        title: "La deuda queda guardada",
        text: "Con fecha, monto y los productos que se llevó.",
      },
      {
        title: "Registra los abonos",
        text: "Cuando el cliente paga una parte, la deuda baja sola.",
      },
      {
        title: "Sabes cuánto te deben",
        text: "El total por cobrar siempre a la vista.",
      },
    ],
    Screen: FiadoScreen,
  },
  {
    id: "inventario",
    tab: "Inventario",
    icon: Boxes,
    title: "Sabe qué se acaba y qué se vence",
    blurb:
      "Alertas para reponer a tiempo y vender lo perecedero antes de que se pierda.",
    steps: [
      {
        title: "Tu inventario, de un vistazo",
        text: "El stock se actualiza con cada venta.",
      },
      {
        title: "Aviso de stock bajo",
        text: "Cuando un producto baja de su mínimo, se marca.",
      },
      {
        title: "Aviso de vencimiento",
        text: "Los productos que vencen en los próximos 30 días quedan destacados.",
      },
      {
        title: "Ponlo en oferta",
        text: "Con un toque aplicas un 20 % de descuento y lo vendes antes de perderlo.",
      },
    ],
    Screen: InventarioScreen,
  },
  {
    id: "reporte",
    tab: "Reporte diario",
    icon: Send,
    title: "Recibe el resumen de tu tienda en Telegram",
    blurb: "Sin abrir el sistema sabes cómo te fue y qué toca reponer.",
    steps: [
      {
        title: "Vendes como siempre",
        text: "Cada venta queda registrada.",
      },
      {
        title: "posib arma el resumen",
        text: "A la hora que elijas revisa ventas, stock y fiados.",
      },
      {
        title: "Te llega a Telegram",
        text: "También puedes agregar a un empleado para que lo reciba.",
      },
    ],
    Screen: ReporteScreen,
  },
  {
    id: "tienda",
    tab: "Tienda online",
    icon: Store,
    badge: "Complemento opcional",
    title: "Vende también por internet",
    blurb: "Tus clientes piden desde el celular y tú confirmas el pago.",
    steps: [
      {
        title: "Tu tienda en línea",
        text: "Muestra tus productos con foto y precio.",
      },
      {
        title: "El cliente arma su pedido",
        text: "Agrega al carrito desde su celular.",
      },
      {
        title: "Paga con Nequi",
        text: "Deja la referencia del pago al enviar el pedido.",
      },
      {
        title: "Tú confirmas",
        text: "Revisas el pago, confirmas y el stock se descuenta.",
      },
    ],
    Screen: TiendaScreen,
  },
];
