// Brand attribution shown at the bottom of every page. Static string
// — not put into the i18n bundle on purpose; the agency name is a
// brand, not a translatable label.
export function SiteFooter() {
  return (
    <footer className="mt-12 border-t py-4 text-center text-xs text-muted-foreground">
      <p>Powered by Quantum Tech Agency</p>
    </footer>
  );
}
