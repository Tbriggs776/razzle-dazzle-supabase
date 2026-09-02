import React, { useEffect, useRef, useState, useMemo } from 'react';
import { MapContainer, TileLayer, Polygon, Marker, Popup, useMap } from 'react-leaflet';
import { ChevronDown, ChevronUp, CalendarDays } from 'lucide-react';
import { isSameDay, parseISO } from 'date-fns';
import L from 'leaflet';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
import 'leaflet/dist/leaflet.css';
import 'leaflet-draw/dist/leaflet.draw.css';
import 'leaflet-draw';

// Fix leaflet-draw strict mode bug with undeclared 'type' variable
if (window.L && window.L.GeometryUtil) {
  const origReadableArea = window.L.GeometryUtil.readableArea;
  window.L.GeometryUtil.readableArea = function(area, isMetric, precision) {
    let areaStr;
    let units;
    if (isMetric) {
      units = ['ha', 'm'];
      precision = precision || { km: 2, ha: 2, m: 0 };
      if (area >= 1000000) {
        areaStr = (area * 0.000001).toFixed(precision['km']) + ' km²';
      } else if (area >= 10000) {
        areaStr = (area * 0.0001).toFixed(precision['ha']) + ' ' + units[0];
      } else {
        areaStr = area.toFixed(precision['m']) + ' ' + units[1] + '²';
      }
    } else {
      units = ['ac', 'ft'];
      area /= 0.836127;
      if (area >= 3097600) {
        areaStr = (area / 3097600).toFixed(2) + ' mi²';
      } else if (area >= 4840) {
        areaStr = (area / 4840).toFixed(2) + ' ' + units[0];
      } else {
        areaStr = Math.ceil(area) + ' ' + units[1] + '²';
      }
    }
    return areaStr;
  };
}

// Fix default marker icons — bundle them from the leaflet package (no cdnjs runtime dependency).
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

// Map-geometry palette. These are Leaflet path/marker colours painted onto an always-light
// CARTO basemap and persisted on the region record, so they stay literal hex rather than
// theme tokens — a token would resolve differently per theme and no longer match saved data.
const REGION_COLORS = [
  '#4F46E5', '#0EA5E9', '#10B981', '#F59E0B', '#EF4444',
  '#8B5CF6', '#EC4899', '#14B8A6', '#F97316', '#6366F1'
];

function DrawControl({ onPolygonDrawn, editingColor }) {
  const map = useMap();
  const drawControlRef = useRef(null);
  const drawnItemsRef = useRef(null);

  useEffect(() => {
    if (!map) return;

    // Patch leaflet-draw strict mode bug (undeclared 'type' variable in readableArea)
    if (L.GeometryUtil) {
      L.GeometryUtil.readableArea = function(area, isMetric, precision) {
        let areaStr;
        if (isMetric) {
          const p = precision || { km: 2, ha: 2, m: 0 };
          if (area >= 1000000) areaStr = (area * 0.000001).toFixed(p['km']) + ' km²';
          else if (area >= 10000) areaStr = (area * 0.0001).toFixed(p['ha']) + ' ha';
          else areaStr = area.toFixed(p['m']) + ' m²';
        } else {
          const a = area / 0.836127;
          if (a >= 3097600) areaStr = (a / 3097600).toFixed(2) + ' mi²';
          else if (a >= 4840) areaStr = (a / 4840).toFixed(2) + ' ac';
          else areaStr = Math.ceil(a) + ' ft²';
        }
        return areaStr;
      };
    }

    const drawnItems = new L.FeatureGroup();
    map.addLayer(drawnItems);
    drawnItemsRef.current = drawnItems;

    const drawControl = new L.Control.Draw({
      draw: {
        polygon: {
          shapeOptions: { color: editingColor || '#4F46E5', fillOpacity: 0.2 },
          allowIntersection: false,
          showArea: true,
        },
        polyline: false,
        circle: false,
        rectangle: false,
        marker: false,
        circlemarker: false,
      },
      edit: { featureGroup: drawnItems },
    });

    map.addControl(drawControl);
    drawControlRef.current = drawControl;

    map.on(L.Draw.Event.CREATED, (e) => {
      const layer = e.layer;
      drawnItems.addLayer(layer);
      const coords = layer.getLatLngs()[0].map(ll => [ll.lat, ll.lng]);
      onPolygonDrawn(coords);
    });

    return () => {
      map.removeControl(drawControl);
      map.removeLayer(drawnItems);
      map.off(L.Draw.Event.CREATED);
    };
  }, [map, editingColor]);

  return null;
}

function TodaysJobsPanel({ journeyOrders, regions }) {
  const [open, setOpen] = useState(false);
  const today = new Date();

  const todaysOrders = useMemo(() =>
    journeyOrders.filter(jo => {
      if (!jo.install_date) return false;
      try { return isSameDay(parseISO(jo.install_date), today); } catch { return false; }
    }),
    [journeyOrders]
  );

  // Group by region
  const grouped = useMemo(() => {
    const map = {};
    todaysOrders.forEach(jo => {
      const key = jo.region_assignment_id || '__none__';
      if (!map[key]) map[key] = { region: regions.find(r => r.id === key) || null, orders: [] };
      map[key].orders.push(jo);
    });
    return Object.values(map);
  }, [todaysOrders, regions]);

  return (
    <div className="absolute bottom-6 left-4 z-[1000] w-64 bg-card text-card-foreground rounded-xl shadow-xl border border-border overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-muted/60 transition-colors"
      >
        <CalendarDays className="w-4 h-4 text-primary shrink-0" />
        <span className="text-xs font-bold text-foreground flex-1 text-left">
          Today's Jobs
        </span>
        {/* Count chip, not a status — an accent-tinted counter, so a token swap rather than a StatusPill. */}
        <span className="bg-primary/10 text-primary text-xs font-bold rounded-full px-2 py-0.5 shrink-0">
          {todaysOrders.length}
        </span>
        {open ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/70 shrink-0" /> : <ChevronUp className="w-3.5 h-3.5 text-muted-foreground/70 shrink-0" />}
      </button>

      {open && (
        <div className="border-t border-border max-h-72 overflow-y-auto">
          {todaysOrders.length === 0 ? (
            <p className="text-[11px] text-muted-foreground text-center py-4 italic">No jobs scheduled today</p>
          ) : (
            grouped.map((group, gi) => {
              // Region swatch colour comes from the saved region record (same literal hex the
              // map polygons use); the unassigned fallback matches the map's grey marker.
              const color = group.region?.color || '#94a3b8';
              const name = group.region?.region_name || 'No Region';
              return (
                <div key={gi} className="px-3 py-2 border-b border-border/60 last:border-b-0">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                    <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">{name}</span>
                    <span className="ml-auto text-[10px] text-muted-foreground/70">{group.orders.length}</span>
                  </div>
                  {group.orders.map(jo => (
                    <div key={jo.id} className="flex items-start gap-2 py-1">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-foreground truncate">{jo.customer_name || jo.invoice_number || jo.rfms_order_id}</p>
                        {jo.zip_code && <p className="text-[10px] text-muted-foreground truncate">{jo.zip_code}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

export default function RegionMapEditor({ regions, journeyOrders, onPolygonDrawn, drawingRegion }) {
  const AZ_CENTER = [33.4484, -112.0740];

  const getRegionColor = (region, idx) => region.color || REGION_COLORS[idx % REGION_COLORS.length];

  const getOrderColor = (order) => {
    if (!order.region_assignment_id) return '#94A3B8';
    const region = regions.find(r => r.id === order.region_assignment_id);
    return region?.color || '#94A3B8';
  };

  // Marker glyph is drawn straight into Leaflet's own DOM (no Tailwind class context) and sits
  // on the always-light basemap, so the white ring stays a literal colour in both themes.
  const createOrderIcon = (color) => L.divIcon({
    className: '',
    html: `<div style="width:12px;height:12px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.4)"></div>`,
    iconSize: [12, 12],
    iconAnchor: [6, 6],
  });

  return (
    <div className="relative w-full h-full">
    <TodaysJobsPanel journeyOrders={journeyOrders} regions={regions} />
    <MapContainer
      center={AZ_CENTER}
      zoom={9}
      style={{ height: '100%', width: '100%', borderRadius: '12px' }}
    >
      <TileLayer
        attribution='&copy; <a href="https://carto.com/attributions">CARTO</a>'
        url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
        subdomains="abcd"
        maxZoom={19}
      />

      {/* NOTE ON POPUP TYPE: <Popup> content is portalled into Leaflet's own
          .leaflet-popup-content-wrapper, which leaflet.css hard-codes to a white background
          (the project adds no dark override). Theme tokens there would render light-on-white
          in dark mode, so popup text deliberately keeps fixed light-surface colours. */}

      {/* Render saved regions */}
      {regions.map((region, idx) =>
        region.polygon_coordinates?.length > 0 ? (
          <Polygon
            key={region.id}
            positions={region.polygon_coordinates}
            pathOptions={{
              color: getRegionColor(region, idx),
              fillColor: getRegionColor(region, idx),
              fillOpacity: 0.15,
              weight: 2,
            }}
          >
            <Popup>
              <div className="text-sm font-semibold">{region.region_name}</div>
              <div className="text-xs text-muted-foreground mt-1">
                {region.zip_codes?.length || 0} ZIP codes
              </div>
            </Popup>
          </Polygon>
        ) : null
      )}

      {/* Render order markers */}
      {journeyOrders
        .filter(o => o.lat && o.lng)
        .map((order) => (
          <Marker
            key={order.id}
            position={[order.lat, order.lng]}
            icon={createOrderIcon(getOrderColor(order))}
          >
            <Popup>
              <div className="text-sm font-semibold">{order.customer_name}</div>
              <div className="text-xs text-muted-foreground">{order.address}</div>
              {order.region_name && (
                <div className="text-xs font-medium text-info mt-1">{order.region_name}</div>
              )}
            </Popup>
          </Marker>
        ))}

      {/* Draw control when creating/editing a region */}
      {drawingRegion && (
        <DrawControl
          onPolygonDrawn={onPolygonDrawn}
          editingColor={drawingRegion.color || '#4F46E5'}
        />
      )}
    </MapContainer>
    </div>
  );
}