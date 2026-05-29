import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  LayoutDashboard, FolderOpen, Users, Building2,
  FileText, LogOut, Menu, X, ChevronRight, UserCog
} from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

const NAV_AGENTE = [
  { to: '/admin/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/admin/pratiche',  icon: FolderOpen,       label: 'Pratiche' },
  { to: '/admin/clienti',   icon: Users,             label: 'Clienti' },
  { to: '/admin/banche',    icon: Building2,         label: 'Banche' },
  { to: '/admin/documenti', icon: FileText,          label: 'Documenti Standard' },
  { to: '/admin/utenti',    icon: UserCog,           label: 'Utenti' },
];

const NAV_SEGRETERIA = [
  { to: '/admin/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/admin/pratiche',  icon: FolderOpen,       label: 'Pratiche' },
  { to: '/admin/clienti',   icon: Users,             label: 'Clienti' },
];

const NAV_BANCA = [
  { to: '/admin/pratiche',  icon: FolderOpen,  label: 'Pratiche' },
  { to: '/admin/banche',    icon: Building2,   label: 'Banche' },
];

const ROLE_LABEL: Record<string, string> = {
  agente: 'Agente',
  banca:  'Referente Banca',
  supervisore_segreteria: 'Supervisore Segreteria',
};
const ROLE_COLOR: Record<string, string> = {
  agente: 'bg-blue-100 text-blue-800',
  banca:  'bg-purple-100 text-purple-800',
  supervisore_segreteria: 'bg-teal-100 text-teal-800',
};

export default function AdminLayout() {
  const { user, role, signOut } = useAuth();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const navItems = role === 'banca' ? NAV_BANCA : role === 'supervisore_segreteria' ? NAV_SEGRETERIA : NAV_AGENTE;

  const handleSignOut = async () => {
    await signOut();
    toast.success('Disconnesso con successo');
    navigate('/login');
  };

  return (
    <div className="min-h-screen flex bg-background">
      {sidebarOpen && (
        <div className="fixed inset-0 z-20 bg-black/40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      <aside className={cn(
        'fixed inset-y-0 left-0 z-30 w-64 flex flex-col bg-card border-r border-border transition-transform duration-300',
        'lg:static lg:translate-x-0',
        sidebarOpen ? 'translate-x-0' : '-translate-x-full'
      )}>
        {/* Logo */}
        <div className="flex items-center gap-3 px-6 py-5 border-b border-border">
          <div className="w-9 h-9 rounded-lg bg-primary flex items-center justify-center">
            <FileText className="w-5 h-5 text-primary-foreground" />
          </div>
          <div>
            <p className="font-bold text-sm text-foreground leading-none">DocFlow</p>
            <p className="text-xs text-muted-foreground mt-0.5">Gestione Pratiche</p>
          </div>
          <button className="ml-auto lg:hidden" onClick={() => setSidebarOpen(false)}>
            <X className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) => cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors group',
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              )}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span className="flex-1">{label}</span>
              <ChevronRight className="w-3 h-3 opacity-0 group-hover:opacity-60 transition-opacity" />
            </NavLink>
          ))}
        </nav>

        {/* User + Role + Logout */}
        <div className="px-3 py-4 border-t border-border">
          <div className="px-3 py-2 mb-2">
            <p className="text-xs text-muted-foreground">Connesso come</p>
            <p className="text-sm font-medium text-foreground truncate">{user?.email}</p>
            {role && (
              <Badge className={`mt-1.5 text-xs ${ROLE_COLOR[role] ?? 'bg-muted text-muted-foreground'}`}>
                {ROLE_LABEL[role] ?? role}
              </Badge>
            )}
          </div>
          <Button
            variant="ghost" size="sm"
            className="w-full justify-start gap-3 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
            onClick={handleSignOut}
          >
            <LogOut className="w-4 h-4" />
            Disconnetti
          </Button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="lg:hidden flex items-center gap-3 px-4 py-3 border-b border-border bg-card sticky top-0 z-10">
          <button onClick={() => setSidebarOpen(true)}>
            <Menu className="w-5 h-5 text-muted-foreground" />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded bg-primary flex items-center justify-center">
              <FileText className="w-3.5 h-3.5 text-primary-foreground" />
            </div>
            <span className="font-bold text-sm">DocFlow</span>
          </div>
        </header>
        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
