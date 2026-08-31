import React from 'react';
import { Navigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';

/**
 * Folded into Users.
 *
 * This screen used to own logins, app roles and the role matrix, while "Team
 * Members" owned the same people's names and phone numbers — two menus, two
 * mental models, one human being. Users now holds both, and the role matrix
 * lives on its "Roles & permissions" tab.
 *
 * Kept as a redirect rather than deleted: this page is linked from Settings and
 * Routing, and admins have bookmarked it.
 */
export default function UserAccess() {
  return <Navigate to={createPageUrl('Users')} replace />;
}
