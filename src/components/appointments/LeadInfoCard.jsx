import React from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { User, Mail } from 'lucide-react';
import { createPageUrl } from '@/utils';

export default function LeadInfoCard({ lead, leadName }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2 }}
      className="bg-white rounded-2xl border border-slate-100 p-6"
    >
      <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-4">
        Lead Information
      </h2>
      {lead ? (
        <div className="space-y-4">
          <Link
            to={createPageUrl('LeadDetail') + `?id=${lead.id}`}
            className="flex items-center gap-4 p-3 rounded-xl hover:bg-slate-50 transition-colors group"
          >
            <div className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center">
              <User className="w-5 h-5 text-indigo-600" />
            </div>
            <div className="flex-1">
              <p className="text-xs text-slate-400 mb-0.5">Name</p>
              <p className="text-slate-800 group-hover:text-indigo-600 transition-colors">
                {leadName}
              </p>
            </div>
          </Link>
          <a
            href={`mailto:${lead.email}`}
            className="flex items-center gap-4 p-3 rounded-xl hover:bg-slate-50 transition-colors group"
          >
            <div className="w-10 h-10 rounded-lg bg-green-50 flex items-center justify-center flex-shrink-0">
              <Mail className="w-5 h-5 text-green-600" />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-slate-400 mb-0.5">Email</p>
              <p className="text-slate-800 break-words group-hover:text-green-600 transition-colors">
                {lead.email}
              </p>
            </div>
          </a>
          {lead.phone && (
            <a
              href={`tel:${lead.phone}`}
              className="flex items-center gap-4 p-3 rounded-xl hover:bg-slate-50 transition-colors group"
            >
              <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center">
                <Mail className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="text-xs text-slate-400 mb-0.5">Phone</p>
                <p className="text-slate-800 group-hover:text-blue-600 transition-colors">
                  {lead.phone}
                </p>
              </div>
            </a>
          )}
        </div>
      ) : (
        <p className="text-slate-400 text-center py-4">Loading lead information...</p>
      )}
    </motion.div>
  );
}