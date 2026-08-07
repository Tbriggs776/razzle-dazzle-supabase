import React from 'react';
import { motion } from 'framer-motion';

export default function ChecklistV2Display({ checklist }) {
  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      className="mt-6 space-y-4"
    >
      {/* 1978 Warning Banner */}
      {checklist.home_built_era === 'On or before 1978' && (
        <div className="flex items-center gap-3 p-4 bg-red-50 border-2 border-red-500 rounded-xl">
          <span className="text-3xl flex-shrink-0">🛑</span>
          <div>
            <p className="text-red-700 font-bold text-lg">STOP — On or Before 1978</p>
            <p className="text-red-600 text-sm font-medium">Asbestos risk — follow proper protocol before proceeding with any demo or installation.</p>
          </div>
        </div>
      )}

      {/* Customer Contact */}
      {(checklist.customer_first_name || checklist.customer_phone || checklist.customer_email) && (
        <div className="p-4 bg-slate-50 rounded-lg">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Customer Contact</h3>
          <div className="space-y-2 text-sm">
            {checklist.customer_first_name && (
              <p><span className="text-slate-500">Name:</span> {checklist.customer_first_name} {checklist.customer_last_name}</p>
            )}
            {checklist.customer_phone && (
              <p><span className="text-slate-500">Phone:</span> <a href={`tel:${checklist.customer_phone}`} className="text-blue-600">{checklist.customer_phone}</a></p>
            )}
            {checklist.secondary_phone && (
              <p><span className="text-slate-500">Secondary Phone:</span> <a href={`tel:${checklist.secondary_phone}`} className="text-blue-600">{checklist.secondary_phone}</a></p>
            )}
            {checklist.customer_email && (
              <p><span className="text-slate-500">Email:</span> {checklist.customer_email}</p>
            )}
          </div>
        </div>
      )}

      {/* Address */}
      {(checklist.customer_street || checklist.city || checklist.state || checklist.postal_code) && (
        <div className="p-4 bg-slate-50 rounded-lg">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Address</h3>
          <div className="space-y-2 text-sm">
            {checklist.customer_street && (
              <p><span className="text-slate-500">Street:</span> {checklist.customer_street}</p>
            )}
            {(checklist.city || checklist.state || checklist.postal_code) && (
              <p><span className="text-slate-500">City/State/ZIP:</span> {[checklist.city, checklist.state, checklist.postal_code].filter(Boolean).join(', ')}</p>
            )}
            {checklist.additional_address_details && (
              <p><span className="text-slate-500">Additional details:</span> {checklist.additional_address_details}</p>
            )}
          </div>
        </div>
      )}

      {/* Property Details */}
      {(checklist.lives_at_address || checklist.home_built_era || checklist.owner_occupied_status) && (
        <div className="p-4 bg-slate-50 rounded-lg">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Property Details</h3>
          <div className="space-y-2 text-sm">
            {checklist.lives_at_address && (
              <p><span className="text-slate-500">Lives at address:</span> {checklist.lives_at_address}</p>
            )}
            {checklist.home_built_era && (
              checklist.home_built_era === 'On or before 1978' ? (
                <p className="font-bold text-red-600">🛑 Home built: {checklist.home_built_era}</p>
              ) : (
                <p><span className="text-slate-500">Home built:</span> {checklist.home_built_era}</p>
              )
            )}
            {checklist.owner_occupied_status && (
              <p><span className="text-slate-500">Status:</span> {checklist.owner_occupied_status}</p>
            )}
          </div>
        </div>
      )}

      {/* Discovery */}
      {(checklist.discovery_q1 || checklist.discovery_q2 || checklist.discovery_q3 || checklist.discovery_q4 || checklist.discovery_q5) && (
        <div className="p-4 bg-slate-50 rounded-lg">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Discovery</h3>
          <div className="space-y-2 text-sm">
            {checklist.discovery_q1 && <p><span className="text-slate-500">Current flooring / space:</span> {checklist.discovery_q1}</p>}
            {checklist.discovery_q2 && <p><span className="text-slate-500">Reason for replacing:</span> {checklist.discovery_q2}</p>}
            {checklist.discovery_q3 && <p><span className="text-slate-500">Vision / vibe:</span> {checklist.discovery_q3}</p>}
            {checklist.discovery_q4 && <p><span className="text-slate-500">Timing / urgency:</span> {checklist.discovery_q4}</p>}
            {checklist.discovery_q5 && <p><span className="text-slate-500">How they want to feel:</span> {checklist.discovery_q5}</p>}
          </div>
        </div>
      )}

      {/* Scope */}
      {(checklist.scope_flooring_products?.length > 0 || checklist.scope_gap_fill_notes || checklist.scope_pets_kids_notes || checklist.scope_baseboards || checklist.scope_tile_removal || checklist.scope_flag_over_tile || checklist.scope_flag_out_of_scope) && (
        <div className="p-4 bg-slate-50 rounded-lg">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Scope</h3>
          <div className="space-y-2 text-sm">
            {checklist.scope_flooring_products?.length > 0 && (
              <p><span className="text-slate-500">Flooring products:</span> {checklist.scope_flooring_products.join(', ')}</p>
            )}
            {checklist.scope_gap_fill_notes && <p><span className="text-slate-500">Scope notes:</span> {checklist.scope_gap_fill_notes}</p>}
            {checklist.scope_pets_kids_notes && <p><span className="text-slate-500">Pets / kids notes:</span> {checklist.scope_pets_kids_notes}</p>}
            {checklist.scope_baseboards && <p><span className="text-slate-500">New baseboards:</span> {checklist.scope_baseboards}</p>}
            {checklist.scope_tile_removal && <p><span className="text-slate-500">Tile removal:</span> {checklist.scope_tile_removal}</p>}
            {checklist.scope_flag_over_tile && (
              <p className="text-amber-700 font-semibold">⚠️ Install over existing tile</p>
            )}
            {checklist.scope_flag_out_of_scope && (
              <p className="text-orange-700 font-semibold">⚠️ Out-of-scope work mentioned</p>
            )}
          </div>
        </div>
      )}

      {/* Pre-Qualification */}
      {(checklist.prequal_dm_track || checklist.work_from_home || checklist.prequal_below_minimum) && (
        <div className="p-4 bg-slate-50 rounded-lg">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Pre-Qualification</h3>
          <div className="space-y-2 text-sm">
            {checklist.prequal_below_minimum && (
              <p className="text-red-600 font-semibold">⚠️ Below project minimum</p>
            )}
            {checklist.prequal_dm_track && (
              <p><span className="text-slate-500">Decision-maker track:</span> {{
                both_present: 'Both DMs Present',
                solo_one_leg: 'Solo / One-Leg Risk',
                single_dm: 'Single DM',
                commercial: 'Commercial'
              }[checklist.prequal_dm_track] || checklist.prequal_dm_track}</p>
            )}
            {checklist.work_from_home && (
              <p><span className="text-slate-500">Works from home:</span> {checklist.work_from_home}</p>
            )}
          </div>
        </div>
      )}

      {/* Financing */}
      {(checklist.financing_notes || checklist.credit_score_range) && (
        <div className="p-4 bg-slate-50 rounded-lg">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Financing</h3>
          <div className="space-y-2 text-sm">
            {checklist.financing_notes && <p><span className="text-slate-500">Notes:</span> {checklist.financing_notes}</p>}
            {checklist.credit_score_range && <p><span className="text-slate-500">Credit score range:</span> {checklist.credit_score_range}</p>}
          </div>
        </div>
      )}

      {/* Timeframe & Competition */}
      {(checklist.project_timeframe || checklist.collected_other_estimates || checklist.other_companies_estimates) && (
        <div className="p-4 bg-slate-50 rounded-lg">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Timeframe & Competition</h3>
          <div className="space-y-2 text-sm">
            {checklist.project_timeframe && <p><span className="text-slate-500">Timeframe:</span> {checklist.project_timeframe}</p>}
            {checklist.collected_other_estimates && <p><span className="text-slate-500">Collected other estimates:</span> {checklist.collected_other_estimates}</p>}
            {checklist.other_companies_estimates && <p><span className="text-slate-500">Other companies:</span> {checklist.other_companies_estimates}</p>}
          </div>
        </div>
      )}

      {/* Scheduling */}
      {(checklist.preferred_appointment_date || checklist.preferred_appointment_block || checklist.appointment_day || checklist.two_hour_window_confirmation || checklist.availability_notes || checklist.customer_scheduling_requests) && (
        <div className="p-4 bg-slate-50 rounded-lg">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Scheduling</h3>
          <div className="space-y-2 text-sm">
            {checklist.appointment_day && <p><span className="text-slate-500">Appointment day:</span> {checklist.appointment_day}</p>}
            {checklist.preferred_appointment_date && <p><span className="text-slate-500">Preferred date:</span> {checklist.preferred_appointment_date}</p>}
            {checklist.preferred_appointment_block && <p><span className="text-slate-500">Preferred block:</span> {checklist.preferred_appointment_block}</p>}
            {checklist.two_hour_window_confirmation && <p><span className="text-slate-500">2-hour window confirmed:</span> {checklist.two_hour_window_confirmation}</p>}
            {checklist.availability_notes && <p><span className="text-slate-500">Availability notes:</span> {checklist.availability_notes}</p>}
            {checklist.customer_scheduling_requests && <p><span className="text-slate-500">Scheduling requests:</span> {checklist.customer_scheduling_requests}</p>}
          </div>
        </div>
      )}

      {/* Marketing Source */}
      {checklist.heard_about_us && (
        <div className="p-4 bg-slate-50 rounded-lg">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Marketing Source</h3>
          <p className="text-sm text-slate-700">
            {checklist.heard_about_us}
            {checklist.heard_about_us === 'Other' && checklist.heard_about_us_other && ` - ${checklist.heard_about_us_other}`}
          </p>
        </div>
      )}

      {/* Project Notes */}
      {checklist.other_project_notes && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
          <h3 className="text-sm font-semibold text-amber-800 mb-3">📋 Additional Notes for DC</h3>
          <p className="text-sm text-amber-900 whitespace-pre-wrap">{checklist.other_project_notes}</p>
        </div>
      )}
    </motion.div>
  );
}