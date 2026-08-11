import React from 'react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Mail, Phone, ChevronRight, Calendar } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { SignedImage } from '@/lib/fileUrl';

const roleColors = {
  'Admin': 'bg-purple-100 text-purple-800 border-purple-200',
  'Design Consultant': 'bg-blue-100 text-blue-800 border-blue-200',
  'Customer Service Rep': 'bg-green-100 text-green-800 border-green-200'
};

export default function TeamMemberCard({ teamMember, index }) {
  const initials = `${teamMember.first_name?.[0] || ''}${teamMember.last_name?.[0] || ''}`.toUpperCase();
  const fullName = `${teamMember.first_name} ${teamMember.last_name}`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.05 }}
    >
      <Link
        to={createPageUrl('TeamMemberDetail') + `?id=${teamMember.id}`}
        className="group block bg-white rounded-2xl border border-slate-100 p-6 hover:border-indigo-200 hover:shadow-lg hover:shadow-indigo-50 transition-all duration-300"
      >
        <div className="flex items-start gap-4">
          {/* Avatar */}
          <div className="flex-shrink-0 w-14 h-14 rounded-xl overflow-hidden shadow-lg shadow-indigo-200">
            {teamMember.profile_photo ? (
              <SignedImage
                src={teamMember.profile_photo}
                alt={fullName}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-semibold text-lg">
                {initials}
              </div>
            )}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <h3 className="text-lg font-semibold text-slate-800 group-hover:text-indigo-600 transition-colors truncate">
                  {fullName}
                </h3>
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <Badge variant="secondary" className={cn('border', roleColors[teamMember.role])}>
                    {teamMember.role}
                  </Badge>
                  <Badge 
                    variant="secondary" 
                    className={cn(
                      'border',
                      teamMember.is_active 
                        ? 'bg-green-50 text-green-700 border-green-200' 
                        : 'bg-slate-100 text-slate-600 border-slate-200'
                    )}
                  >
                    {teamMember.is_active ? 'Active' : 'Inactive'}
                  </Badge>
                  {teamMember.calendar_integration_enabled && (
                    <Badge variant="secondary" className="bg-orange-50 text-orange-700 border-orange-200 border">
                      <Calendar className="w-3 h-3 mr-1" />
                      Calendar
                    </Badge>
                  )}
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-slate-300 group-hover:text-indigo-500 group-hover:translate-x-1 transition-all flex-shrink-0" />
            </div>

            <div className="mt-3 space-y-2">
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <Mail className="w-4 h-4 text-slate-400" />
                <span className="truncate">{teamMember.email}</span>
              </div>
              {teamMember.phone && (
                <div className="flex items-center gap-2 text-sm text-slate-500">
                  <Phone className="w-4 h-4 text-slate-400" />
                  <span>{teamMember.phone}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </Link>
    </motion.div>
  );
}