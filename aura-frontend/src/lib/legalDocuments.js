// Constantes y helpers puros del gate de aceptación de documentos legales
// (legal-documents-acceptance, 2026-08-25). Generaliza el diseño inicial de
// privacy-policy-acceptance a N documentos (hoy: Política de Privacidad +
// Términos y Condiciones) sin duplicar lógica por documento. Sin dependencias
// de React/Supabase -- testeado con node:test, igual que supportLogic.js.

export const LEGAL_CHANNEL_WEB = 'web';
export const LEGAL_CHANNEL_TELEGRAM = 'telegram';

// Bump manual cuando cambie el texto legal de un documento (privacy_policy.txt
// / terms_and_conditions.txt): actualizar la versión acá Y la fila
// correspondiente de `legal_documents` (mismo slug) en la misma migración/PR.
export const LEGAL_DOCUMENTS = {
  PRIVACY_POLICY: {
    slug: 'privacy_policy',
    version: '2026-08-25',
    label: 'Política de Privacidad',
    path: '/privacy-policy',
  },
  TERMS_CONDITIONS: {
    slug: 'terms_conditions',
    version: '2026-08-25',
    label: 'Términos y Condiciones',
    path: '/terms-and-conditions',
  },
};

/**
 * Determina si una fila de `legal_acceptances` (o su ausencia) cuenta como
 * aceptación vigente de UN documento: tiene que existir Y ser exactamente la
 * versión actual -- si ese documento cambió después de la última aceptación,
 * vuelve a pedirse.
 *
 * @param {{version: string}|null|undefined} acceptanceRow
 * @param {string} currentVersion
 */
export function hasAcceptedCurrentVersion(acceptanceRow, currentVersion) {
  return !!acceptanceRow && acceptanceRow.version === currentVersion;
}
