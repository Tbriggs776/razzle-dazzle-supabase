import React from 'react';
import { Navigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';

/**
 * Folded into Users.
 *
 * "Team Members" could edit who someone was but never whether they could sign
 * in — the access controls lived on a different screen in a different menu.
 * That split is gone; Users lists the same people and its detail page carries
 * both the profile and the access rights.
 */
export default function TeamMembers() {
  return <Navigate to={createPageUrl('Users')} replace />;
}
