import React from 'react';
import { Navigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';

/**
 * Folded into UserDetail, carrying the id across.
 *
 * Team member cards elsewhere in the app still link here, and the id in the
 * query string is the same roster id UserDetail expects — so an old link lands
 * on the same person, now with their access rights on the page too.
 */
export default function TeamMemberDetail() {
  const id = new URLSearchParams(window.location.search).get('id');
  return <Navigate to={createPageUrl('UserDetail') + (id ? `?id=${encodeURIComponent(id)}` : '')} replace />;
}
