import React from 'react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Mail, Phone, MapPin, ChevronRight, Clock } from 'lucide-react';
import { motion } from 'framer-motion';

export default function LeadCard({ lead, index }) {
  const initials = `${lead.first_name?.[0] || ''}${lead.last_name?.[0] || ''}`.toUpperCase();
  const fullName = `${lead.first_name} ${lead.last_name}`;
  const hasAddress = lead.city || lead.state;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.05 }}
    >
      <Link
        to={createPageUrl('LeadDetail') + `?id=${lead.id}`}
        className="group block bg-white rounded-2xl border border-border p-6 hover:border-info/25 hover:shadow-lg hover:shadow-indigo-50 transition-all duration-300"
      >
        <div className="flex items-start gap-4">
          {/* Avatar */}
          <div className="flex-shrink-0 w-14 h-14 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-semibold text-lg shadow-lg shadow-indigo-200">
            {initials}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-foreground group-hover:text-info transition-colors truncate">
                {fullName}
              </h3>
              <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-info group-hover:translate-x-1 transition-all flex-shrink-0" />
            </div>

            <div className="mt-3 space-y-2">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Mail className="w-4 h-4 text-muted-foreground" />
                <span className="truncate">{lead.email}</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Phone className="w-4 h-4 text-muted-foreground" />
                <span>{lead.phone}</span>
              </div>
              {hasAddress && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <MapPin className="w-4 h-4 text-muted-foreground" />
                  <span className="truncate">
                    {[lead.city, lead.state].filter(Boolean).join(', ')}
                  </span>
                </div>
              )}
              {lead.created_date && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Clock className="w-3.5 h-3.5" />
                  <span>
                    {new Date(lead.created_date).toLocaleString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                      hour12: true
                    })}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </Link>
    </motion.div>
  );
}