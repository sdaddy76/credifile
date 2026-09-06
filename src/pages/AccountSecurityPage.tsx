import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import AccountSecurityPanel from '@/components/AccountSecurityPanel';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { authenticatedHome } from '@/lib/mfa';

export default function AccountSecurityPage() {
  const navigate = useNavigate();
  const { role } = useAuth();

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
              <ShieldCheck className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-bold">Sicurezza account</h1>
              <p className="text-xs text-muted-foreground">MFA, sessioni e storico degli accessi</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => navigate(authenticatedHome(role))}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Torna al portale
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-6">
        <AccountSecurityPanel />
      </main>
    </div>
  );
}
