import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQueryClient } from '@tanstack/react-query';
import { MapPin, Trash2, ChevronDown, ChevronUp, Plus, X } from 'lucide-react';
import StatusPill from '@/components/common/StatusPill';

// Fallback for a region that has no colour set. Deliberately left as a hex literal rather
// than a theme token: the header tint below builds its fill by concatenating an alpha suffix
// (`+ '18'`), which only works on a hex value. Region colours are user-picked and live
// outside the token system entirely, so all four usages share this one constant to stay
// consistent with each other in both themes.
const REGION_FALLBACK_COLOR = '#4F46E5';

export default function JourneyBoard({ regions, journeyOrders, teamMembers, crews, onOrdersChange }) {
  const safeCrews = Array.isArray(crews) ? crews : [];
  const queryClient = useQueryClient();
  const [expandedRegion, setExpandedRegion] = useState(null);
  const [addingCrewFor, setAddingCrewFor] = useState(null); // order id

  const getMemberName = (id) => {
    const m = teamMembers.find(m => m.id === id);
    return m ? `${m.first_name} ${m.last_name}` : '—';
  };

  const getOrdersForRegion = (regionId) =>
    journeyOrders.filter(o => o.region_assignment_id === regionId);

  const unassigned = journeyOrders.filter(o => !o.region_assignment_id);

  const handleAssignToRegion = async (orderId, region) => {
    await base44.entities.JourneyOrder.update(orderId, {
      region_assignment_id: region.id,
      region_name: region.region_name,
      field_manager_id: region.field_manager_id,
      install_coordinator_id: region.install_coordinator_id,
      order_entry_id: region.order_entry_id,
      status: 'assigned',
    });
    queryClient.invalidateQueries({ queryKey: ['journeyOrders'] });
    onOrdersChange?.();
  };

  const handleRemoveOrder = async (orderId) => {
    await base44.entities.JourneyOrder.delete(orderId);
    queryClient.invalidateQueries({ queryKey: ['journeyOrders'] });
    onOrdersChange?.();
  };

  const handleAddCrew = async (order, crew) => {
    const existing = order.installer_crews || [];
    if (existing.find(c => c.crew_id === String(crew.id))) return; // already added
    const updated = [...existing, { crew_id: String(crew.id), crew_name: crew.name }];
    await base44.entities.JourneyOrder.update(order.id, { installer_crews: updated });
    queryClient.invalidateQueries({ queryKey: ['journeyOrders'] });
    setAddingCrewFor(null);
    onOrdersChange?.();
  };

  const handleRemoveCrew = async (order, crewId) => {
    const updated = (order.installer_crews || []).filter(c => c.crew_id !== crewId);
    await base44.entities.JourneyOrder.update(order.id, { installer_crews: updated });
    queryClient.invalidateQueries({ queryKey: ['journeyOrders'] });
    onOrdersChange?.();
  };

  const OrderCard = ({ order }) => {
    const installerCrews = order.installer_crews || [];
    const isAddingCrew = addingCrewFor === order.id;

    return (
      <div className="border border-border rounded-lg p-2.5 bg-card text-xs space-y-1.5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="font-medium text-foreground truncate">{order.customer_name}</div>
            <div className="text-muted-foreground flex items-center gap-1">
              <MapPin className="w-2.5 h-2.5 shrink-0" />
              <span className="truncate">{order.city}, {order.zip_code}</span>
            </div>
            {order.install_date && (
              <div className="text-muted-foreground mt-0.5">Install: {order.install_date}</div>
            )}
          </div>
          <button
            onClick={() => handleRemoveOrder(order.id)}
            className="text-muted-foreground/60 hover:text-destructive transition-colors shrink-0"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>

        {order.field_manager_id && (
          <div className="text-muted-foreground">
            <span className="font-medium text-foreground">FM:</span> {getMemberName(order.field_manager_id)}
          </div>
        )}
        {order.install_coordinator_id && (
          <div className="text-muted-foreground">
            <span className="font-medium text-foreground">IC:</span> {getMemberName(order.install_coordinator_id)}
          </div>
        )}

        {/* Installers */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="font-medium text-foreground">Installers</span>
            <button
              onClick={() => setAddingCrewFor(isAddingCrew ? null : order.id)}
              className="text-primary hover:text-primary/70 transition-colors"
            >
              {isAddingCrew ? <X className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
            </button>
          </div>

          {installerCrews.length === 0 && !isAddingCrew && (
            <div className="text-muted-foreground/70 italic">None assigned</div>
          )}

          {installerCrews.map(c => (
            <div key={c.crew_id} className="flex items-center justify-between bg-primary/10 rounded px-1.5 py-0.5 mb-0.5">
              <span className="text-primary font-medium truncate">{c.crew_name}</span>
              <button
                onClick={() => handleRemoveCrew(order, c.crew_id)}
                className="text-primary/60 hover:text-destructive transition-colors ml-1 shrink-0"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </div>
          ))}

          {isAddingCrew && (
            <div className="mt-1 border border-border rounded-lg bg-card shadow-sm max-h-36 overflow-y-auto">
              {safeCrews.length === 0 ? (
                <div className="text-muted-foreground p-2 text-center">No crews available</div>
              ) : (
                safeCrews
                  .filter(cr => !installerCrews.find(ic => ic.crew_id === String(cr.id)))
                  .map(cr => (
                    <button
                      key={cr.id}
                      onClick={() => handleAddCrew(order, cr)}
                      className="w-full text-left px-2 py-1.5 hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors border-b border-border last:border-0"
                    >
                      {cr.name}
                    </button>
                  ))
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="h-full overflow-y-auto space-y-3 p-4">
      {/* Unassigned */}
      {unassigned.length > 0 && (
        <div className="border-2 border-dashed border-warn/40 rounded-xl p-3 bg-warn/5">
          <div
            className="flex items-center justify-between cursor-pointer"
            onClick={() => setExpandedRegion(expandedRegion === 'unassigned' ? null : 'unassigned')}
          >
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-warn" />
              <span className="font-semibold text-sm text-warn">Unassigned</span>
              <StatusPill tone="warn">{unassigned.length}</StatusPill>
            </div>
            {expandedRegion === 'unassigned' ? (
              <ChevronUp className="w-4 h-4 text-warn" />
            ) : (
              <ChevronDown className="w-4 h-4 text-warn" />
            )}
          </div>

          {expandedRegion === 'unassigned' && (
            <div className="mt-3 space-y-2">
              {unassigned.map(order => (
                <div key={order.id}>
                  <OrderCard order={order} />
                  {regions.length > 0 && (
                    <div className="flex gap-1 mt-1 flex-wrap">
                      {regions.map(region => (
                        // text-white is intentional: the background is the region's own
                        // user-picked colour (inline style), so no theme token applies here.
                        <button
                          key={region.id}
                          onClick={() => handleAssignToRegion(order.id, region)}
                          className="text-xs px-2 py-0.5 rounded-full text-white font-medium"
                          style={{ backgroundColor: region.color || REGION_FALLBACK_COLOR }}
                        >
                          → {region.region_name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Per-region columns */}
      {regions.map((region) => {
        const orders = getOrdersForRegion(region.id);
        const isOpen = expandedRegion === region.id;

        return (
          <div
            key={region.id}
            className="border rounded-xl overflow-hidden bg-card"
            style={{ borderColor: region.color || REGION_FALLBACK_COLOR }}
          >
            <div
              className="flex items-center justify-between px-3 py-2.5 cursor-pointer"
              style={{ backgroundColor: (region.color || REGION_FALLBACK_COLOR) + '18' }}
              onClick={() => setExpandedRegion(isOpen ? null : region.id)}
            >
              <div className="flex items-center gap-2">
                <div
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: region.color || REGION_FALLBACK_COLOR }}
                />
                <span className="font-semibold text-sm text-foreground">{region.region_name}</span>
                {/* text-white is intentional: fill is the region's own colour, not a token. */}
                <span
                  className="text-xs rounded px-1.5 py-0.5 text-white font-medium"
                  style={{ backgroundColor: region.color || REGION_FALLBACK_COLOR }}
                >
                  {orders.length}
                </span>
              </div>
              {isOpen ? (
                <ChevronUp className="w-4 h-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
              )}
            </div>

            {isOpen && (
              <div className="p-3 space-y-2">
                {orders.length === 0 ? (
                  <div className="text-xs text-muted-foreground text-center py-3">No orders assigned</div>
                ) : (
                  orders.map(order => <OrderCard key={order.id} order={order} />)
                )}
              </div>
            )}
          </div>
        );
      })}

      {regions.length === 0 && journeyOrders.length === 0 && (
        <div className="text-center py-16 text-muted-foreground text-sm">
          Define regions and tag orders to get started.
        </div>
      )}
    </div>
  );
}
