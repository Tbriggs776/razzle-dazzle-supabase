import React, { useState, useMemo, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polygon, useMap } from 'react-leaflet';
import { isSameDay, parseISO, format, addDays, subDays } from 'date-fns';
import { ChevronLeft, ChevronRight, MapPin, User, Hash, Navigation, Loader2, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import StatusPill from '@/components/common/StatusPill';
import L from 'leaflet';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
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

// Fix default marker icons — bundle them from the leaflet package (no cdnjs runtime dependency).
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
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

/* Map-canvas palette — deliberately NOT theme tokens.
   Everything below is painted onto the CARTO Voyager tile layer, which renders light in both
   light and dark mode (and onto Leaflet's own popup chrome, which is hard-coded white by
   leaflet.css). A theme token here would resolve to its dark-mode value — tuned for a dark
   ground that never appears under the map — and wash out. These stay fixed on purpose. */
const MAP_CANVAS = {
  regionFallback: '#4F46E5',   // region with no colour set
  orderFallback: '#94a3b8',    // order whose region has no colour
  orderSelected: '#4F46E5',    // currently selected pin
  orderOffDate: '#cbd5e1',     // assigned, but not on the selected date
  homeBase: '#1e293b',
  pinStroke: '#ffffff',
};

function createOrderIcon(color) {
  return L.divIcon({
    className: '',
    html: `<div style="width:14px;height:14px;border-radius:50%;background:${color};border:2.5px solid ${MAP_CANVAS.pinStroke};box-shadow:0 2px 6px rgba(0,0,0,0.35)"></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
}

const homeBaseIcon = L.divIcon({
  className: '',
  html: `<div style="width:22px;height:22px;border-radius:50%;background:${MAP_CANVAS.homeBase};border:3px solid ${MAP_CANVAS.pinStroke};box-shadow:0 2px 8px rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;font-size:11px;color:${MAP_CANVAS.pinStroke};line-height:1">🏠</div>`,
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

// order.status → StatusPill tone. assigned = scheduled (info), in_progress = in flight (warn),
// completed = done (good), anything else / unassigned = neutral.
const STATUS_TONE = {
  completed: 'good',
  in_progress: 'warn',
  assigned: 'info',
};

function JobCard({ order, region, isSelected, onClick, stopNumber }) {
  const { t } = useLanguage();
  const color = region?.color || MAP_CANVAS.orderFallback;
  const singleStopUrl = order.lat && order.lng
    ? `https://www.google.com/maps/dir/?api=1&origin=${HOME_BASE.lat},${HOME_BASE.lng}&destination=${order.lat},${order.lng}&travelmode=driving`
    : order.address
    ? `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(HOME_BASE.label)}&destination=${encodeURIComponent([order.address, order.city, order.state, order.zip_code].filter(Boolean).join(', '))}&travelmode=driving`
    : null;

  return (
    <div
      onClick={onClick}
      className={cn(
        "bg-card rounded-xl border shadow-sm overflow-hidden cursor-pointer transition-all",
        isSelected ? "border-primary ring-2 ring-primary/20 shadow-md" : "border-border hover:border-muted-foreground/30 hover:shadow-md"
      )}
    >
      <div className="h-1 w-full" style={{ backgroundColor: color }} />
      <div className="p-3">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex items-start gap-2 flex-1 min-w-0">
            {stopNumber != null && (
              // A stop with no coordinates is numbered on the board but is NOT in
              // the Google Maps route, so the driver would arrive at the end a job
              // short with nothing having said so. Mark it on the card.
              <span
                title={!order.lat || !order.lng ? 'Not in the route — this address could not be located' : undefined}
                className={cn(
                  "shrink-0 w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center mt-0.5",
                  (!order.lat || !order.lng)
                    ? "bg-warn/20 text-warn ring-1 ring-warn/40"
                    : "bg-primary text-primary-foreground"
                )}
              >
                {stopNumber}
              </span>
            )}
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-foreground text-sm leading-tight truncate">
                {order.customer_name || order.invoice_number || order.rfms_order_id}
              </p>
              <div className="flex items-center gap-1.5">
                {order.invoice_number && (
                  <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                    <Hash className="w-3 h-3 shrink-0" /> {order.invoice_number}
                  </p>
                )}
                {order.order_total > 0 && (
                  <span className="text-[11px] font-bold text-good bg-good/10 px-1.5 py-0.5 rounded-full">
                    ${order.order_total.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                  </span>
                )}
              </div>
            </div>
          </div>
          {region && (
            // Fill is the region's own colour (user data, arbitrary hex) — the label stays
            // literal white so it keeps contrast against whatever hue was chosen.
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
            <div className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
              <MapPin className="w-3 h-3 text-muted-foreground/70 shrink-0 mt-0.5" />
              <span className="truncate">{[order.address, order.city, order.zip_code].filter(Boolean).join(', ')}</span>
            </div>
          )}
          {order.preferred_installer_crew_name && (
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <User className="w-3 h-3 text-muted-foreground/70 shrink-0" />
              <span className="truncate">{order.preferred_installer_crew_name}</span>
            </div>
          )}
          {order.line_items?.length > 0 && (
            <div className="mt-1.5 pt-1.5 border-t border-border space-y-0.5">
              {order.line_items.filter(l => l.styleName).map((item, i) => {
                const categoryName = getProductCategoryName(item.productCode);
                return (
                <div key={i} className="text-[10px] text-muted-foreground flex items-start gap-1">
                  <span className="shrink-0 font-mono bg-muted text-muted-foreground px-1 rounded text-[9px]">{item.productCode || '—'}</span>
                  <span className="truncate">
                    {item.styleName}
                    {item.colorName ? <span className="text-muted-foreground/70"> · {item.colorName}</span> : null}
                  </span>
                  {categoryName && (
                    <span className="shrink-0 text-[9px] font-semibold text-primary bg-primary/10 px-1 rounded">{categoryName}</span>
                  )}
                  {item.quantity > 0 && (
                    <span className="ml-auto shrink-0 text-muted-foreground/70">{item.quantity}{item.unit ? ` ${item.unit}` : ''}</span>
                  )}
                </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="mt-2 flex items-center justify-between">
          <StatusPill tone={STATUS_TONE[order.status] || 'neutral'} className="px-2 text-[10px]">
            {order.status || 'unassigned'}
          </StatusPill>
          {singleStopUrl && (
            <a
              href={singleStopUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              className="flex items-center gap-1 text-[10px] text-primary hover:text-primary/80 hover:underline"
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

    // NOT marked attempted here. Doing that before the call meant one failed
    // geocode was never retried for the rest of the session — and invoke() never
    // throws, so the catch below could not see the failure either. The stop then
    // silently vanished from the route while the header still counted it.
    setGeocodingIds(prev => { const next = new Set(prev); missing.forEach(o => next.add(o.id)); return next; });

    Promise.all(missing.map(async (order) => {
      const fullAddr = [order.address, order.city, order.state, order.zip_code].filter(Boolean).join(', ');
      try {
        const res = await base44.functions.invoke('journeyGeocode', { address: fullAddr });
        if (res.data?.success && res.data.lat && res.data.lng) {
          await base44.entities.JourneyOrder.update(order.id, { lat: res.data.lat, lng: res.data.lng });
          // Only now is this address settled and not worth trying again.
          geocodedRef.current.add(order.id);
        }
      } catch (e) { /* a transient failure stays retryable */ }
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
      <div className="bg-card border-b border-border px-4 py-2.5 shrink-0 flex flex-wrap gap-3 items-center">
        <span className="text-sm font-bold text-foreground mr-1">{t('fiTitle')}</span>

        {/* Field Manager picker */}
        <div className="flex items-center gap-1.5">
          <User className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <select
            value={selectedMemberId}
            onChange={e => setSelectedMemberId(e.target.value)}
            className="text-sm border border-input rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-ring bg-background text-foreground"
          >
            {fieldManagers.length === 0 && <option value="">{t('fiNoFieldManagers')}</option>}
            {fieldManagers.map(m => (
              <option key={m.id} value={m.id}>{m.first_name} {m.last_name}</option>
            ))}
          </select>
        </div>

        {/* Date nav */}
        <div className="flex items-center gap-1 ml-auto">
          <button onClick={() => setSelectedDate(d => subDays(d, 1))} className="p-1 rounded hover:bg-muted/60">
            <ChevronLeft className="w-4 h-4 text-muted-foreground" />
          </button>
          <button
            onClick={() => setSelectedDate(new Date())}
            className={cn(
              "px-3 py-1 rounded-lg text-sm font-medium transition-colors",
              isToday ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted/60"
            )}
          >
            {format(selectedDate, 'MMM d, yyyy')}
          </button>
          <button onClick={() => setSelectedDate(d => addDays(d, 1))} className="p-1 rounded hover:bg-muted/60">
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          </button>
          {!isToday && (
          <button onClick={() => setSelectedDate(new Date())} className="ml-1 text-xs text-primary hover:underline">
            {t('fiToday')}
          </button>
          )}
          </div>

          {/* Job count — a quantity, not a status, so it stays a plain token-styled chip
              rather than a StatusPill (which would uppercase the translated string). */}
          <span className="bg-primary/10 text-primary text-xs font-bold rounded-full px-2.5 py-0.5 shrink-0">
          {t('fiJobsCount', { count: ordersForDay.length })}
          </span>
          {geocodingIds.size > 0 && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Loader2 className="w-3 h-3 animate-spin" />
          {t('fiGeocoding', { count: geocodingIds.size })}
          </span>
          )}
          {fullRouteUrl && (
          <a
          href={fullRouteUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 px-3 py-1.5 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold rounded-lg transition-colors shrink-0"
          >
          <Navigation className="w-3.5 h-3.5" />
          {mappableOrders.length < routedOrders.length
            ? `${t('fiFullRoute')} (${mappableOrders.length} of ${routedOrders.length})`
            : t('fiFullRoute')}
          <ExternalLink className="w-3 h-3 opacity-70" />
          </a>
          )}
      </div>

      {/* Main split: map left, cards right — stacked on a phone, where a 288px card rail
          beside the map would leave the map a sliver. */}
      <div className="flex flex-col lg:flex-row flex-1 min-h-0">

        {/* Map */}
        <div className="flex-1 relative min-h-[15rem] lg:min-h-0">
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
                    color: region.color || MAP_CANVAS.regionFallback,
                    fillColor: region.color || MAP_CANVAS.regionFallback,
                    fillOpacity: 0.1,
                    weight: 2,
                  }}
                />
              ) : null
            )}

            {/* Home base marker */}
            {/* Leaflet paints its own popup chrome (.leaflet-popup-content-wrapper) an
                unconditional white from leaflet.css, and nothing in the app overrides it.
                Every <Popup> body below therefore keeps fixed colour classes — a theme token
                would resolve to its dark-mode value and go light-on-white. Same reasoning as
                the MAP_CANVAS note at the top of this file. */}
            <Marker position={[HOME_BASE.lat, HOME_BASE.lng]} icon={homeBaseIcon}>
              <Popup>
                <div className="text-sm font-semibold">{t('fiHomeBase')}</div>
                <div className="text-xs text-gray-500 mt-0.5">{HOME_BASE.label}</div>
              </Popup>
            </Marker>

            {/* All assigned orders (dimmed if not on selected date) */}
            {allMappableOrders.map(order => {
              const region = regions.find(r => r.id === order.region_assignment_id);
              const color = region?.color || MAP_CANVAS.orderFallback;
              const isSelected = selectedOrderId === order.id;
              const stopIdx = routedOrders.findIndex(o => o.id === order.id);
              const isOnSelectedDate = stopIdx !== -1;
              const markerColor = isSelected ? MAP_CANVAS.orderSelected : isOnSelectedDate ? color : MAP_CANVAS.orderOffDate;
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
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-card/90 backdrop-blur-sm border border-border rounded-xl shadow px-4 py-2 text-xs text-muted-foreground z-[1000]">
              {t('fiNoGeoData')}
            </div>
          )}
        </div>

        {/* Right panel: job cards */}
        <div className="w-full lg:w-72 flex-1 lg:flex-none shrink-0 min-h-0 border-t lg:border-t-0 lg:border-l border-border bg-muted/40 flex flex-col overflow-hidden">
          {/* Region tags */}
          {myRegions.length > 0 && (
            <div className="px-3 py-2 border-b border-border flex flex-wrap gap-1.5 bg-card">
              {myRegions.map(r => (
                <div key={r.id} className="flex items-center gap-1 text-[10px] text-muted-foreground bg-muted border border-border rounded-full px-2 py-0.5">
                  {/* Dot is the region's own colour from user data, not a theme token. */}
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: r.color || MAP_CANVAS.orderFallback }} />
                  {r.region_name}
                </div>
              ))}
            </div>
          )}

          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {selectedMemberId === '' ? (
              <p className="text-xs text-muted-foreground text-center mt-8">{t('fiNoFieldManagersRegions')}</p>
            ) : ordersForDay.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center mt-8">{t('fiNoJobsDate')}</p>
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