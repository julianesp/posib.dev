import Link from "next/link";
import { ArrowRight, LogIn, Rocket } from "lucide-react";

/**
 * Par de accesos "crear cuenta" / "entrar" de la landing.
 *
 * En el celular van en DOS COLUMNAS como mosaicos grandes (ícono + título +
 * subtítulo), separados entre sí: apilados y pegados era fácil tocar el que no
 * era. Desde sm vuelven a ser dos botones en fila.
 *
 * Son <Link> con estilo de botón (antes era un <button> dentro de un <a>,
 * que no es HTML válido).
 */
export default function AuthCtas({
  primaryLabel = "Empezar gratis 30 días",
}: {
  primaryLabel?: string;
}) {
  const focusRing =
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2";

  return (
    <>
      {/* Celular: dos columnas */}
      <div className="grid grid-cols-2 gap-4 sm:hidden">
        <Link
          href="/sign-up"
          className={`flex min-h-32 flex-col items-center justify-center gap-2 rounded-2xl bg-brand px-3 py-4 text-center !text-white shadow-lg shadow-brand/25 transition-colors hover:bg-brand-hover active:scale-[0.98] ${focusRing}`}
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/20">
            <Rocket className="h-5 w-5" aria-hidden="true" />
          </span>
          <span className="text-sm font-semibold leading-tight">Crear cuenta</span>
          <span className="text-xs leading-tight !text-white/85">Gratis 30 días</span>
        </Link>
        <Link
          href="/sign-in"
          className={`lp-ghost-btn flex min-h-32 flex-col items-center justify-center gap-2 rounded-2xl border px-3 py-4 text-center transition-colors active:scale-[0.98] ${focusRing}`}
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand/10 text-brand">
            <LogIn className="h-5 w-5" aria-hidden="true" />
          </span>
          <span className="text-sm font-semibold leading-tight">Entrar</span>
          <span className="lp-muted text-xs leading-tight">Ya tengo cuenta</span>
        </Link>
      </div>

      {/* Tablet y escritorio: dos botones en fila */}
      <div className="hidden justify-center gap-3 sm:flex">
        <Link
          href="/sign-up"
          className={`inline-flex h-12 items-center justify-center rounded-md bg-brand px-7 text-sm font-semibold !text-white shadow-lg shadow-brand/20 transition-colors hover:bg-brand-hover ${focusRing}`}
        >
          {primaryLabel}
          <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
        </Link>
        <Link
          href="/sign-in"
          className={`lp-ghost-btn inline-flex h-12 items-center justify-center rounded-md border px-7 text-sm font-medium transition-colors ${focusRing}`}
        >
          Ya tengo cuenta
        </Link>
      </div>
    </>
  );
}
