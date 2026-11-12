/**
 * Marcado del logo (solo ícono) como texto, para lugares donde no se puede
 * montar un componente de React, como el `iconHtml` de SweetAlert.
 * Requiere que posib-logo.css ya esté cargado (lo carga <PosibLogo />).
 */
export function posibLogoIconHtml(size = 72, modifiers = ""): string {
  return (
    `<span class="posib-logo posib-logo--icon-only ${modifiers}" style="--posib-size:${size}px" role="img" aria-label="posib.dev">` +
    `<span class="posib-logo__icon" aria-hidden="true">` +
    `<span class="posib-logo__stem"></span>` +
    `<span class="posib-logo__ring"></span>` +
    `<span class="posib-logo__dot"></span>` +
    `</span></span>`
  );
}
