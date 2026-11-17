import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Crear un Intl.NumberFormat es costoso: con catálogos de miles de productos
// (el POS dibuja dos precios por tarjeta) se notaba en equipos lentos.
const COP_FORMATTER = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  minimumFractionDigits: 0,
});

export function formatCurrency(amount: number): string {
  return COP_FORMATTER.format(amount);
}

// Algunos registros legacy guardaban las fechas como Firestore Timestamp
// (un objeto con método `toDate()`); la API actual devuelve un string ISO.
export type LegacyTimestamp = { toDate: () => Date };

function hasToDate(value: unknown): value is LegacyTimestamp {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as LegacyTimestamp).toDate === 'function'
  );
}

/**
 * Normaliza una fecha que puede venir como string ISO o como Firestore Timestamp.
 */
export function toJsDate(value: string | LegacyTimestamp): Date {
  return hasToDate(value) ? value.toDate() : new Date(value);
}

export function formatDate(date: Date | string): string {
  return new Intl.DateTimeFormat('es-CO', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date(date));
}

export function formatDateTime(date: Date | string): string {
  return new Intl.DateTimeFormat('es-CO', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(date));
}
