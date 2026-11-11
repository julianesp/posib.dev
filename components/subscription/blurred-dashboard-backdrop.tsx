import {
  BarChart3,
  Boxes,
  CreditCard,
  LayoutDashboard,
  Package,
  ShoppingCart,
  Users,
  Wallet,
} from "lucide-react";

const MENU = [
  { icon: LayoutDashboard, label: "Panel de control" },
  { icon: ShoppingCart, label: "Punto de Venta" },
  { icon: Package, label: "Productos" },
  { icon: BarChart3, label: "Ventas" },
  { icon: Users, label: "Clientes" },
  { icon: Wallet, label: "Deudores" },
  { icon: Boxes, label: "Inventario" },
  { icon: CreditCard, label: "Suscripción" },
];

const BARS = [38, 62, 48, 80, 55, 92, 70, 45, 66, 85, 58, 74];

/**
 * Fondo decorativo del modal de suscripción vencida: una maqueta del panel de
 * control (menú, tarjetas, gráfico) que se ve borrosa detrás del aviso, para
 * que el usuario sienta que su sistema sigue ahí esperando la renovación.
 *
 * NO usa datos reales ni monta el dashboard de verdad (con la suscripción
 * vencida la API los bloquea, y no debe quedar nada interactivo debajo): son
 * solo cajas de relleno. Va oculto a lectores de pantalla e inerte.
 */
export function BlurredDashboardBackdrop() {
  return (
    <div
      aria-hidden="true"
      // @ts-expect-error `inert` es válido en el DOM; React 19 lo acepta como booleano
      inert=""
      className="pointer-events-none absolute inset-0 select-none overflow-hidden"
    >
      {/* scale: evita que el desenfoque deje un borde claro en los extremos */}
      <div className="flex h-full w-full scale-105 blur-md">
        {/* Menú lateral */}
        <aside className="hidden w-64 shrink-0 border-r border-gray-200 bg-white/80 p-4 md:block">
          <div className="mb-6 h-9 w-32 rounded-lg bg-brand/70" />
          <div className="space-y-1.5">
            {MENU.map(({ icon: Icon, label }, i) => (
              <div
                key={label}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium ${
                  i === 0 ? "bg-brand-light text-brand" : "text-gray-700"
                }`}
              >
                <Icon className="h-5 w-5" />
                {label}
              </div>
            ))}
          </div>
        </aside>

        {/* Contenido */}
        <div className="flex-1 space-y-5 p-5 md:p-8">
          <div className="flex items-center justify-between">
            <div className="space-y-2">
              <div className="h-7 w-56 rounded-md bg-gray-300" />
              <div className="h-4 w-36 rounded-md bg-gray-200" />
            </div>
            <div className="h-10 w-40 rounded-full bg-white/80" />
          </div>

          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            {["Ventas de hoy", "Productos", "Clientes", "Ganancia"].map(
              (label) => (
                <div
                  key={label}
                  className="rounded-2xl border border-gray-200 bg-white/90 p-4"
                >
                  <p className="text-sm font-medium text-gray-600">{label}</p>
                  <div className="mt-3 h-8 w-24 rounded-md bg-gray-300" />
                  <div className="mt-2 h-3 w-16 rounded bg-gray-200" />
                </div>
              ),
            )}
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <div className="rounded-2xl border border-gray-200 bg-white/90 p-5 lg:col-span-2">
              <p className="mb-4 text-sm font-medium text-gray-600">
                Ventas de la semana
              </p>
              <div className="flex h-44 items-end gap-2">
                {BARS.map((h, i) => (
                  <div
                    key={i}
                    className="flex-1 rounded-t-md bg-brand/60"
                    style={{ height: `${h}%` }}
                  />
                ))}
              </div>
            </div>
            <div className="space-y-3 rounded-2xl border border-gray-200 bg-white/90 p-5">
              <p className="text-sm font-medium text-gray-600">
                Productos más vendidos
              </p>
              {[80, 64, 52, 40, 28].map((w, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="h-9 w-9 shrink-0 rounded-lg bg-gray-200" />
                  <div
                    className="h-3 rounded bg-gray-300"
                    style={{ width: `${w}%` }}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
