import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'posib.dev - Sistema POS para tiendas en Colombia',
    short_name: 'posib.dev',
    description: 'Sistema POS de punto de venta, inventario y facturación para tiendas y negocios en Colombia',
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#007C80',
    orientation: 'portrait',
    icons: [
      {
        src: '/icon-192x192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icon-512x512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icon-maskable-512x512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
