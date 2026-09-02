import React, { useState } from 'react';
import { motion } from 'framer-motion';
import PhotoLightbox from '@/components/PhotoLightbox';
import { SignedImage } from '@/lib/fileUrl';

export default function ChecklistDisplay({ checklist }) {
  const [lightboxIndex, setLightboxIndex] = useState(null);
  const photos = checklist.photos || [];

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      className="mt-6 space-y-4"
    >
      {/* 1978 Warning Banner */}
      {checklist.home_built_era === 'On or before 1978' && (
        <div className="flex items-center gap-3 p-4 bg-crit/12 border-2 border-crit rounded-xl">
          <span className="text-3xl flex-shrink-0">🛑</span>
          <div>
            <p className="text-crit font-bold text-lg">STOP — On or Before 1978</p>
            <p className="text-crit text-sm font-medium">Asbestos risk — follow proper protocol before proceeding with any demo or installation.</p>
          </div>
        </div>
      )}

      {/* Customer Contact */}
      {(checklist.customer_first_name || checklist.customer_phone || checklist.customer_email) && (
        <div className="p-4 bg-muted rounded-lg">
          <h3 className="text-sm font-semibold text-foreground mb-3">Customer Contact</h3>
          <div className="space-y-2 text-sm">
            {checklist.customer_first_name && (
              <p><span className="text-muted-foreground">Name:</span> {checklist.customer_first_name} {checklist.customer_last_name}</p>
            )}
            {checklist.customer_phone && (
              <p><span className="text-muted-foreground">Phone:</span> <a href={`tel:${checklist.customer_phone}`} className="text-info">{checklist.customer_phone}</a></p>
            )}
            {checklist.secondary_phone && (
              <p><span className="text-muted-foreground">Secondary Phone:</span> <a href={`tel:${checklist.secondary_phone}`} className="text-info">{checklist.secondary_phone}</a></p>
            )}
            {checklist.customer_email && (
              <p><span className="text-muted-foreground">Email:</span> {checklist.customer_email}</p>
            )}
          </div>
        </div>
      )}

      {/* Address */}
      {(checklist.customer_street || checklist.city || checklist.state || checklist.postal_code) && (
        <div className="p-4 bg-muted rounded-lg">
          <h3 className="text-sm font-semibold text-foreground mb-3">Address</h3>
          <div className="space-y-2 text-sm">
            {checklist.customer_street && (
              <p><span className="text-muted-foreground">Street:</span> {checklist.customer_street}</p>
            )}
            {(checklist.city || checklist.state || checklist.postal_code) && (
              <p><span className="text-muted-foreground">City/State/ZIP:</span> {[checklist.city, checklist.state, checklist.postal_code].filter(Boolean).join(', ')}</p>
            )}
            {checklist.additional_address_details && (
              <p><span className="text-muted-foreground">Additional details:</span> {checklist.additional_address_details}</p>
            )}
          </div>
        </div>
      )}

      {/* Property Details */}
      {(checklist.lives_at_address || checklist.home_built_era || checklist.property_year || checklist.owner_occupied_status) && (
        <div className="p-4 bg-muted rounded-lg">
          <h3 className="text-sm font-semibold text-foreground mb-3">Property Details</h3>
          <div className="space-y-2 text-sm">
            {checklist.lives_at_address && (
              <p><span className="text-muted-foreground">Lives at address:</span> {checklist.lives_at_address}</p>
            )}
            {checklist.home_built_era && (
              checklist.home_built_era === 'On or before 1978' ? (
                <p className="font-bold text-crit">🛑 Home built: {checklist.home_built_era}</p>
              ) : (
                <p><span className="text-muted-foreground">Home built:</span> {checklist.home_built_era}</p>
              )
            )}
            {checklist.property_year && (
              <p><span className="text-muted-foreground">Property year:</span> {checklist.property_year}</p>
            )}
            {checklist.owner_occupied_status && (
              <p><span className="text-muted-foreground">Status:</span> {checklist.owner_occupied_status}</p>
            )}
          </div>
        </div>
      )}

      {/* Project Details */}
      {(checklist.reason_for_call || checklist.number_of_rooms || checklist.estimated_sq_footage || checklist.flooring_products?.length > 0 || checklist.colors_interest || checklist.plank_size_preference || checklist.value_adds_1?.length > 0 || checklist.value_adds_2?.length > 0) && (
        <div className="p-4 bg-muted rounded-lg">
          <h3 className="text-sm font-semibold text-foreground mb-3">Project Details</h3>
          <div className="space-y-2 text-sm">
            {checklist.reason_for_call && <p><span className="text-muted-foreground">Reason for call:</span> {checklist.reason_for_call}</p>}
            {checklist.number_of_rooms && <p><span className="text-muted-foreground">Number of rooms:</span> {checklist.number_of_rooms}</p>}
            {checklist.estimated_sq_footage && <p><span className="text-muted-foreground">Est. sq footage:</span> {checklist.estimated_sq_footage}</p>}
            {checklist.flooring_products?.length > 0 && <p><span className="text-muted-foreground">Flooring products:</span> {checklist.flooring_products.join(', ')}</p>}
            {checklist.colors_interest && <p><span className="text-muted-foreground">Colors of interest:</span> {checklist.colors_interest}</p>}
            {checklist.unique_product_color && (
              <div className="flex items-center gap-2 p-2 bg-warn/12 border border-warn/25 rounded-lg">
                <span className="text-warn font-bold">⚠️</span>
                <p className="text-warn font-semibold text-sm">Unique product color — reference notes</p>
              </div>
            )}
            {checklist.plank_size_preference && <p><span className="text-muted-foreground">Plank size preference:</span> {checklist.plank_size_preference}</p>}
            {checklist.value_adds_1?.length > 0 && <p><span className="text-muted-foreground">Value adds:</span> {checklist.value_adds_1.join(', ')}</p>}
            {checklist.value_adds_2?.length > 0 && <p><span className="text-muted-foreground">Additional value adds:</span> {checklist.value_adds_2.join(', ')}</p>}
            {checklist.in_stock_product_options && <p><span className="text-muted-foreground">In stock options:</span> {checklist.in_stock_product_options}</p>}
            {checklist.next_day_or_2_day_install && <p><span className="text-muted-foreground">Next day / 2-day install:</span> Yes</p>}
            {checklist.free_air_duct_cleaning && <p><span className="text-muted-foreground">Free air duct cleaning:</span> Yes</p>}
            {checklist.unique_value_prop && <p><span className="text-muted-foreground">Unique value prop:</span> {checklist.unique_value_prop}</p>}
            {checklist.project_timeframe && <p><span className="text-muted-foreground">Project timeframe:</span> {checklist.project_timeframe}</p>}
          </div>
        </div>
      )}

      {/* Household & Preferences */}
      {(checklist.has_pets || checklist.significant_other_name || checklist.work_from_home || checklist.require_all_parties_present) && (
        <div className="p-4 bg-muted rounded-lg">
          <h3 className="text-sm font-semibold text-foreground mb-3">Household & Preferences</h3>
          <div className="space-y-2 text-sm">
            {checklist.has_pets && <p><span className="text-muted-foreground">Has pets:</span> {checklist.has_pets}</p>}
            {checklist.significant_other_name && <p><span className="text-muted-foreground">Significant other:</span> {checklist.significant_other_name}</p>}
            {checklist.require_all_parties_present && <p><span className="text-muted-foreground">All parties present:</span> {checklist.require_all_parties_present}</p>}
            {checklist.work_from_home && <p><span className="text-muted-foreground">Works from home:</span> {checklist.work_from_home}</p>}
          </div>
        </div>
      )}

      {/* Budget & Financing */}
      {(checklist.project_budget || checklist.financing_options || checklist.credit_score_range) && (
        <div className="p-4 bg-muted rounded-lg">
          <h3 className="text-sm font-semibold text-foreground mb-3">Budget & Financing</h3>
          <div className="space-y-2 text-sm">
            {checklist.project_budget && <p><span className="text-muted-foreground">Budget:</span> {checklist.project_budget}</p>}
            {checklist.financing_options && <p><span className="text-muted-foreground">Financing:</span> {checklist.financing_options}</p>}
            {checklist.credit_score_range && <p><span className="text-muted-foreground">Credit score:</span> {checklist.credit_score_range}</p>}
          </div>
        </div>
      )}

      {/* Competition */}
      {(checklist.collected_other_estimates || checklist.other_companies_estimates) && (
        <div className="p-4 bg-muted rounded-lg">
          <h3 className="text-sm font-semibold text-foreground mb-3">Competition</h3>
          <div className="space-y-2 text-sm">
            {checklist.collected_other_estimates && <p><span className="text-muted-foreground">Collected other estimates:</span> {checklist.collected_other_estimates}</p>}
            {checklist.other_companies_estimates && <p><span className="text-muted-foreground">Other companies:</span> {checklist.other_companies_estimates}</p>}
          </div>
        </div>
      )}

      {/* Scheduling */}
      {(checklist.preferred_appointment_date || checklist.preferred_appointment_block || checklist.appointment_day || checklist.two_hour_window_confirmation || checklist.availability_notes || checklist.customer_scheduling_requests) && (
        <div className="p-4 bg-muted rounded-lg">
          <h3 className="text-sm font-semibold text-foreground mb-3">Scheduling</h3>
          <div className="space-y-2 text-sm">
            {checklist.appointment_day && <p><span className="text-muted-foreground">Appointment day:</span> {checklist.appointment_day}</p>}
            {checklist.preferred_appointment_date && <p><span className="text-muted-foreground">Preferred date:</span> {checklist.preferred_appointment_date}</p>}
            {checklist.preferred_appointment_block && <p><span className="text-muted-foreground">Preferred block:</span> {checklist.preferred_appointment_block}</p>}
            {checklist.two_hour_window_confirmation && <p><span className="text-muted-foreground">2-hour window confirmed:</span> {checklist.two_hour_window_confirmation}</p>}
            {checklist.availability_notes && <p><span className="text-muted-foreground">Availability notes:</span> {checklist.availability_notes}</p>}
            {checklist.customer_scheduling_requests && <p><span className="text-muted-foreground">Scheduling requests:</span> {checklist.customer_scheduling_requests}</p>}
          </div>
        </div>
      )}

      {/* Project Notes */}
      {checklist.other_project_notes && (
        <div className="p-4 bg-warn/12 border border-warn/25 rounded-lg">
          <h3 className="text-sm font-semibold text-warn mb-3">📋 Project Notes / DC Setup Notes</h3>
          <p className="text-sm text-warn whitespace-pre-wrap">{checklist.other_project_notes}</p>
        </div>
      )}

      {/* Final Categories */}
      {(checklist.home_size || checklist.material_type?.length > 0 || checklist.budget_range) && (
        <div className="p-4 bg-info/12 border border-info/25 rounded-lg">
          <h3 className="text-sm font-semibold text-info mb-3">🏠 Final Categories</h3>
          <div className="space-y-3">
            {checklist.home_size && (
              <div>
                <p className="text-xs text-info font-medium mb-1.5">Home Size</p>
                <span className="inline-block px-3 py-1.5 rounded-lg bg-info text-white text-sm font-medium">{checklist.home_size}</span>
              </div>
            )}
            {checklist.material_type?.length > 0 && (
              <div>
                <p className="text-xs text-info font-medium mb-1.5">Material Type</p>
                <div className="flex flex-wrap gap-2">
                  {checklist.material_type.map(m => (
                    <span key={m} className="inline-block px-3 py-1.5 rounded-lg bg-info text-white text-sm font-medium">{m}</span>
                  ))}
                </div>
              </div>
            )}
            {checklist.budget_range && (
              <div>
                <p className="text-xs text-info font-medium mb-1.5">Budget</p>
                <span className="inline-block px-3 py-1.5 rounded-lg bg-info text-white text-sm font-medium">{checklist.budget_range}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Marketing Source */}
      {checklist.heard_about_us && (
        <div className="p-4 bg-muted rounded-lg">
          <h3 className="text-sm font-semibold text-foreground mb-3">Marketing Source</h3>
          <p className="text-sm text-foreground">
            {checklist.heard_about_us}
            {checklist.heard_about_us === 'Other' && checklist.heard_about_us_other && ` - ${checklist.heard_about_us_other}`}
          </p>
        </div>
      )}

      {/* Photos */}
      {photos.length > 0 && (
        <div className="p-4 bg-muted rounded-lg">
          <h3 className="text-sm font-semibold text-foreground mb-3">📷 Photos ({photos.length})</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {photos.map((url, index) => (
              <button key={index} onClick={() => setLightboxIndex(index)} className="focus:outline-none">
                <SignedImage
                  src={url}
                  alt={`Checklist photo ${index + 1}`}
                  className="w-full h-32 object-cover rounded-lg border border-border hover:opacity-90 transition-opacity cursor-pointer"
                />
              </button>
            ))}
          </div>
        </div>
      )}

      <PhotoLightbox photos={photos} lightboxIndex={lightboxIndex} onClose={setLightboxIndex} />
    </motion.div>
  );
}