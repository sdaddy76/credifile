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
import SegnalatoreDashboardPage from "@/pages/admin/SegnalatoreDashboardPage";
import NuovaSegnalazionePage from "@/pages/admin/NuovaSegnalazionePage";
import RubricaPage from "@/pages/admin/RubricaPage";
import TemplateDocumentiPage from "@/pages/admin/TemplateDocumentiPage";
import KanbanBanchePage from "@/pages/admin/KanbanBanchePage";
import CalendarioPage from "@/pages/admin/CalendarioPage";
import TasksPage from "@/pages/admin/TasksPage";
import ChecklistTemplatePage from "@/pages/admin/ChecklistTemplatePage";
import ReportPage from "@/pages/admin/ReportPage";
import ClientAccessPage from "@/pages/client/ClientAccessPage";
import ClientPortalPage from "@/pages/client/ClientPortalPage";
import SetPasswordPage from "@/pages/SetPasswordPage";
import RegistrazioneSegnalPage from "@/pages/RegistrazioneSegnalPage";
import RegistrazioneConsulentePage from "@/pages/RegistrazioneConsulentePage";
import ConsensoCrePage from "@/pages/ConsensoCrePage";
import ConsulenteDashboard from "@/pages/consulente/ConsulenteDashboard";
import NuovoReportWizard from "@/pages/consulente/NuovoReportWizard";
import ProfiloConsulentePage from "@/pages/consulente/ProfiloConsulentePage";
import BancaPortalPage from "@/pages/banca/BancaPortalPage";

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
          <Route path="/invito-segnalatore" element={<RegistrazioneSegnalPage />} />
          <Route path="/registrazione-consulente" element={<RegistrazioneConsulentePage />} />
          <Route path="/consenso-cr/:token" element={<ConsensoCrePage />} />

          {/* Portale Consulente — protetto */}
          <Route path="/consulente" element={<ProtectedRoute><ConsulenteDashboard /></ProtectedRoute>} />
          <Route path="/consulente/profilo" element={<ProtectedRoute><ProfiloConsulentePage /></ProtectedRoute>} />
          <Route path="/consulente/cliente/:clientId/nuovo-report" element={<ProtectedRoute><NuovoReportWizard /></ProtectedRoute>} />

          {/* Portale Banche — protetto */}
          <Route path="/banca" element={<ProtectedRoute><BancaPortalPage /></ProtectedRoute>} />

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
            <Route path="miei-agenti"              element={<MieiAgentiPage />} />
            <Route path="miei-segnalatori"          element={<MieiSegnalPage />} />
            <Route path="segnalatore-dashboard"     element={<SegnalatoreDashboardPage />} />
            <Route path="nuova-segnalazione"         element={<NuovaSegnalazionePage />} />
            <Route path="rubrica-lead"               element={<RubricaPage />} />
            <Route path="template-documenti"         element={<TemplateDocumentiPage />} />
            <Route path="kanban-banche"              element={<KanbanBanchePage />} />
            <Route path="calendario"                 element={<CalendarioPage />} />
            <Route path="tasks"                      element={<TasksPage />} />
            <Route path="checklist-template"         element={<ChecklistTemplatePage />} />
            <Route path="report"                      element={<ReportPage />} />
          </Route>

          <Route path="/" element={<Navigate to="/admin/dashboard" replace />} />
          <Route path="*" element={<Navigate to="/admin/dashboard" replace />} />
        </Routes>
      </HashRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
