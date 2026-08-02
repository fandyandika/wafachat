import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export default function OfflinePage() {
  return (
    <main className="grid min-h-screen place-items-center bg-background p-6 text-foreground">
      <Card className="w-full max-w-sm text-center">
        <CardHeader>
          <CardTitle>Koneksi terputus</CardTitle>
          <CardDescription>Periksa koneksi internet, lalu coba kembali ke panel.</CardDescription>
        </CardHeader>
        <CardContent>
          <a className={cn(buttonVariants(), 'w-full')} href="/panel">
            Coba lagi
          </a>
        </CardContent>
      </Card>
    </main>
  );
}
