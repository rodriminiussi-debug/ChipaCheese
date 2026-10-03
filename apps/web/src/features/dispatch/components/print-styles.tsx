/**
 * Para las hojas imprimibles: al imprimir se oculta el menú lateral y el encabezado del celular,
 * y el contenido ocupa toda la página.
 */
export function PrintStyles() {
  return (
    <style>{`
      @media print {
        [data-slot="sidebar"], [data-slot="sidebar-gap"], [data-slot="sidebar-container"] { display: none !important; }
        [data-slot="sidebar-inset"] > header { display: none !important; }
        [data-slot="sidebar-inset"] > div { max-width: none !important; padding: 0 !important; }
        body { background: #fff !important; }
        @page { margin: 12mm; }
      }
    `}</style>
  );
}
