import { KernelSwitcher } from '@/components/system/KernelSwitcher';

export function KernelPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">LINBO Kernel</h1>
        <p className="text-muted-foreground">
          Kernel-Varianten verwalten und zwischen Versionen wechseln
        </p>
      </div>

      <KernelSwitcher />
    </div>
  );
}
