import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import AdminLayout from "@/components/AdminLayout";
import LoginPage from "@/pages/LoginPage";
import DashboardPage from "@/pages/admin/DashboardPage";
import PratichePage from "@/pages/admin/PratichePage";
import PraticaDetailPage from "@/pages/admin/PraticaDetailPage";
import ClientiPage from "@/pages/admin/ClientiPage";
import BanchePage from "@/pages/admin/BanchePage";
import DocumentiTemplatePage from "@/pages/admin/DocumentiTemplatePage";
import UtentiPage from "@/pages/admin/UtentiPage";
import ProfiloPage from "@/pages/admin/ProfiloPage";
import MieiAgentiPage from "@/pages/admin/MieiAgentiPage";
import MieiSegnalPage from "@/pages/admin/MieiSegnalPage";
import StatistichePage from "@/pages/admin/StatistichePage";
import ImpostazioniPage from "@/pages/admin/ImpostazioniPage";
import ClientAccessPage from "@/pages/client/ClientAccessPage";
import ClientPortalPage from "@/pages/client/ClientPortalPage";
import SetPasswordPage from "@/pages/SetPasswordPage";

const queryClient = new QueryClient();

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-muted-foreground">Caricamento...</p>
      </div>
    </div>
  );
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster richColors position="top-right" />
      <HashRouter>
        <Routes>
          {/* Portale cliente — pubblico */}
          <Route path="/accesso" element={<ClientAccessPage />} />
          <Route path="/portale/:practiceId" element={<ClientPortalPage />} />

          {/* Auth */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/set-password" element={<SetPasswordPage />} />
          <Route path="/reset-password" element={<SetPasswordPage />} />

          {/* Admin protetto */}
          <Route path="/admin" element={<ProtectedRoute><AdminLayout /></ProtectedRoute>}>
            <Route index element={<Navigate to="dashboard" replace />} />
            <Route path="dashboard" element={<DashboardPage />} />
            <Route path="pratiche" element={<PratichePage />} />
            <Route path="pratiche/:id" element={<PraticaDetailPage />} />
            <Route path="clienti" element={<ClientiPage />} />
            <Route path="banche" element={<BanchePage />} />
            <Route path="documenti" element={<DocumentiTemplatePage />} />
            <Route path="utenti" element={<UtentiPage />} />
            <Route path="profilo" element={<ProfiloPage />} />
            <Route path="statistiche" element={<StatistichePage />} />
            <Route path="impostazioni" element={<ImpostazioniPage />} />
            <Route path="miei-agenti"       element={<MieiAgentiPage />} />
            <Route path="miei-segnalatori"  element={<MieiSegnalPage />} />
          </Route>

          <Route path="/" element={<Navigate to="/admin/dashboard" replace />} />
          <Route path="*" element={<Navigate to="/admin/dashboard" replace />} />
        </Routes>
      </HashRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
