import React from 'react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Truck, Users, Wrench, Car } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';

export default function Fleet() {
  const { data: vehicles = [] } = useQuery({
    queryKey: ['fleetVehicles'],
    queryFn: () => base44.entities.FleetVehicle.list()
  });

  const { data: drivers = [] } = useQuery({
    queryKey: ['fleetDrivers'],
    queryFn: () => base44.entities.FleetDriver.list()
  });

  const { data: maintenance = [] } = useQuery({
    queryKey: ['fleetMaintenance'],
    queryFn: () => base44.entities.FleetMaintenance.list()
  });

  const upcomingMaintenance = maintenance.filter(m => m.status === 'scheduled' || m.status === 'overdue');

  const cards = [
    {
      title: 'Vehicles',
      icon: Car,
      count: vehicles.length,
      sub: `${vehicles.filter(v => v.status === 'active').length} active`,
      href: 'FleetVehicles',
      color: 'from-blue-500 to-blue-600'
    },
    {
      title: 'Drivers',
      icon: Users,
      count: drivers.length,
      sub: `${drivers.filter(d => d.status === 'active').length} active`,
      href: 'FleetDrivers',
      color: 'from-indigo-500 to-indigo-600'
    },
    {
      title: 'Maintenance',
      icon: Wrench,
      count: upcomingMaintenance.length,
      sub: 'upcoming / overdue',
      href: 'FleetMaintenance',
      color: 'from-orange-500 to-orange-600'
    }
  ];

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-100">
        <div className="max-w-5xl mx-auto px-6 py-8">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
              <Truck className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-slate-800">Fleet Management</h1>
              <p className="text-slate-500 mt-0.5">Manage your vehicles, drivers, and maintenance</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {cards.map(card => {
            const Icon = card.icon;
            return (
              <Link key={card.title} to={createPageUrl(card.href)} className="block group">
                <div className="bg-white rounded-2xl border border-slate-100 p-6 hover:shadow-lg hover:border-indigo-200 transition-all">
                  <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${card.color} flex items-center justify-center mb-4`}>
                    <Icon className="w-6 h-6 text-white" />
                  </div>
                  <p className="text-3xl font-bold text-slate-800">{card.count}</p>
                  <p className="text-lg font-semibold text-slate-700 mt-1">{card.title}</p>
                  <p className="text-sm text-slate-500 mt-0.5">{card.sub}</p>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}