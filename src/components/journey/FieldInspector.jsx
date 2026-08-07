import React, { useState, useMemo, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polygon, useMap } from 'react-leaflet';
import { isSameDay, parseISO, format, addDays, subDays } from 'date-fns';
import { ChevronLeft, ChevronRight, MapPin, User, Hash, Navigation, Loader2, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { base44 } from '@/api/base44Client';
import { getProductCategoryName } from './productCodes';
import { useLanguage } from '@/lib/i18n/LanguageContext';

const HOME_BASE = { lat: 33.3886, lng: -111.9253, label: '3910 S Rural Dr, Tempe, AZ 85282' };

// Nearest-neighbor TSP heuristic starting from home base
function optimizeRoute(orders) {
  const geocoded = orders.filter(o => o.lat && o.lng);
  const ungeoced = orders.filter(o => !o.lat || !o.lng);
  if (geocoded.length === 0) return [...ungeoced];

  const dist = (a, b) => Math.hypot(a.lat - b.lat, a.lng - b.lng);
  const remaining = [...geocoded];
  const route = [];
  let current = HOME_BASE;

  while (remaining.length > 0) {
    let nearestIdx = 0;
    let nearestDist = dist(current, remaining[0]);
    for (let i = 1; i < remaining.length; i++) {
      const d = dist(current, remaining[i]);
      if (d < nearestDist) { nearestDist = d; nearestIdx = i; }
    }
    const next = remaining.splice(nearestIdx, 1)[0];
    route.push(next);
    current = next;
  }

  return [...route, ...ungeoced];
}

function buildGoogleMapsUrl(routedOrders) {
  const geocoded = routedOrders.filter(o => o.lat && o.lng);
  if (geocoded.length === 0) return null;
  const origin = `${HOME_BASE.lat},${HOME_BASE.lng}`;
  const destination = `${geocoded[geocoded.length - 1].lat},${geocoded[geocoded.length - 1].lng}`;
  const waypoints = geocoded.slice(0, -1).map(o => `${o.lat},${o.lng}`).join('|');
  let url = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}&travelmode=driving`;
  if (waypoints) url += `&waypoints=${encodeURIComponent(waypoints)}`;
  return url;
}

// Fix default marker icons
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

function MapController({ myRegions }) {
  const map = useMap();

  useEffect(() => {
    // Collect all polygon coordinates from the field manager's regions
    const allCoords = myRegions.flatMap(r => r.polygon_coordinates || []);
    if (allCoords.length > 0) {
      const bounds = L.latLngBounds(allCoords.map(([lat, lng]) => [lat, lng]));
      map.fitBounds(bounds, { padding: [40, 40], animate: true });
    }
  }, [myRegions]);

  return null;
}

function createOrderIcon(color) {
  return L.divIcon({
    className: '',
    html: `<div style="width:14px;height:14px;border-radius:50%;background:${color};border:2.5px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.35)"></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
}

const homeBaseIcon = L.divIcon({
  className: '',
  html: `<div style="width:22px;height:22px;border-radius:50%;background:#1e293b;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;font-size:11px;color:white;line-height:1">🏠</div>`,
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

function JobCard({ order, region, isSelected, onClick, stopNumber }) {
  const { t } = useLanguage();
  const color = region?.color || '#94a3b8';
  const singleStopUrl = order.lat && order.lng
    ? `https://www.google.com/maps/dir/?api=1&origin=${HOME_BASE.lat},${HOME_BASE.lng}&destination=${order.lat},${order.lng}&travelmode=driving`
    : order.address
    ? `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(HOME_BASE.label)}&destination=${encodeURIComponent([order.address, order.city, order.state, order.zip_code].filter(Boolean).join(', '))}&travelmode=driving`
    : null;

  return (
    <div
      onClick={onClick}
      className={cn(
        "bg-white rounded-xl border shadow-sm overflow-hidden cursor-pointer transition-all",
        isSelected ? "border-indigo-400 ring-2 ring-indigo-200 shadow-md" : "border-slate-200 hover:border-slate-300 hover:shadow-md"
      )}
    >
      <div className="h-1 w-full" style={{ backgroundColor: color }} />
      <div className="p-3">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex items-start gap-2 flex-1 min-w-0">
            {stopNumber != null && (
              <span className="shrink-0 w-5 h-5 rounded-full bg-indigo-600 text-white text-[10px] font-bold flex items-center justify-center mt-0.5">
                {stopNumber}
              </span>
            )}
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-slate-800 text-sm leading-tight truncate">
                {order.customer_name || order.invoice_number || order.rfms_order_id}
              </p>
              <div className="flex items-center gap-1.5">
                {order.invoice_number && (
                  <p className="text-[11px] text-slate-400 flex items-center gap-1">
                    <Hash className="w-3 h-3 shrink-0" /> {order.invoice_number}
                  </p>
                )}
                {order.order_total > 0 && (
                  <span className="text-[11px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-full">
                    ${order.order_total.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                  </span>
                )}
              </div>
            </div>
          </div>
          {region && (
            <span
              className="shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full text-white"
              style={{ backgroundColor: color }}
            >
              {region.region_name}
            </span>
          )}
        </div>

        <div className="space-y-1">
          {order.address && (
            <div className="flex items-start gap-1.5 text-[11px] text-slate-500">
              <MapPin className="w-3 h-3 text-slate-400 shrink-0 mt-0.5" />
              <span className="truncate">{[order.address, order.city, order.zip_code].filter(Boolean).join(', ')}</span>
            </div>
          )}
          {order.preferred_installer_crew_name && (
            <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
              <User className="w-3 h-3 text-slate-400 shrink-0" />
              <span className="truncate">{order.preferred_installer_crew_name}</span>
            </div>
          )}
          {order.line_items?.length > 0 && (
            <div className="mt-1.5 pt-1.5 border-t border-slate-100 space-y-0.5">
              {order.line_items.filter(l => l.styleName).map((item, i) => {
                const categoryName = getProductCategoryName(item.productCode);
                return (
                <div key={i} className="text-[10px] text-slate-500 flex items-start gap-1">
                  <span className="shrink-0 font-mono bg-slate-100 text-slate-400 px-1 rounded text-[9px]">{item.productCode || '—'}</span>
                  <span className="truncate">
                    {item.styleName}
                    {item.colorName ? <span className="text-slate-400"> · {item.colorName}</span> : null}
                  </span>
                  {categoryName && (
                    <span className="shrink-0 text-[9px] font-semibold text-indigo-600 bg-indigo-50 px-1 rounded">{categoryName}</span>
                  )}
                  {item.quantity > 0 && (
                    <span className="ml-auto shrink-0 text-slate-400">{item.quantity}{item.unit ? ` ${item.unit}` : ''}</span>
                  )}
                </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="mt-2 flex items-center justify-between">
          <span className={cn(
            "text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full",
            order.status === 'completed' ? 'bg-green-100 text-green-700' :
            order.status === 'in_progress' ? 'bg-blue-100 text-blue-700' :
            order.status === 'assigned' ? 'bg-indigo-100 text-indigo-700' :
            'bg-slate-100 text-slate-500'
          )}>
            {order.status || 'unassigned'}
          </span>
          {singleStopUrl && (
            <a
              href={singleStopUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              className="flex items-center gap-1 text-[10px] text-indigo-600 hover:text-indigo-800 hover:underline"
            >
              <Navigation className="w-3 h-3" /> {t('fiDirections')}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

export default function FieldInspector({ journeyOrders, regions, teamMembers, onOrdersUpdated }) {
  const { t } = useLanguage();
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [selectedMemberId, setSelectedMemberId] = useState('');
  const [selectedOrderId, setSelectedOrderId] = useState(null);
  const [geocodingIds, setGeocodingIds] = useState(new Set());
  const geocodedRef = useRef(new Set()); // track already-attempted IDs this session

  const AZ_CENTER = [33.4484, -112.0740];

  // Field managers from regions
  const fieldManagers = useMemo(() => {
    const ids = [...new Set(regions.map(r => r.field_manager_id).filter(Boolean))];
    return teamMembers.filter(m => ids.includes(m.id));
  }, [regions, teamMembers]);

  useEffect(() => {
    if (!selectedMemberId && fieldManagers.length > 0) {
      setSelectedMemberId(fieldManagers[0].id);
    }
  }, [fieldManagers, selectedMemberId]);

  // Regions for selected field manager
  const myRegions = useMemo(() =>
    regions.filter(r => r.field_manager_id === selectedMemberId),
    [regions, selectedMemberId]
  );

  const myRegionIds = useMemo(() => new Set(myRegions.map(r => r.id)), [myRegions]);

  // Orders for selected date + field manager's regions
  const ordersForDay = useMemo(() =>
    journeyOrders.filter(jo => {
      if (!jo.install_date) return false;
      try {
        return isSameDay(parseISO(jo.install_date), selectedDate) && myRegionIds.has(jo.region_assignment_id);
      } catch { return false; }
    }),
    [journeyOrders, selectedDate, myRegionIds]
  );

  const routedOrders = useMemo(() => optimizeRoute(ordersForDay), [ordersForDay]);
  const mappableOrders = useMemo(() => routedOrders.filter(o => o.lat && o.lng), [routedOrders]);
  const fullRouteUrl = useMemo(() => buildGoogleMapsUrl(routedOrders), [routedOrders]);

  // Auto-geocode orders missing lat/lng
  useEffect(() => {
    const missing = ordersForDay.filter(o => !o.lat && !o.lng && o.address && !geocodedRef.current.has(o.id));
    if (missing.length === 0) return;

    missing.forEach(o => geocodedRef.current.add(o.id));
    setGeocodingIds(prev => { const next = new Set(prev); missing.forEach(o => next.add(o.id)); return next; });

    Promise.all(missing.map(async (order) => {
      const fullAddr = [order.address, order.city, order.state, order.zip_code].filter(Boolean).join(', ');
      try {
        const res = await base44.functions.invoke('journeyGeocode', { address: fullAddr });
        if (res.data?.success && res.data.lat && res.data.lng) {
          await base44.entities.JourneyOrder.update(order.id, { lat: res.data.lat, lng: res.data.lng });
        }
      } catch (e) { /* ignore */ }
    })).finally(() => {
      setGeocodingIds(prev => {
        const next = new Set(prev);
        missing.forEach(o => next.delete(o.id));
        return next;
      });
      if (onOrdersUpdated) onOrdersUpdated();
    });
  }, [ordersForDay]);

  // All orders for this field manager's regions (any date) that have coords
  const allMappableOrders = useMemo(() =>
    journeyOrders.filter(jo => jo.lat && jo.lng && myRegionIds.has(jo.region_assignment_id)),
    [journeyOrders, myRegionIds]
  );

  const isToday = isSameDay(selectedDate, new Date());

  return (
    <div className="flex flex-col h-full">
      {/* Top controls bar */}
      <div className="bg-white border-b border-slate-200 px-4 py-2.5 shrink-0 flex flex-wrap gap-3 items-center">
        <span className="text-sm font-bold text-slate-700 mr-1">{t('fiTitle')}</span>

        {/* Field Manager picker */}
        <div className="flex items-center gap-1.5">
          <User className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <select
            value={selectedMemberId}
            onChange={e => setSelectedMemberId(e.target.value)}
            className="text-sm border border-slate-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white text-slate-700"
          >
            {fieldManagers.length === 0 && <option value="">{t('fiNoFieldManagers')}</option>}
            {fieldManagers.map(m => (
              <option key={m.id} value={m.id}>{m.first_name} {m.last_name}</option>
            ))}
          </select>
        </div>

        {/* Date nav */}
        <div className="flex items-center gap-1 ml-auto">
          <button onClick={() => setSelectedDate(d => subDays(d, 1))} className="p-1 rounded hover:bg-slate-100">
            <ChevronLeft className="w-4 h-4 text-slate-600" />
          </button>
          <button
            onClick={() => setSelectedDate(new Date())}
            className={cn(
              "px-3 py-1 rounded-lg text-sm font-medium transition-colors",
              isToday ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-100"
            )}
          >
            {format(selectedDate, 'MMM d, yyyy')}
          </button>
          <button onClick={() => setSelectedDate(d => addDays(d, 1))} className="p-1 rounded hover:bg-slate-100">
            <ChevronRight className="w-4 h-4 text-slate-600" />
          </button>
          {!isToday && (
          <button onClick={() => setSelectedDate(new Date())} className="ml-1 text-xs text-indigo-600 hover:underline">
            {t('fiToday')}
          </button>
          )}
          </div>

          {/* Job count */}
          <span className="bg-indigo-100 text-indigo-700 text-xs font-bold rounded-full px-2.5 py-0.5 shrink-0">
          {t('fiJobsCount', { count: ordersForDay.length })}
          </span>
          {geocodingIds.size > 0 && (
          <span className="flex items-center gap-1 text-xs text-slate-400">
          <Loader2 className="w-3 h-3 animate-spin" />
          {t('fiGeocoding', { count: geocodingIds.size })}
          </span>
          )}
          {fullRouteUrl && (
          <a
          href={fullRouteUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg transition-colors shrink-0"
          >
          <Navigation className="w-3.5 h-3.5" />
          {t('fiFullRoute')}
          <ExternalLink className="w-3 h-3 opacity-70" />
          </a>
          )}
      </div>

      {/* Main split: map left, cards right */}
      <div className="flex flex-1 min-h-0">

        {/* Map */}
        <div className="flex-1 relative">
          <MapContainer
            center={AZ_CENTER}
            zoom={9}
            style={{ height: '100%', width: '100%' }}
          >
            <TileLayer
              attribution='&copy; <a href="https://carto.com/attributions">CARTO</a>'
              url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
              subdomains="abcd"
              maxZoom={19}
            />

            <MapController myRegions={myRegions} />

            {/* Region polygons */}
            {myRegions.map((region, idx) =>
              region.polygon_coordinates?.length > 0 ? (
                <Polygon
                  key={region.id}
                  positions={region.polygon_coordinates}
                  pathOptions={{
                    color: region.color || '#4F46E5',
                    fillColor: region.color || '#4F46E5',
                    fillOpacity: 0.1,
                    weight: 2,
                  }}
                />
              ) : null
            )}

            {/* Home base marker */}
            <Marker position={[HOME_BASE.lat, HOME_BASE.lng]} icon={homeBaseIcon}>
              <Popup>
                <div className="text-sm font-semibold">{t('fiHomeBase')}</div>
                <div className="text-xs text-gray-500 mt-0.5">{HOME_BASE.label}</div>
              </Popup>
            </Marker>

            {/* All assigned orders (dimmed if not on selected date) */}
            {allMappableOrders.map(order => {
              const region = regions.find(r => r.id === order.region_assignment_id);
              const color = region?.color || '#94a3b8';
              const isSelected = selectedOrderId === order.id;
              const stopIdx = routedOrders.findIndex(o => o.id === order.id);
              const isOnSelectedDate = stopIdx !== -1;
              const markerColor = isSelected ? '#4F46E5' : isOnSelectedDate ? color : '#cbd5e1';
              return (
                <Marker
                  key={order.id}
                  position={[order.lat, order.lng]}
                  icon={createOrderIcon(markerColor)}
                  eventHandlers={{ click: () => setSelectedOrderId(order.id === selectedOrderId ? null : order.id) }}
                >
                  <Popup>
                    <div className="text-sm font-semibold leading-tight">
                      {isOnSelectedDate && <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-indigo-600 text-white text-[10px] font-bold mr-1">{stopIdx + 1}</span>}
                      {order.customer_name || order.invoice_number}
                    </div>
                    {order.install_date && <div className="text-xs text-indigo-600 mt-0.5">📅 {order.install_date}</div>}
                    {order.address && <div className="text-xs text-gray-500 mt-0.5">{order.address}</div>}
                    {order.zip_code && <div className="text-xs text-gray-400">{order.city}, {order.zip_code}</div>}
                    {region && (
                      <div className="text-xs font-medium mt-1" style={{ color: region.color }}>
                        {region.region_name}
                      </div>
                    )}
                    {order.preferred_installer_crew_name && (
                      <div className="text-xs text-gray-500 mt-0.5">👷 {order.preferred_installer_crew_name}</div>
                    )}
                  </Popup>
                </Marker>
              );
            })}
          </MapContainer>

          {/* No geo data notice */}
          {allMappableOrders.length === 0 && myRegionIds.size > 0 && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-white/90 backdrop-blur-sm rounded-xl shadow px-4 py-2 text-xs text-slate-500 z-[1000]">
              {t('fiNoGeoData')}
            </div>
          )}
        </div>

        {/* Right panel: job cards */}
        <div className="w-72 shrink-0 border-l border-slate-200 bg-slate-50 flex flex-col overflow-hidden">
          {/* Region tags */}
          {myRegions.length > 0 && (
            <div className="px-3 py-2 border-b border-slate-200 flex flex-wrap gap-1.5 bg-white">
              {myRegions.map(r => (
                <div key={r.id} className="flex items-center gap-1 text-[10px] text-slate-500 bg-slate-50 border border-slate-200 rounded-full px-2 py-0.5">
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: r.color || '#94a3b8' }} />
                  {r.region_name}
                </div>
              ))}
            </div>
          )}

          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {selectedMemberId === '' ? (
              <p className="text-xs text-slate-400 text-center mt-8">{t('fiNoFieldManagersRegions')}</p>
            ) : ordersForDay.length === 0 ? (
              <p className="text-xs text-slate-400 text-center mt-8">{t('fiNoJobsDate')}</p>
            ) : (
              routedOrders.map((order, idx) => {
                const region = regions.find(r => r.id === order.region_assignment_id);
                return (
                  <JobCard
                    key={order.id}
                    order={order}
                    region={region}
                    isSelected={selectedOrderId === order.id}
                    onClick={() => setSelectedOrderId(order.id === selectedOrderId ? null : order.id)}
                    stopNumber={idx + 1}
                  />
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}