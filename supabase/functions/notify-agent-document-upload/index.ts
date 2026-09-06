import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

const escapeHtml = (value: unknown) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');

const response = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: CORS });

const sha256 = async (value: string) => {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  try {
    const {
      practice_id,
      practice_document_id,
      uploaded_file_id,
      access_code,
      client_email,
    } = await req.json();

    if (!practice_id || !access_code || !client_email) {
      return response({ success: false, error: 'Parametri di accesso mancanti' });
    }
    if ((practice_document_id && !uploaded_file_id) || (!practice_document_id && uploaded_file_id)) {
      return response({ success: false, error: 'Riferimenti del file incompleti' });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } }
    );
    const resendKey = Deno.env.get('RESEND_API_KEY') ?? '';
    const fromEmail = Deno.env.get('FROM_EMAIL') ?? 'Credifile <docflow@stedasrls.it>';
    const appUrl = (Deno.env.get('APP_URL') ?? 'https://credifile-eosin.vercel.app').replace(/\/+$/, '');

    if (!resendKey) {
      return response({ success: false, error: 'Servizio email non configurato' });
    }

    const normalizedEmail = String(client_email).trim().toLowerCase();
    const normalizedCode = String(access_code).trim();
    const { data: accessRecord, error: accessError } = await supabase
      .from('practice_access_codes')
      .select('id, scadenza, privacy_consent_accepted_at')
      .eq('practice_id', practice_id)
      .eq('codice', normalizedCode)
      .eq('email_cliente', normalizedEmail)
      .maybeSingle();

    if (accessError || !accessRecord) {
      return response({ success: false, error: 'Accesso cliente non valido' });
    }
    if (
      accessRecord.scadenza
      && new Date(accessRecord.scadenza).getTime() < Date.now()
    ) {
      return response({ success: false, error: 'Codice di accesso scaduto' });
    }
    if (!accessRecord.privacy_consent_accepted_at) {
      return response({ success: false, error: 'Consenso privacy non registrato' });
    }

    const { data: practice, error: practiceError } = await supabase
      .from('practices')
      .select('id, numero_pratica, assigned_to, clients(ragione_sociale)')
      .eq('id', practice_id)
      .maybeSingle();

    if (practiceError || !practice) {
      return response({ success: false, error: 'Pratica non trovata' });
    }
    if (!practice.assigned_to) {
      return response({ success: false, error: 'La pratica non ha un agente assegnato' });
    }

    const { data: agent, error: agentError } = await supabase
      .from('admin_profiles')
      .select('email, nome')
      .eq('id', practice.assigned_to)
      .maybeSingle();

    const agentEmail = agent?.email?.trim().toLowerCase();
    if (agentError || !agentEmail) {
      return response({ success: false, error: 'L’agente assegnato non ha un’email valida' });
    }

    const { data: documents, error: documentsError } = await supabase
      .from('practice_documents')
      .select('id, nome, status, tipo, uploaded_at')
      .eq('practice_id', practice_id)
      .in('tipo', ['standard', 'integrazione'])
      .order('created_at');

    if (documentsError) throw documentsError;
    const requestedDocuments = documents ?? [];
    const missingDocuments = requestedDocuments.filter(
      document => document.status === 'richiesto' || document.status === 'rifiutato'
    );
    const companyRelation = practice.clients as { ragione_sociale?: string } | { ragione_sociale?: string }[] | null;
    const companyName = Array.isArray(companyRelation)
      ? companyRelation[0]?.ragione_sociale
      : companyRelation?.ragione_sociale;
    const safeCompanyName = escapeHtml(companyName || 'Cliente');
    const safePracticeNumber = escapeHtml(practice.numero_pratica);
    const safeAgentName = escapeHtml(agent.nome || agentEmail);
    const practiceLink = `${appUrl}/admin/pratiche/${practice_id}`;
    const errors: string[] = [];
    const sent: string[] = [];

    const sendNotification = async ({
      type,
      key,
      subject,
      html,
      text,
      documentId = null,
      uploadId = null,
      activityAction,
      activityMetadata,
    }: {
      type: 'file_uploaded' | 'all_documents_completed';
      key: string;
      subject: string;
      html: string;
      text: string;
      documentId?: string | null;
      uploadId?: string | null;
      activityAction: string;
      activityMetadata: Record<string, unknown>;
    }) => {
      const { data: claimId, error: claimError } = await supabase.rpc(
        'claim_agent_document_upload_notification',
        {
          p_practice_id: practice_id,
          p_practice_document_id: documentId,
          p_uploaded_file_id: uploadId,
          p_notification_type: type,
          p_notification_key: key,
          p_recipient_email: agentEmail,
        }
      );

      if (claimError) throw claimError;
      if (!claimId) return;

      try {
        const emailResponse = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${resendKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: fromEmail,
            to: [agentEmail],
            subject,
            html,
            text,
          }),
        });
        const emailBody = await emailResponse.json();
        if (!emailResponse.ok) {
          throw new Error(emailBody?.message ?? 'Errore invio email');
        }

        await supabase
          .from('agent_document_upload_notifications')
          .update({
            status: 'sent',
            resend_id: emailBody.id ?? null,
            sent_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', claimId);

        await Promise.all([
          supabase.from('practice_activity_log').insert({
            practice_id,
            action: activityAction,
            actor_nome: companyName || normalizedEmail,
            actor_ruolo: 'cliente',
            metadata: {
              ...activityMetadata,
              destinatario: agentEmail,
              resend_id: emailBody.id ?? null,
            },
          }),
          supabase.from('email_send_log').insert({
            practice_id,
            destinatari: [agentEmail],
            oggetto: subject,
            stato: 'inviata',
            sent_by_nome: 'Portale Cliente',
            resend_id: emailBody.id ?? null,
          }),
        ]);
        sent.push(type);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await supabase
          .from('agent_document_upload_notifications')
          .update({
            status: 'failed',
            error: message,
            updated_at: new Date().toISOString(),
          })
          .eq('id', claimId);
        errors.push(`${type}: ${message}`);
      }
    };

    if (practice_document_id && uploaded_file_id) {
      const document = requestedDocuments.find(item => item.id === practice_document_id);
      if (!document || !['caricato', 'approvato'].includes(document.status)) {
        return response({ success: false, error: 'Documento richiesto non valido o non caricato' });
      }

      const { data: uploadedFile, error: uploadedFileError } = await supabase
        .from('uploaded_files')
        .select('id, nome_file, uploaded_by')
        .eq('id', uploaded_file_id)
        .eq('practice_id', practice_id)
        .eq('practice_document_id', practice_document_id)
        .maybeSingle();

      if (uploadedFileError || !uploadedFile || uploadedFile.uploaded_by !== 'cliente') {
        return response({ success: false, error: 'File caricato non valido' });
      }

      const safeDocumentName = escapeHtml(document.nome);
      const safeFileName = escapeHtml(uploadedFile.nome_file);
      const remainingText = missingDocuments.length === 0
        ? 'Tutti i documenti richiesti risultano ora completati.'
        : `Restano ${missingDocuments.length} documenti da completare.`;

      await sendNotification({
        type: 'file_uploaded',
        key: uploaded_file_id,
        documentId: practice_document_id,
        uploadId: uploaded_file_id,
        subject: `Nuovo documento caricato — ${companyName || practice.numero_pratica}`,
        html: `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;color:#1f2937;max-width:620px;margin:auto;padding:24px;">
          <div style="background:#1e40af;color:white;padding:18px 22px;border-radius:8px 8px 0 0;">
            <h1 style="font-size:20px;margin:0;">Nuovo documento caricato</h1>
          </div>
          <div style="border:1px solid #dbeafe;border-top:0;padding:22px;border-radius:0 0 8px 8px;">
            <p>Buongiorno <strong>${safeAgentName}</strong>,</p>
            <p>il cliente <strong>${safeCompanyName}</strong> ha caricato un documento richiesto.</p>
            <p><strong>Pratica:</strong> ${safePracticeNumber}<br>
               <strong>Documento:</strong> ${safeDocumentName}<br>
               <strong>File:</strong> ${safeFileName}</p>
            <p>${escapeHtml(remainingText)}</p>
            <p style="margin-top:24px;"><a href="${escapeHtml(practiceLink)}" style="background:#1e40af;color:white;padding:11px 20px;border-radius:6px;text-decoration:none;font-weight:700;">Apri la pratica</a></p>
          </div>
        </body></html>`,
        text: `Nuovo documento caricato\n\nCliente: ${companyName || 'Cliente'}\nPratica: ${practice.numero_pratica}\nDocumento: ${document.nome}\nFile: ${uploadedFile.nome_file}\n\n${remainingText}\n\nApri la pratica: ${practiceLink}`,
        activityAction: 'documento_cliente_caricato_notifica_agente',
        activityMetadata: {
          practice_document_id,
          uploaded_file_id,
          documento: document.nome,
          file: uploadedFile.nome_file,
          documenti_mancanti: missingDocuments.length,
        },
      });
    }

    if (requestedDocuments.length > 0 && missingDocuments.length === 0) {
      const completionSource = requestedDocuments
        .map(document => `${document.id}:${document.uploaded_at ?? ''}`)
        .sort()
        .join('|');
      const completionKey = await sha256(completionSource);
      const documentListHtml = requestedDocuments
        .map(document => `<li style="margin:5px 0;">${escapeHtml(document.nome)}</li>`)
        .join('');
      const documentListText = requestedDocuments.map(document => `- ${document.nome}`).join('\n');

      await sendNotification({
        type: 'all_documents_completed',
        key: completionKey,
        subject: `Documentazione completata — ${companyName || practice.numero_pratica}`,
        html: `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;color:#1f2937;max-width:620px;margin:auto;padding:24px;">
          <div style="background:#15803d;color:white;padding:18px 22px;border-radius:8px 8px 0 0;">
            <h1 style="font-size:20px;margin:0;">Documentazione completata</h1>
          </div>
          <div style="border:1px solid #bbf7d0;border-top:0;padding:22px;border-radius:0 0 8px 8px;">
            <p>Buongiorno <strong>${safeAgentName}</strong>,</p>
            <p>il cliente <strong>${safeCompanyName}</strong> ha completato tutti i documenti richiesti per la pratica <strong>${safePracticeNumber}</strong>.</p>
            <p><strong>Documenti completati:</strong></p>
            <ul>${documentListHtml}</ul>
            <p style="margin-top:24px;"><a href="${escapeHtml(practiceLink)}" style="background:#15803d;color:white;padding:11px 20px;border-radius:6px;text-decoration:none;font-weight:700;">Controlla la pratica</a></p>
          </div>
        </body></html>`,
        text: `Documentazione completata\n\nCliente: ${companyName || 'Cliente'}\nPratica: ${practice.numero_pratica}\n\nDocumenti completati:\n${documentListText}\n\nControlla la pratica: ${practiceLink}`,
        activityAction: 'documentazione_cliente_completata_notifica_agente',
        activityMetadata: {
          documenti: requestedDocuments.map(document => document.nome),
          completion_key: completionKey,
        },
      });
    }

    return response({
      success: errors.length === 0,
      sent,
      skipped: sent.length === 0 && errors.length === 0,
      errors,
      remaining_documents: missingDocuments.length,
    });
  } catch (error) {
    return response({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
