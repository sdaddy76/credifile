import { jsPDF } from 'jspdf';

export interface ClientSummaryReportData {
  ragione_sociale: string;
  numero_pratica: string;
  stato_pratica: string;
  banca?: string | null;
  documenti_caricati: number;
  documenti_totali: number;
  integrazioni_aperte: number;
  domande_aperte: number;
  privacy_accettata: boolean;
  generato_il?: Date;
}

export function generateClientSummaryPdf(data: ClientSummaryReportData): Blob {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const teal: [number, number, number] = [15, 118, 110];
  const dark: [number, number, number] = [30, 41, 59];
  const gray: [number, number, number] = [100, 116, 139];
  const light: [number, number, number] = [241, 245, 249];
  const green: [number, number, number] = [22, 101, 52];
  const amber: [number, number, number] = [146, 64, 14];
  const date = (data.generato_il ?? new Date()).toLocaleDateString('it-IT');
  const progress = data.documenti_totali > 0
    ? Math.round((data.documenti_caricati / data.documenti_totali) * 100)
    : 0;

  doc.setFillColor(...teal);
  doc.rect(0, 0, pageWidth, 38, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('RIEPILOGO DELLA PRATICA', 16, 16);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`${data.ragione_sociale} · ${data.numero_pratica}`, 16, 25);
  doc.text(`Generato il ${date}`, 16, 32);

  let y = 52;
  doc.setTextColor(...dark);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('Stato della richiesta', 16, y);
  y += 8;

  doc.setFillColor(...light);
  doc.roundedRect(16, y, pageWidth - 32, 24, 2, 2, 'F');
  doc.setTextColor(...teal);
  doc.setFontSize(13);
  doc.text(data.stato_pratica, 22, y + 10);
  doc.setTextColor(...gray);
  doc.setFontSize(9);
  doc.text(data.banca ? `Istituto di riferimento: ${data.banca}` : 'Istituto di riferimento: in definizione', 22, y + 17);
  y += 36;

  doc.setTextColor(...dark);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('Documenti', 16, y);
  y += 8;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`${data.documenti_caricati} di ${data.documenti_totali} documenti completati`, 16, y);
  y += 5;
  doc.setFillColor(226, 232, 240);
  doc.roundedRect(16, y, pageWidth - 32, 6, 2, 2, 'F');
  if (progress > 0) {
    doc.setFillColor(...teal);
    doc.roundedRect(16, y, (pageWidth - 32) * Math.min(1, progress / 100), 6, 2, 2, 'F');
  }
  doc.setTextColor(...gray);
  doc.setFontSize(8);
  doc.text(`${progress}% completato`, pageWidth - 16, y + 12, { align: 'right' });
  y += 28;

  doc.setTextColor(...dark);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('Prossime attività', 16, y);
  y += 9;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  const activities = [
    data.integrazioni_aperte > 0
      ? `Completare le ${data.integrazioni_aperte} richieste di integrazione aperte.`
      : 'Non risultano richieste di integrazione aperte.',
    data.domande_aperte > 0
      ? `Rispondere alle ${data.domande_aperte} domande ancora in attesa.`
      : 'Non risultano domande in attesa di risposta.',
    data.privacy_accettata
      ? 'Autorizzazione privacy registrata.'
      : 'Accettare l’autorizzazione privacy prima di caricare documenti.',
  ];
  for (const [index, activity] of activities.entries()) {
    const color = activity.includes('Non risultano') || activity.includes('registrata')
      ? green
      : amber;
    doc.setTextColor(...color);
    doc.text(`${index + 1}.`, 18, y);
    doc.setTextColor(...dark);
    const lines = doc.splitTextToSize(activity, pageWidth - 48) as string[];
    doc.text(lines, 26, y);
    y += Math.max(7, lines.length * 5 + 2);
  }

  y += 10;
  doc.setFillColor(...light);
  doc.roundedRect(16, y, pageWidth - 32, 30, 2, 2, 'F');
  doc.setTextColor(...gray);
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(8.5);
  const note = 'Questo riepilogo è informativo e mostra esclusivamente lo stato operativo della pratica. ' +
    'Per chiarimenti sulla richiesta o sui documenti, contatta il tuo agente o consulente.';
  doc.text(doc.splitTextToSize(note, pageWidth - 44) as string[], 22, y + 9);

  doc.setFillColor(...light);
  doc.rect(0, 285, pageWidth, 12, 'F');
  doc.setTextColor(...gray);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.text('Credifile · Riepilogo riservato al cliente', 16, 292);
  doc.text(`Pagina 1 di 1`, pageWidth - 16, 292, { align: 'right' });

  return doc.output('blob');
}
