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
      className="bg-white rounded-2xl border border-border p-6"
    >
      <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4">
        Lead Information
      </h2>
      {lead ? (
        <div className="space-y-4">
          <Link
            to={createPageUrl('LeadDetail') + `?id=${lead.id}`}
            className="flex items-center gap-4 p-3 rounded-xl hover:bg-muted transition-colors group"
          >
            <div className="w-10 h-10 rounded-lg bg-info/12 flex items-center justify-center">
              <User className="w-5 h-5 text-info" />
            </div>
            <div className="flex-1">
              <p className="text-xs text-muted-foreground mb-0.5">Name</p>
              <p className="text-foreground group-hover:text-info transition-colors">
                {leadName}
              </p>
            </div>
          </Link>
          <a
            href={`mailto:${lead.email}`}
            className="flex items-center gap-4 p-3 rounded-xl hover:bg-muted transition-colors group"
          >
            <div className="w-10 h-10 rounded-lg bg-good/12 flex items-center justify-center flex-shrink-0">
              <Mail className="w-5 h-5 text-good" />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground mb-0.5">Email</p>
              <p className="text-foreground break-words group-hover:text-good transition-colors">
                {lead.email}
              </p>
            </div>
          </a>
          {lead.phone && (
            <a
              href={`tel:${lead.phone}`}
              className="flex items-center gap-4 p-3 rounded-xl hover:bg-muted transition-colors group"
            >
              <div className="w-10 h-10 rounded-lg bg-info/12 flex items-center justify-center">
                <Mail className="w-5 h-5 text-info" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Phone</p>
                <p className="text-foreground group-hover:text-info transition-colors">
                  {lead.phone}
                </p>
              </div>
            </a>
          )}
        </div>
      ) : (
        <p className="text-muted-foreground text-center py-4">Loading lead information...</p>
      )}
    </motion.div>
  );
}