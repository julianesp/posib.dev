# Facturación electrónica DIAN — software propio (`lib/fe-dian`)

Factura electrónica de venta, nota crédito y nota débito según el **Anexo
Técnico v1.9** (Resolución 000165/2023), en modo **software propio**: cada
tienda se habilita ante la DIAN con su NIT, su certificado y posib como
software. Anexo y análisis en `docs/dian/`.

Todo el módulo usa solo WebCrypto, `@xmldom/xmldom`, `fflate` y `node-forge`
(JavaScript puro), así que corre en Node, Vercel y Cloudflare Workers.

## Piezas

| Archivo | Qué hace | Cómo se comprobó |
|---|---|---|
| `cufe.ts` | CUFE, CUDE y código de seguridad del software (SHA-384) | Reproduce los hashes de ejemplo **oficiales** del anexo (§11.2 y §11.4.3) |
| `xml.ts` | XML UBL 2.1 de Invoice / CreditNote / DebitNote con `sts:DianExtensions` | Valida contra los **XSD oficiales UBL 2.1** de OASIS (xmllint); el CUFE se recalcula leyendo el propio XML |
| `c14n.ts` | Canonicalización C14N inclusiva y exclusiva | Pruebas de los casos del estándar |
| `certificado.ts` | Lee el `.p12`, ordena la cadena y revisa que el certificado sirva para la DIAN | Pruebas con certificados de forge y de OpenSSL |
| `firma.ts` | Firma XAdES-EPES (RSA-SHA256, política DIAN v2) | La firma la acepta **xml-crypto**, un verificador independiente; alterar documento u hora de firma la invalida |
| `soap.ts` | Cliente del web service DIAN con WS-Security: SendTestSetAsync, GetStatusZip, SendBillSync, GetStatus, GetNumberingRange | Sobre firmado verificado con xml-crypto; nombres de parámetros iguales al WSDL real de habilitación |
| `set-pruebas.ts` | Genera los documentos del set de pruebas | — |

Pruebas: `pnpm test lib/__tests__/fe-dian` (27 pruebas).

## Habilitar una tienda

1. **En el portal de la DIAN** (con el usuario de la tienda): Facturando
   electrónicamente → Habilitación → modo de operación **Software propio** →
   registrar el software (nombre "posib", PIN de 5 dígitos elegido). La DIAN da
   el **Software ID** y el **Test Set ID**, y muestra cuántos documentos pide el set.
2. **Certificado de firma** `.p12` a nombre de la tienda, de una entidad
   acreditada por la ONAC. El certificado gratuito de la DIAN **no sirve** para
   software propio.
3. `cp .env.fe-dian.example .env.fe-dian` y llenar los datos.
4. `pnpm fe:habilitacion revisar`: valida el certificado y genera los XML firmados sin enviar.
5. `pnpm fe:habilitacion rangos`: confirma la numeración de prueba (prefijo SETP y clave técnica).
6. `pnpm fe:habilitacion enviar`, esperar 1 o 2 minutos y luego `pnpm fe:habilitacion estado`.
7. Corregir lo que la DIAN rechace (cada error trae su regla, p. ej. `FAJ43b`) y
   reenviar: cada corrida usa consecutivos nuevos. Cuando el portal marque el
   set como **Aceptado**, la tienda pasa a **Habilitado**.
8. Después, en el portal: pedir la **resolución de numeración** de producción,
   asociarla al software y consultar la clave técnica con `GetNumberingRange`
   en producción.

## Pendiente para producción

- Guardar el certificado de cada tienda cifrado (D1 + clave en secret) y
  abrirlo una sola vez (abrir un `.p12` consume mucha CPU).
- Emitir desde el POS: tabla de documentos electrónicos con estado
  (pendiente/enviado/aceptado/rechazado), envío con `SendBillSync` y reintentos.
  Así un fallo de la DIAN no bloquea la venta.
- Convertir los precios del POS (que incluyen IVA) a base + impuesto por línea.
- AttachedDocument + PDF con QR para enviar al cliente, y contingencia.
- Datos de la tienda en Configuración (NIT, DV, responsabilidades, DANE).
