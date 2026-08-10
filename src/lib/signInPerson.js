import { base44 } from '@/api/dataClient';
import { toast } from 'sonner';

// "Sign in Person" — route through the SAME e-sign engine as the emailed signing link
// (which works), instead of the legacy /DesignModView / /ManualSalesContractView /
// /PreInstallChecklistView pages whose submit* handlers are unported and throw. Mints a
// signature_request token for the document and opens the public signing page on this device.
export async function signInPerson(documentType, documentId) {
  const t = toast.loading('Starting signing session…');
  try {
    const { data, error } = await base44.functions.invoke('esign', {
      action: 'create', document_type: documentType, document_id: documentId,
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    if (!data?.token) throw new Error('Could not start the signing session.');
    toast.dismiss(t);
    window.location.href = `/SignDocument?token=${data.token}`;
  } catch (e) {
    toast.dismiss(t);
    toast.error(e?.message || 'Could not start in-person signing. Make sure e-sign is enabled for this document type.');
  }
}
