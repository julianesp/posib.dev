# Módulo Facturación Electrónica DIAN (fe-dian)

Generación de la Factura Electrónica de Venta según el **Anexo Técnico v1.9**
(Resolución 000165/2023). Análisis completo en `docs/dian/ANALISIS-FE-posib.md`
(raíz del repo Next.js) y PDF oficial en `docs/dian/`.

## Estado

| Pieza | Estado | Requiere certificado |
|---|---|---|
| **CUFE** (`cufe.ts`) — SHA-384 | ✅ Hecho y **verificado contra el ejemplo oficial** | No |
| **XML UBL 2.1 Invoice** (`xml.ts`) | ✅ Estructura mínima (emisor, adquiriente, líneas, IVA, CUFE) | No |
| Firma XAdES-EPES | ⏳ Pendiente (marcador `{{FIRMA_XADES}}` en el XML) | **Sí (.p12)** |
| Bloque `sts:DianExtensions` (QR, código seguridad software) | ⏳ Pendiente | Parcial |
| Envío SOAP (SendTestSetAsync / SendBillSync / GetStatus) | ⏳ Pendiente | Sí |
| Notas crédito/débito, contingencia, PDF+QR | ⏳ Pendiente | — |

## Por qué se puede avanzar sin gastar

El **CUFE** y el **XML** no requieren el certificado de firma (~$388.773/año, aún
no adquirido — ver memoria del proyecto). Solo la firma y el envío real a la DIAN
lo necesitan. El CUFE es verificable de forma aislada contra el vector oficial del
anexo, así que su corrección está garantizada.

## Ejecutar las verificaciones

```bash
cd cloudflare-migration
npx tsx src/lib/fe-dian/cufe.test.ts   # valida el CUFE contra el ejemplo DIAN
npx tsx src/lib/fe-dian/xml.demo.ts    # genera un XML de ejemplo y lo chequea
```

## Limitaciones actuales (a completar cuando se retome)

- Solo IVA (impuesto 01). INC (04) e ICA (03) están contemplados en el CUFE pero
  no se emiten como `<TaxSubTotal>` en el XML todavía.
- El XML es la estructura mínima: faltan `sts:DianExtensions`, notas de pago,
  descuentos/recargos, y validación estricta contra los XSD de la DIAN.
- Falta cargar los catálogos oficiales (municipios DANE, unidades, etc.).

## Próximos pasos sugeridos

1. Validar el XML generado contra los **XSD oficiales** de la DIAN (caja de herramientas v1.9).
2. Completar `sts:DianExtensions` (InvoiceControl con rango/clave técnica, QR).
3. Al tener certificado: implementar la firma **XAdES-EPES** (§10 del anexo) y el
   **envío SOAP** (§7). Verificar primero que WebCrypto del runtime de Workers
   soporte la canonicalización/firma, o elegir librería compatible.
