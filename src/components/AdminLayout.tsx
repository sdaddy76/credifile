import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useAutoBackup } from '@/hooks/useAutoBackup';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  LayoutDashboard, FolderOpen, Users, Building2,
  FileText, LogOut, Menu, X, UserCog, ShieldAlert,
  UserCircle, UsersRound, BarChart3, Settings
} from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

const NAV_SUPER = [
  { to: '/admin/dashboard',    icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/admin/pratiche',     icon: FolderOpen,      label: 'Pratiche' },
  { to: '/admin/clienti',      icon: Users,           label: 'Clienti' },
  { to: '/admin/banche',       icon: Building2,       label: 'Banche' },
  { to: '/admin/documenti',    icon: FileText,        label: 'Documenti Standard' },
  { to: '/admin/statistiche',  icon: BarChart3,       label: 'Statistiche' },
  { to: '/admin/utenti',       icon: UserCog,         label: 'Utenti' },
  { to: '/admin/miei-agenti',  icon: UsersRound,      label: 'Miei Agenti' },
  { to: '/admin/impostazioni', icon: Settings,        label: 'Impostazioni' },
  { to: '/admin/profilo',      icon: UserCircle,      label: 'Profilo' },
];

const NAV_SEGRETERIA = [
  { to: '/admin/dashboard',    icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/admin/pratiche',     icon: FolderOpen,      label: 'Pratiche' },
  { to: '/admin/clienti',      icon: Users,           label: 'Clienti' },
  { to: '/admin/banche',       icon: Building2,       label: 'Banche' },
  { to: '/admin/statistiche',  icon: BarChart3,       label: 'Statistiche' },
  { to: '/admin/miei-agenti',  icon: UsersRound,      label: 'Miei Agenti' },
  { to: '/admin/impostazioni', icon: Settings,        label: 'Impostazioni' },
  { to: '/admin/profilo',      icon: UserCircle,      label: 'Profilo' },
];


const NAV_AGENTE = [
  { to: '/admin/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/admin/pratiche',  icon: FolderOpen,      label: 'Pratiche' },
  { to: '/admin/clienti',   icon: Users,           label: 'Clienti' },
  { to: '/admin/profilo',   icon: UserCircle,      label: 'Profilo' },
];

const ROLE_LABEL: Record<string, string> = {
  super_admin:            'Super Admin',
  agente:                 'Agente',
  supervisore_segreteria: 'Segreteria',
};
const ROLE_COLOR: Record<string, string> = {
  super_admin:            'bg-red-100 text-red-800',
  agente:                 'bg-blue-100 text-blue-800',
  supervisore_segreteria: 'bg-teal-100 text-teal-800',
};

export default function AdminLayout() {
  const { user, role, profileNome, signOut, loading: authLoading, isSegreteria } = useAuth();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Backup automatico al login per la segreteria
  useAutoBackup(user?.id, isSegreteria, !authLoading);

  const navItems =
    role === 'super_admin'            ? NAV_SUPER :
    role === 'supervisore_segreteria' ? NAV_SEGRETERIA :
                                        NAV_AGENTE;

  const handleSignOut = async () => {
    await signOut();
    // Hard reload: azzera tutto lo stato React ed evita la race condition
    // in cui LoginPage vede ancora user!=null e re-redirige al dashboard
    window.location.replace('/#/login');
  };

  const displayName = profileNome || user?.email || '';
  const roleLabel   = ROLE_LABEL[role ?? ''] ?? role ?? '';
  const roleColor   = ROLE_COLOR[role ?? ''] ?? 'bg-gray-100 text-gray-800';

  return (
    <div className="min-h-screen bg-background flex">
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/40 z-20 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      <aside className={cn(
        'fixed top-0 left-0 h-full w-64 bg-card border-r border-border z-30 flex flex-col transition-transform duration-200',
        sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
      )}>
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <ShieldAlert className="w-4 h-4 text-primary-foreground" />
            </div>
            <span className="font-bold text-foreground text-sm">DocFlow</span>
          </div>
          <button className="lg:hidden text-muted-foreground hover:text-foreground" onClick={() => setSidebarOpen(false)}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 py-4 px-3 space-y-0.5 overflow-y-auto">
          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to} to={to}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) => cn(
                'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                isActive ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              )}
            >
              <Icon className="w-4 h-4 shrink-0" />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="px-4 py-3 border-t border-border space-y-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <span className="text-xs font-bold text-primary">{displayName.charAt(0).toUpperCase()}</span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-foreground truncate">{displayName}</p>
              <Badge className={`text-[10px] px-1.5 py-0 ${roleColor}`}>{roleLabel}</Badge>
            </div>
          </div>
          <Button variant="ghost" size="sm"
            className="w-full justify-start gap-2 text-muted-foreground hover:text-destructive h-8"
            onClick={handleSignOut}
          >
            <LogOut className="w-3.5 h-3.5" /> Esci
          </Button>
        </div>
      </aside>

      <div className="flex-1 lg:ml-64 flex flex-col min-h-screen">
        <header className="lg:hidden flex items-center gap-3 px-4 py-3 border-b border-border bg-card sticky top-0 z-10">
          <button className="text-muted-foreground hover:text-foreground" onClick={() => setSidebarOpen(true)}>
            <Menu className="w-5 h-5" />
          </button>
          <span className="font-semibold text-foreground text-sm">DocFlow Finanziario</span>
        </header>
        <main className="flex-1 p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
