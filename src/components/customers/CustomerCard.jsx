import React from 'react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Mail, Phone, MapPin, Clock } from 'lucide-react';
import { motion } from 'framer-motion';

export default function CustomerCard({ customer }) {
  const initials = `${customer.first_name?.[0] || ''}${customer.last_name?.[0] || ''}`.toUpperCase();
  
  const fullAddress = [
    customer.address_line1,
    customer.city,
    customer.state,
    customer.zip
  ].filter(Boolean).join(', ');

  return (
    <Link to={createPageUrl('CustomerDetail') + `?id=${customer.id}`}>
      <motion.div
        whileHover={{ y: -4 }}
        className="bg-white rounded-2xl border border-slate-200 p-6 hover:shadow-xl hover:border-indigo-200 transition-all cursor-pointer"
      >
        <div className="flex items-start gap-4 mb-4">
          <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-lg shadow-lg flex-shrink-0">
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-semibold text-slate-800 truncate">
              {customer.first_name} {customer.last_name}
            </h3>
            <p className="text-sm text-slate-500">Customer</p>
          </div>
        </div>

        <div className="space-y-2">
          {customer.email && (
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <Mail className="w-4 h-4 text-slate-400 flex-shrink-0" />
              <span className="truncate">{customer.email}</span>
            </div>
          )}
          {customer.phone && (
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <Phone className="w-4 h-4 text-slate-400 flex-shrink-0" />
              <span>{customer.phone}</span>
            </div>
          )}
          {fullAddress && (
            <div className="flex items-start gap-2 text-sm text-slate-600">
              <MapPin className="w-4 h-4 text-slate-400 flex-shrink-0 mt-0.5" />
              <span className="line-clamp-2">{fullAddress}</span>
            </div>
          )}
          {customer.created_date && (
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <Clock className="w-3.5 h-3.5" />
              <span>
                {new Date(customer.created_date).toLocaleString('en-US', {
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
      </motion.div>
    </Link>
  );
}