import {
  AlertTriangle,
  BookX,
  CalendarX,
  CircleDollarSign,
  CloudOff,
  HelpCircle,
  Landmark,
  PackageX,
  Timer,
  type LucideIcon,
} from "lucide-react";

interface Problem {
  icon: LucideIcon;
  problem: string;
  solution: string;
}

/**
 * "Problemas que soluciona posib": dolores reales de la tienda de barrio,
 * cada uno con la función de posib que lo resuelve. Solo funciones que ya
 * existen en el sistema.
 */
const PROBLEMS: Problem[] = [
  {
    icon: HelpCircle,
    problem: "“No sé cuánto vendí hoy”",
    solution:
      "Cada venta queda registrada y en la mañana te llega por Telegram o correo el resumen del día anterior.",
  },
  {
    icon: BookX,
    problem: "“El cuaderno de fiados se pierde o se moja”",
    solution:
      "Los fiados quedan guardados con fecha, monto y abonos, y posib te avisa a quién cobrar.",
  },
  {
    icon: PackageX,
    problem: "“Se me agotan los productos que más vendo”",
    solution:
      "Avisos de stock bajo y una lista de qué pedir antes de quedarte sin mercancía.",
  },
  {
    icon: CalendarX,
    problem: "“Se me vencen productos en la estantería”",
    solution:
      "Te avisa qué está por vencer para ponerlo en oferta a tiempo y no perder la plata.",
  },
  {
    icon: CircleDollarSign,
    problem: "“La caja no me cuadra al final del día”",
    solution:
      "Abres y cierras caja con cuadre: sabes cuánto debía haber en efectivo y cuánto hay.",
  },
  {
    icon: AlertTriangle,
    problem: "“No sé si estoy ganando o perdiendo”",
    solution:
      "Ves la ganancia de cada venta y un informe mensual con lo que más plata te deja.",
  },
  {
    icon: Landmark,
    problem: "“Me da miedo que la DIAN me obligue a facturar”",
    solution:
      "posib suma tus ventas del año y te avisa antes de llegar al tope de facturación electrónica.",
  },
  {
    icon: CloudOff,
    problem: "“Si se daña el computador, pierdo todo”",
    solution:
      "Todo queda en la nube y puedes sacar copia diaria de tus ventas a tu Google Drive.",
  },
  {
    icon: Timer,
    problem: "“Cobrar es lento y se hace fila”",
    solution:
      "Lector de código de barras o la cámara del celular, cobro por Nequi con QR y factura al instante.",
  },
];

export default function ProblemsSolved() {
  return (
    <section className="lp-section-sep border-t" aria-labelledby="problemas-titulo">
      <div className="container mx-auto px-4 py-16 md:py-24">
        <div className="text-center mb-12 md:mb-16">
          <p className="text-xs font-semibold uppercase tracking-widest text-brand mb-3">
            Problemas que soluciona posib
          </p>
          <h2 id="problemas-titulo" className="lp-text text-2xl sm:text-3xl md:text-4xl font-bold mb-4">
            Lo que le quita el sueño al tendero, resuelto
          </h2>
          <p className="lp-muted text-base max-w-lg mx-auto">
            Los dolores de cabeza de todos los días en una tienda de barrio, y cómo posib te ayuda con cada uno.
          </p>
        </div>

        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6 max-w-6xl mx-auto">
          {PROBLEMS.map(({ icon: Icon, problem, solution }) => (
            <li key={problem} className="lp-card lp-border rounded-2xl ring-1 p-5 md:p-6">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <h3 className="lp-text text-base font-bold leading-snug">{problem}</h3>
                  <p className="lp-muted mt-2 text-sm leading-relaxed">
                    <span className="font-semibold text-brand">Con posib: </span>
                    {solution}
                  </p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
