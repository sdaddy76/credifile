import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  message?: string;
}

/**
 * Fallback applicativo per evitare pagine bianche quando una route o un
 * componente fallisce durante il rendering. Gli errori tecnici restano in
 * console per il debug, mentre l'utente riceve un'azione di recupero chiara.
 */
export default class AppErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: unknown): State {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : undefined,
    };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('Errore non gestito nell’interfaccia Credifile:', error, info);
  }

  handleRetry = () => {
    this.setState({ hasError: false, message: undefined });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="min-h-screen bg-background px-4 py-16">
        <div className="mx-auto flex max-w-lg flex-col items-center rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
          <AlertTriangle className="h-10 w-10 text-amber-500" aria-hidden="true" />
          <h1 className="mt-4 text-xl font-semibold text-foreground">Si è verificato un problema</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            La pagina non è stata caricata correttamente. Riprova; i dati già salvati non vengono modificati.
          </p>
          {this.state.message && (
            <p className="mt-3 max-w-full truncate text-xs text-muted-foreground" title={this.state.message}>
              Dettaglio: {this.state.message}
            </p>
          )}
          <Button type="button" onClick={this.handleRetry} className="mt-6 gap-2">
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Riprova
          </Button>
        </div>
      </div>
    );
  }
}
