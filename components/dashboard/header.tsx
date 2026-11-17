'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { useUser } from '@clerk/nextjs';
import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import { Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { NotificationPanel } from './notification-panel';
import { OpenWindowButton } from './open-window-button';
import HelpButton from '@/components/help/HelpButton';
import StoreSwitcher from '@/components/layout/StoreSwitcher';
import { ThemeToggle } from '@/components/HourTheme';
import { AccessibilityMenu } from '@/components/a11y/AccessibilityMenu';

const UserButtonClient = dynamic(
  () => import('@clerk/nextjs').then((mod) => ({ default: mod.UserButton })),
  { ssr: false }
);

interface HeaderProps {
  onMenuClick?: () => void;
  /**
   * Solo la bandeja de acciones, flotando a la derecha dentro del contenido
   * (escritorio, páginas sin saludo): el contenido sube y ocupa ese espacio.
   */
  floating?: boolean;
  /**
   * Con `floating`: fija la bandeja arriba a la derecha sin que el contenido la
   * rodee. Para páginas cuya cuadrícula se angostaría entera junto a un float
   * (Punto de Venta); la página deja libre ese espacio (ver HEADER_TRAY_SPACE).
   */
  pinned?: boolean;
}

/** Alto que una página con bandeja fija (`pinned`) debe dejar libre arriba a la derecha. */
export const HEADER_TRAY_SPACE = 'md:pt-16';

/** "Buenos días" / "Buenas tardes" / "Buenas noches" y la fecha de hoy en español. */
function readGreeting() {
  const now = new Date();
  const hour = now.getHours();
  const saludo = hour < 12 ? 'Buenos días' : hour < 19 ? 'Buenas tardes' : 'Buenas noches';
  const fecha = new Intl.DateTimeFormat('es-CO', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(now);
  return `${saludo}|${fecha}`;
}

const noSubscribe = () => () => {};

// Se lee en el navegador (hora local del tendero); en el servidor no hay saludo,
// así se evita un desajuste de hidratación.
function useGreeting() {
  const value = useSyncExternalStore(noSubscribe, readGreeting, () => null);
  if (!value) return null;
  const [saludo, fecha] = value.split('|');
  return { saludo, fecha };
}

// El saludo solo se muestra en el Panel de control. Se escribe letra por letra
// la primera vez por carga del sistema; al volver al Panel sale completo.
let greetingTyped = false;

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Escribe la fecha y luego el saludo letra por letra, con un cursor que
 * desaparece al terminar. Solo la primera vez por carga del sistema. Con
 * movimiento reducido se muestra de una.
 */
function TypedGreeting({ fecha, saludo }: { fecha: string; saludo: string }) {
  const total = fecha.length + saludo.length;
  const [count, setCount] = useState(() =>
    greetingTyped || prefersReducedMotion() ? total : 0
  );

  useEffect(() => {
    if (count >= total) {
      greetingTyped = true;
      return;
    }
    // La fecha va rápida; pausa breve antes del saludo, que va más pausado.
    const delay = count < fecha.length ? 22 : count === fecha.length ? 260 : 55;
    const timer = setTimeout(() => setCount((c) => c + 1), delay);
    return () => clearTimeout(timer);
  }, [count, total, fecha.length]);

  const typingFecha = count < fecha.length;
  const done = count >= total;

  return (
    <>
      {/* Los lectores de pantalla leen la frase completa (aria-label), no letra por letra. */}
      <p className="h-4 text-xs text-gray-500 first-letter:uppercase" aria-label={fecha}>
        <span aria-hidden="true">{fecha.slice(0, count)}</span>
        {typingFecha && <span className="typing-caret" aria-hidden="true" />}
      </p>
      <h2
        className="truncate text-lg md:text-[1.6rem] font-semibold leading-tight text-gray-900"
        aria-label={saludo}
      >
        <span aria-hidden="true">{saludo.slice(0, Math.max(0, count - fecha.length))}</span>
        {!typingFecha && !done && <span className="typing-caret" aria-hidden="true" />}
        {/* Reserva la altura de la línea mientras aún no hay letras. */}
        {count <= fecha.length && <span aria-hidden="true">&nbsp;</span>}
      </h2>
    </>
  );
}

export function Header({ onMenuClick, floating = false, pinned = false }: HeaderProps) {
  const { user, isLoaded } = useUser();
  const greeting = useGreeting();
  const pathname = usePathname();
  const showGreeting = pathname === '/dashboard';
  const name = user?.firstName || user?.emailAddresses[0]?.emailAddress?.split('@')[0];

  // Bandeja de acciones: una sola pieza en vez de íconos sueltos.
  const tray = (
    <div className="flex items-center gap-0.5 sm:gap-1 shrink-0 rounded-2xl bg-white p-1 ring-1 ring-[var(--shell-line)] shadow-[var(--shell-shadow)] text-gray-700">
      <StoreSwitcher />

      {/* La campana es visible también en móvil: si no, el tendero no puede
          abrir el panel para ver/marcar sus notificaciones (y el aviso seguiría
          activo sin forma de atenderlo). */}
      <NotificationPanel />

      <ThemeToggle className="inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-xl text-gray-700 transition-colors hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50" />

      <AccessibilityMenu
        showPosOptions
        className="inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-xl text-gray-700 transition-colors hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
      />

      {/* Solo visible cuando corre como PWA instalada (standalone). */}
      <OpenWindowButton />

      <HelpButton />

      <span className="mx-1 h-6 w-px bg-[var(--shell-line)]" aria-hidden="true" />

      <div className="flex h-9 w-9 items-center justify-center">
        <UserButtonClient
          afterSignOutUrl="/"
          appearance={{ elements: { avatarBox: 'rounded-xl' } }}
        />
      </div>
    </div>
  );

  if (floating) {
    return (
      <div className={pinned ? 'absolute right-8 top-4 z-10' : 'float-right relative z-10 mb-3 ml-4'}>
        {tray}
      </div>
    );
  }

  return (
    <header className="app-titlebar sticky top-0 z-10 flex h-16 md:h-20 items-center gap-3 bg-[color-mix(in_srgb,var(--shell-canvas)_88%,transparent)] px-4 md:px-8 backdrop-blur-md">
      <Button
        variant="ghost"
        size="icon"
        className="md:hidden shrink-0"
        onClick={onMenuClick}
        aria-label="Abrir menú"
      >
        <Menu className="h-6 w-6" />
      </Button>

      {/* Saludo con la fecha: solo en el Panel de control y oculto en móvil
          para dar espacio a las acciones. En las demás páginas queda el espacio. */}
      <div className={showGreeting ? 'hidden sm:block flex-1 min-w-0' : 'hidden'}>
        {!showGreeting ? null : greeting && isLoaded ? (
          <TypedGreeting
            key={`${greeting.fecha}|${greeting.saludo}|${name ?? ''}`}
            fecha={greeting.fecha}
            saludo={name ? `${greeting.saludo}, ${name}` : greeting.saludo}
          />
        ) : (
          // Mientras carga el usuario: mismo alto, sin texto (evita un "Hola," que luego cambia).
          <>
            <p className="h-4" />
            <h2 className="text-lg md:text-[1.6rem] font-semibold leading-tight">&nbsp;</h2>
          </>
        )}
      </div>

      {/* Empujar las acciones a la derecha cuando no hay saludo (móvil u otras páginas). */}
      <div className={showGreeting ? 'flex-1 sm:hidden' : 'flex-1'} />

      {tray}
    </header>
  );
}
