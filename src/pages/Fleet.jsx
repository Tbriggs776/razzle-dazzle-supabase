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
      color: 'bg-brand-blue'
    },
    {
      title: 'Drivers',
      icon: Users,
      count: drivers.length,
      sub: `${drivers.filter(d => d.status === 'active').length} active`,
      href: 'FleetDrivers',
      color: 'bg-primary'
    },
    {
      title: 'Maintenance',
      icon: Wrench,
      count: upcomingMaintenance.length,
      sub: 'upcoming / overdue',
      href: 'FleetMaintenance',
      color: 'bg-brand-pink'
    }
  ];

  return (
    <div className="min-h-screen bg-background">
      <div className="bg-card border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-primary flex items-center justify-center">
              <Truck className="w-6 h-6 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-foreground">Fleet Management</h1>
              <p className="text-muted-foreground mt-0.5">Manage your vehicles, drivers, and maintenance</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {cards.map(card => {
            const Icon = card.icon;
            return (
              <Link key={card.title} to={createPageUrl(card.href)} className="block group">
                <div className="bg-card rounded-2xl border border-border p-6 hover:shadow-lg hover:border-primary/30 transition-all">
                  <div className={`w-12 h-12 rounded-xl ${card.color} flex items-center justify-center mb-4`}>
                    <Icon className="w-6 h-6 text-white" />
                  </div>
                  <p className="text-3xl font-bold text-foreground">{card.count}</p>
                  <p className="text-lg font-semibold text-foreground mt-1">{card.title}</p>
                  <p className="text-sm text-muted-foreground mt-0.5">{card.sub}</p>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}