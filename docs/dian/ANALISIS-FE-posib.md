# Facturación electrónica de venta (DIAN) en posib.dev — Análisis técnico

Basado en el **Anexo Técnico de la Factura Electrónica de Venta v1.9** (Resolución
000165 del 01/NOV/2023), el documento oficial vigente. PDF descargado en
`docs/dian/Anexo-Tecnico-FE-v1.9.pdf` (753 páginas).

## Estado del usuario

- Ya **registrado** ante la DIAN (lo hizo para cargar ventas en "neurai").
- Falta pasar a **habilitado con modo de operación "Software propio"**.
- Meta: FE como **función real de posib.dev**, sin pagar un proveedor tecnológico.

## Bloqueante legal/administrativo: el certificado de firma

- El **certificado gratuito de la DIAN NO sirve para software propio** — solo funciona
  dentro del software gratuito de la DIAN. Para posib.dev hay que comprar uno **de pago**.
- Entidades acreditadas por ONAC: Certicámara, GSE, Andes SCD, Camerfirma, Thomas Signe.
- Precio de referencia (2026): **~$250.000 + IVA / año** (Andes SCD, persona natural);
  rango general $120.000–$250.000/año. Formato **`.p12` / `.pfx`**.
- **El certificado identifica al EMISOR.** Si posib.dev factura en nombre de cada tienda,
  cada cliente necesita su propio certificado, O posib.dev se habilita como
  **Proveedor Tecnológico (PT)** — habilitación más exigente. Esto define el modelo de precios.

## Set de pruebas para habilitarse (fuente oficial DIAN)

Modo **Software propio**: **6 facturas + 2 notas débito + 2 notas crédito**, enviadas
firmadas al ambiente de habilitación, validadas sin error → pasa de "Registrado" a "Habilitado".

## Los 6 pilares técnicos a construir (por venta)

1. **XML UBL 2.1** con la estructura del Anexo (Invoice / CreditNote / DebitNote /
   AttachedDocument / ApplicationResponse). 60+ catálogos de códigos.
2. **CUFE** — SHA-384 (ver fórmula abajo). Verificable con el ejemplo del anexo.
3. **Firma digital XAdES-EPES** (XMLDSig enveloped) con el `.p12`. Canonicalización
   `xml-c14n-20010315`, firma `RSAwithSHA256`. Ubicada en `ext:UBLExtensions`.
4. **Envío al web service SOAP** de la DIAN (validación previa) y manejo de respuesta:
   - `SendTestSetAsync` (set de pruebas / habilitación)
   - `SendBillSync` / `SendBillAsync` (producción)
   - `GetStatus` / `GetStatusZip` (consulta de estado)
5. **AttachedDocument** (contenedor) + **representación gráfica PDF** con QR + CUFE.
6. **Contingencia** (talonario) y **notas crédito/débito**.

## Fórmula del CUFE (sección 11.2, verificada con ejemplo del anexo)

```
CUFE = SHA-384(
  NumFac + FecFac + HorFac + ValFac +
  CodImp1(01) + ValImp1 + CodImp2(04) + ValImp2 + CodImp3(03) + ValImp3 +
  ValTot + NitOFE + NumAdq + ClTec + TipoAmbiente
)
```
- Valores con **2 decimales truncados**, punto decimal, sin separador de miles ni "$".
- Impuestos: 01=IVA, 04=INC, 03=ICA (0.00 si no aplican).
- `ClTec` = clave técnica del rango de facturación (la entrega la DIAN por rango).
- `TipoAmbiente`: 1=producción, 2=pruebas/habilitación.
- Ejemplo oficial (p.657) sirve como test unitario: la cadena dada debe producir el hash
  `8bb918b19ba22a694f1da11c643b5e9de39adf60311cf179179e9b33381030bcd4c3c3f156c506ed5908f9276f5bd9b4`.

## Encaje en la arquitectura de posib.dev

- El **Worker de Cloudflare** (`cloudflare-migration/`) es el lugar natural: genera el XML,
  calcula el CUFE, firma con el `.p12`, y llama el SOAP de la DIAN.
- **Precaución**: la firma XAdES-EPES depende de crypto (RSA/SHA + canonicalización XML).
  Verificar disponibilidad en el runtime de Workers (WebCrypto) o considerar una librería
  compatible; puede requerir pruebas tempranas antes de comprometer la arquitectura.
- Guardar el `.p12` como **secret** (`wrangler secret put`), nunca en el repo.
- Nueva tabla D1 para el estado de cada factura electrónica (CUFE, estado DIAN, XML, QR).

## Endpoints DIAN relevantes (sección 7 del anexo)

- Set de pruebas: `SendTestSetAsync`
- Producción: `SendBillSync` (síncrono) / `SendBillAsync` (asíncrono en lotes)
- Estado: `GetStatus`, `GetStatusZip`
- Numeración: `GetNumberingRange`

## Orden recomendado de trabajo

1. Comprar **un** certificado de firma (~$250k) para desarrollo/pruebas.
2. Construir generador **XML UBL 2.1 + CUFE + firma XAdES** (empezar por el CUFE, que es
   verificable de forma aislada con el ejemplo del anexo).
3. Integrar el **SOAP** y pasar el **set de pruebas** (6+2+2) en habilitación.
4. Representación gráfica (PDF+QR), notas crédito/débito, contingencia.
5. Recién entonces ofrecerlo a clientes reales (no antes de estar habilitado y probado).

## Advertencia sobre la clienta que factura con Siigo

No migrarla hasta tener el módulo **habilitado y probado**. Si la FE de posib falla, ella
incumple ante la DIAN. Que siga con Siigo mientras tanto.
