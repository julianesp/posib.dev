# posib.dev

Sistema de punto de venta (POS) en la nube para tiendas de barrio en Colombia. Es un SaaS multi-tienda: cada tendero tiene su propia tienda, con inventario, ventas, fiado, reportes y, si quiere, una tienda online pública.

🌐 [posib.dev](https://posib.dev)

## Funcionalidades

**Punto de venta**
- Venta con lector de código de barras USB o la cámara del celular
- Carrito compacto con "Procesar Venta" siempre visible
- Pago en efectivo, tarjeta, transferencia, Nequi o **fiado**
- **Cierre de caja**: apertura con base, entradas y salidas de efectivo y cuadre al cerrar
- Modo **offline**: se puede vender sin internet y las ventas se sincronizan después

**Inventario y productos**
- Productos con categorías, código de barras, precios y stock
- Alertas de stock bajo y de productos próximos a vencer, con ofertas de un clic
- Proveedores, órdenes de compra y estadísticas de compras
- Importación de productos y ventas desde **Siigo**
- Rentabilidad por producto

**Clientes**
- Fiado (cuentas por cobrar) con cupo, abonos y recordatorios de deuda
- Programa de puntos de fidelidad

**Reportes e IA**
- Dashboard con métricas del día, la semana y el mes
- Informe mensual de ventas en PDF y reportes automáticos por correo
- Análisis con IA (Gemini): predicciones, recomendaciones y revisión del catálogo
- Exportación a Excel y respaldos

**Tienda online** (complemento)
- Catálogo público por tienda en `/store/[slug]`
- Carrito, zonas de envío y pago por Nequi con comprobante en PDF
- Pedidos que llegan por WhatsApp y Telegram y se gestionan en "Pedidos web"

**Otros**
- Equipo de trabajo con roles (`admin`, `cajero` y permisos personalizados)
- Facturación electrónica DIAN y aviso de topes de facturación
- Email marketing
- Tema claro/oscuro automático según la hora y color propio para cada tienda
- PWA instalable en el celular, con notificaciones
- Panel de superadministrador para gestionar todas las tiendas

## Planes

| Plan | Precio mensual |
|---|---|
| Tienda / Minimercado (incluye IA y email marketing) | $24.900 COP |
| Complemento Tienda Online | $14.900 COP |

Todas las cuentas nuevas tienen **30 días de prueba gratis**. Los pagos se procesan con **ePayco**. Los precios se definen en `lib/business-types.ts` y `lib/epayco.ts`.

## Arquitectura

```
Navegador / PWA
      │
      ▼
Next.js 16 (App Router) ── Clerk (autenticación)
      │  JWT de Clerk
      ▼
Cloudflare Worker (Hono) ── Cloudflare D1 (SQLite)
      │
      ├─ Resend (correos)       ├─ Cloudinary (imágenes)
      ├─ ePayco (pagos)         └─ Gemini (IA)
```

- **Frontend** (raíz del repo): Next.js 16, React 19, Tailwind CSS v4, Radix UI. El middleware de Clerk está en `proxy.ts`.
- **Backend** (`cloudflare-migration/`): API en un Cloudflare Worker con Hono y base de datos D1. Se despliega por separado con `wrangler`. También tiene el cron horario que envía reportes, alertas de stock y recordatorios.
- El cliente HTTP del front está en `lib/cloudflare-api.ts`. Cada petición lleva el token de Clerk y la tienda activa.

## Desarrollo local

Requisitos: Node.js 22 y **pnpm**. No uses npm ni yarn en la raíz, porque desajustan el lockfile.

```bash
pnpm install
cp .env.example .env.local   # y completa los valores
pnpm dev                     # http://localhost:3000
```

### Variables de entorno

| Grupo | Variables |
|---|---|
| Clerk | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_SIGN_IN_URL`, `NEXT_PUBLIC_CLERK_SIGN_UP_URL` |
| App | `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_URL`, `NEXT_PUBLIC_CLOUDFLARE_API_URL` |
| ePayco | `EPAYCO_P_CUST_ID_CLIENTE`, `NEXT_PUBLIC_EPAYCO_PUBLIC_KEY`, `EPAYCO_PRIVATE_KEY`, `EPAYCO_P_KEY`, `NEXT_PUBLIC_EPAYCO_ENV` |
| Cloudinary | `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME`, `NEXT_PUBLIC_CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` |
| Servicios | `GEMINI_API_KEY`, `RESEND_API_KEY`, `CRON_SECRET` |

`.env.example` tiene la lista completa con comentarios.

> El Worker debe usar las **mismas llaves de Clerk** que el front. Si no coinciden, aparecen errores falsos de "Unauthorized" o "suscripción vencida".

### Worker (backend)

```bash
cd cloudflare-migration
npm ci
npx wrangler dev       # local
npx wrangler deploy    # producción
```

Consulta `cloudflare-migration/DEPLOYMENT_GUIDE.md` para los secretos y las migraciones de D1.

## Comandos

```bash
pnpm dev            # servidor de desarrollo (Turbopack)
pnpm build          # build de producción
pnpm lint           # ESLint
pnpm test           # pruebas Jest (lógica, UI y rutas del Worker)
pnpm e2e            # pruebas end-to-end con Playwright
```

GitHub Actions ejecuta `pnpm test` en cada push y PR a `main`.

## Estructura

```
app/
  dashboard/        # panel del tendero: pos, products, inventory, customers,
                    # debtors, suppliers, sales, offers, analytics, rentabilidad,
                    # web-orders, team, subscription, superadmin…
  store/[slug]/     # tienda online pública
  api/              # webhooks (ePayco), IA, reportes, facturas DIAN, subidas
components/         # componentes de UI
lib/                # cliente de la API, helpers de negocio y tipos
cloudflare-migration/  # Worker de Cloudflare (Hono + D1)
tests/ , e2e/       # pruebas Jest y Playwright
docs/               # guías (reportes automáticos, tours, DIAN)
```

## Licencia

[MIT](LICENSE)
