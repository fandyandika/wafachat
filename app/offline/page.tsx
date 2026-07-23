export default function OfflinePage() {
  return (
    <main className="grid min-h-screen place-items-center bg-background p-6 text-center text-foreground">
      <section className="max-w-sm space-y-3">
        <h1 className="text-2xl font-semibold">Koneksi terputus</h1>
        <p className="text-sm text-muted-foreground">Periksa internet, lalu buka kembali WaFaChat.</p>
        <a className="inline-flex h-9 items-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground" href="/panel">Coba lagi</a>
      </section>
    </main>
  );
}
