import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense, useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";

const PublicHomePage = lazy(() => import("@/pages/public/PublicHomePage"));
const PublicPrivacyPage = lazy(() => import("@/pages/public/PublicPrivacyPage"));
const PublicTermsPage = lazy(() => import("@/pages/public/PublicTermsPage"));
const SegnalazionePublicaPage = lazy(() => import("@/pages/public/SegnalazionePublicaPage"));
const ClientAccessPage = lazy(() => import("@/pages/client/ClientAccessPage"));
const ClientPortalPage = lazy(() => import("@/pages/client/ClientPortalPage"));
const LoginPage = lazy(() => import("@/pages/LoginPage"));
const MfaChallengePage = lazy(() => import("@/pages/MfaChallengePage"));
const AccountSecurityPage = lazy(() => import("@/pages/AccountSecurityPage"));
const SetPasswordPage = lazy(() => import("@/pages/SetPasswordPage"));
const RegistrazioneSegnalPage = lazy(() => import("@/pages/RegistrazioneSegnalPage"));
const RegistrazioneConsulentePage = lazy(() => import("@/pages/RegistrazioneConsulentePage"));
const ConsensoCrePage = lazy(() => import("@/pages/ConsensoCrePage"));
const ConsulenteDashboard = lazy(() => import("@/pages/consulente/ConsulenteDashboard"));
const NuovoReportWizard = lazy(() => import("@/pages/consulente/NuovoReportWizard"));
const ProfiloConsulentePage = lazy(() => import("@/pages/consulente/ProfiloConsulentePage"));
const BancaPortalPage = lazy(() => import("@/pages/banca/BancaPortalPage"));
const AdminLayout = lazy(() => import("@/components/AdminLayout"));
const DashboardPage = lazy(() => import("@/pages/admin/DashboardPage"));
const PratichePage = lazy(() => import("@/pages/admin/PratichePage"));
const PraticaDetailPage = lazy(() => import("@/pages/admin/PraticaDetailPage"));
const ClientiPage = lazy(() => import("@/pages/admin/ClientiPage"));
const BanchePage = lazy(() => import("@/pages/admin/BanchePage"));
const DocumentiTemplatePage = lazy(() => import("@/pages/admin/DocumentiTemplatePage"));
const UtentiPage = lazy(() => import("@/pages/admin/UtentiPage"));
const ProfiloPage = lazy(() => import("@/pages/admin/ProfiloPage"));
const MieiAgentiPage = lazy(() => import("@/pages/admin/MieiAgentiPage"));
const MieiSegnalPage = lazy(() => import("@/pages/admin/MieiSegnalPage"));
const StatistichePage = lazy(() => import("@/pages/admin/StatistichePage"));
const ImpostazioniPage = lazy(() => import("@/pages/admin/ImpostazioniPage"));
const SegnalatoreDashboardPage = lazy(() => import("@/pages/admin/SegnalatoreDashboardPage"));
const NuovaSegnalazionePage = lazy(() => import("@/pages/admin/NuovaSegnalazionePage"));
const RubricaPage = lazy(() => import("@/pages/admin/RubricaPage"));
const TemplateDocumentiPage = lazy(() => import("@/pages/admin/TemplateDocumentiPage"));
const KanbanBanchePage = lazy(() => import("@/pages/admin/KanbanBanchePage"));
const CalendarioPage = lazy(() => import("@/pages/admin/CalendarioPage"));
const TasksPage = lazy(() => import("@/pages/admin/TasksPage"));
const ChecklistTemplatePage = lazy(() => import("@/pages/admin/ChecklistTemplatePage"));
const ReportPage = lazy(() => import("@/pages/admin/ReportPage"));
const SegnalazioniRicevutePage = lazy(() => import("@/pages/admin/SegnalazioniRicevutePage"));
const IntegritaDocumentiPage = lazy(() => import("@/pages/admin/IntegritaDocumentiPage"));

const queryClient = new QueryClient();

function useNoIndex() {
  useEffect(() => {
    let robots = document.head.querySelector<HTMLMetaElement>('meta[name="robots"]');
    if (!robots) {
      robots = document.createElement('meta');
      robots.name = 'robots';
      document.head.appendChild(robots);
    }
    robots.content = 'noindex,nofollow';
  }, []);
}

function NoIndexRoute({ children }: { children: React.ReactNode }) {
  useNoIndex();
  return <>{children}</>;
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, mfaLoading, mfaRequired } = useAuth();
  useNoIndex();

  if (loading || mfaLoading) return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-muted-foreground">Caricamento...</p>
      </div>
    </div>
  );
  if (!user) return <Navigate to="/login" replace />;
  if (mfaRequired) return <Navigate to="/mfa" replace />;
  return <>{children}</>;
}

function RouteFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background" role="status" aria-live="polite">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-muted-foreground">Caricamento...</p>
      </div>
    </div>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster richColors position="top-right" />
      <BrowserRouter>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            {/* Sito e portali pubblici */}
            <Route path="/" element={<PublicHomePage />} />
            <Route path="/richiedi-valutazione" element={<SegnalazionePublicaPage />} />
            <Route path="/segnala" element={<Navigate to="/richiedi-valutazione" replace />} />
            <Route path="/privacy" element={<PublicPrivacyPage />} />
            <Route path="/termini" element={<PublicTermsPage />} />
            <Route path="/accesso" element={<NoIndexRoute><ClientAccessPage /></NoIndexRoute>} />
            <Route path="/portale/:practiceId" element={<NoIndexRoute><ClientPortalPage /></NoIndexRoute>} />

            {/* Auth */}
            <Route path="/login" element={<NoIndexRoute><LoginPage /></NoIndexRoute>} />
            <Route path="/mfa" element={<NoIndexRoute><MfaChallengePage /></NoIndexRoute>} />
            <Route path="/sicurezza-account" element={<ProtectedRoute><AccountSecurityPage /></ProtectedRoute>} />
            <Route path="/set-password" element={<NoIndexRoute><SetPasswordPage /></NoIndexRoute>} />
            <Route path="/reset-password" element={<NoIndexRoute><SetPasswordPage /></NoIndexRoute>} />
            <Route path="/invito-segnalatore" element={<NoIndexRoute><RegistrazioneSegnalPage /></NoIndexRoute>} />
            <Route path="/registrazione-consulente" element={<NoIndexRoute><RegistrazioneConsulentePage /></NoIndexRoute>} />
            <Route path="/consenso-cr/:token" element={<NoIndexRoute><ConsensoCrePage /></NoIndexRoute>} />

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
              <Route path="miei-agenti" element={<MieiAgentiPage />} />
              <Route path="miei-segnalatori" element={<MieiSegnalPage />} />
              <Route path="segnalatore-dashboard" element={<SegnalatoreDashboardPage />} />
              <Route path="nuova-segnalazione" element={<NuovaSegnalazionePage />} />
              <Route path="rubrica-lead" element={<RubricaPage />} />
              <Route path="template-documenti" element={<TemplateDocumentiPage />} />
              <Route path="kanban-banche" element={<KanbanBanchePage />} />
              <Route path="calendario" element={<CalendarioPage />} />
              <Route path="tasks" element={<TasksPage />} />
              <Route path="checklist-template" element={<ChecklistTemplatePage />} />
              <Route path="report" element={<ReportPage />} />
              <Route path="segnalazioni-ricevute" element={<SegnalazioniRicevutePage />} />
              <Route path="integrita-documenti" element={<IntegritaDocumentiPage />} />
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
