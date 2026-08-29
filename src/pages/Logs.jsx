import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { AlertCircle, AlertTriangle, Info, Bug, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

const logTypeIcons = {
  'calendar_sync': '📅',
  'appointment': '📋',
  'sms': '💬',
  'system': '⚙️'
};

const levelColors = {
  'error': 'bg-red-100 text-red-800 border-red-200 dark:bg-red-500/15 dark:text-red-300 dark:border-red-500/25',
  'warning': 'bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-500/15 dark:text-yellow-300 dark:border-yellow-500/25',
  'info': 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/25',
  'debug': 'bg-slate-100 text-slate-800 border-slate-200 dark:bg-slate-500/15 dark:text-slate-300 dark:border-slate-500/25'
};

const levelIcons = {
  'error': <AlertCircle className="w-4 h-4" />,
  'warning': <AlertTriangle className="w-4 h-4" />,
  'info': <Info className="w-4 h-4" />,
  'debug': <Bug className="w-4 h-4" />
};

export default function Logs() {
  const [filterType, setFilterType] = useState('');
  const [filterLevel, setFilterLevel] = useState('');
  const [searchFunction, setSearchFunction] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const { data: logs = [], isLoading } = useQuery({
    queryKey: ['logs', filterType, filterLevel, searchFunction],
    staleTime: 0,
    queryFn: async () => {
      try {
        const allLogs = await base44.entities.Log.list();
        console.log('Fetched logs:', allLogs.length, 'logs');
        
        let filtered = allLogs;
        
        // Apply type filter
        if (filterType) {
          console.log('Filtering by type:', filterType);
          filtered = filtered.filter(log => log.type === filterType);
        }
        
        // Apply level filter
        if (filterLevel) {
          console.log('Filtering by level:', filterLevel);
          filtered = filtered.filter(log => log.level === filterLevel);
        }
        
        // Apply function name search
        if (searchFunction) {
          console.log('Searching by function:', searchFunction);
          filtered = filtered.filter(log => 
            log.function_name?.toLowerCase().includes(searchFunction.toLowerCase())
          );
        }

        console.log('Final filtered logs:', filtered.length);
        return filtered.sort((a, b) => new Date(b.created_date) - new Date(a.created_date));
      } catch (error) {
        console.error('Error fetching logs:', error);
        return [];
      }
    }
  });

  // Only admins can view logs
  if (currentUser && currentUser.role !== 'admin') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4 sm:p-6 lg:p-8">
        <div className="bg-card rounded-2xl border border-border p-8 text-center max-w-md">
          <AlertCircle className="w-16 h-16 text-destructive mx-auto mb-4" />
          <h2 className="text-xl font-bold text-foreground mb-2">Access Denied</h2>
          <p className="text-muted-foreground">Only administrators can view system logs.</p>
        </div>
      </div>
    );
  }

  // Pagination calculations
  const totalPages = Math.ceil(logs.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedLogs = logs.slice(startIndex, endIndex);



  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-card border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex items-center gap-4 mb-6">
            <div className="w-12 h-12 rounded-2xl bg-primary text-primary-foreground flex items-center justify-center text-xl">
              📊
            </div>
            <div>
              <h1 className="text-3xl font-bold text-foreground">System Logs</h1>
              <p className="text-sm text-muted-foreground mt-1">Monitor calendar sync and system events</p>
            </div>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap gap-3">
            <Input
              placeholder="Search by function name..."
              value={searchFunction}
              onChange={(e) => setSearchFunction(e.target.value)}
              className="h-10 border-border w-full sm:max-w-xs"
            />
            <Select value={filterType} onValueChange={setFilterType}>
              <SelectTrigger className="h-10 w-full sm:w-48 border-border">
                <SelectValue placeholder="Filter by type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={null}>All Types</SelectItem>
                <SelectItem value="calendar_sync">Calendar Sync</SelectItem>
                <SelectItem value="appointment">Appointment</SelectItem>
                <SelectItem value="sms">SMS</SelectItem>
                <SelectItem value="system">System</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterLevel} onValueChange={setFilterLevel}>
              <SelectTrigger className="h-10 w-full sm:w-40 border-border">
                <SelectValue placeholder="Filter by level" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={null}>All Levels</SelectItem>
                <SelectItem value="error">Error</SelectItem>
                <SelectItem value="warning">Warning</SelectItem>
                <SelectItem value="info">Info</SelectItem>
                <SelectItem value="debug">Debug</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              onClick={() => {
                setFilterType('');
                setFilterLevel('');
                setSearchFunction('');
              }}
              className="h-10 border-border"
            >
              Clear Filters
            </Button>
            <div className="flex items-center gap-2 ml-auto">
              <span className="text-sm text-muted-foreground">Per page:</span>
              <Select value={itemsPerPage.toString()} onValueChange={(val) => {
                setItemsPerPage(Number(val));
                setCurrentPage(1);
              }}>
                <SelectTrigger className="h-10 w-24 border-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">10</SelectItem>
                  <SelectItem value="25">25</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
          </div>
        ) : logs.length === 0 ? (
          <div className="bg-card rounded-2xl border border-border p-12 text-center">
            <p className="text-muted-foreground">No logs found matching your filters.</p>
          </div>
        ) : (
          <>
            <div className="space-y-3">
              {paginatedLogs.map((log) => (
              <Card key={log.id} className={cn('p-4 border', levelColors[log.level] || levelColors.info)}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-4 flex-1 min-w-0">
                    <div className="flex-shrink-0 mt-1">
                      {levelIcons[log.level] || levelIcons.info}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-2">
                        <span className="text-sm font-semibold">{log.function_name}</span>
                        <Badge variant="outline" className="text-xs">
                          {logTypeIcons[log.type]} {log.type}
                        </Badge>
                        <Badge variant="outline" className="text-xs capitalize">
                          {log.level}
                        </Badge>
                      </div>
                      <p className="text-sm font-medium mb-2">{log.message}</p>
                      {log.error_message && (
                        <p className="text-sm text-red-700 dark:text-red-300 mb-2">Error: {log.error_message}</p>
                      )}
                      {log.appointment_id && (
                        <p className="text-xs text-muted-foreground mb-2">Appointment: {log.appointment_id}</p>
                      )}
                      {log.details && (
                        <details className="text-xs text-muted-foreground cursor-pointer">
                          <summary className="hover:text-foreground">View Details</summary>
                          <pre className="mt-2 p-2 bg-muted rounded overflow-auto max-h-32">
                            {JSON.stringify(log.details, null, 2)}
                          </pre>
                        </details>
                      )}
                    </div>
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <p className="text-xs text-muted-foreground whitespace-nowrap">
                      {format(new Date(log.created_date), 'MMM d, yyyy h:mm a')}
                    </p>
                  </div>
                </div>
              </Card>
              ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between flex-wrap gap-3 mt-6 p-4 bg-card rounded-lg border border-border">
                <div className="text-sm text-muted-foreground">
                  Showing {startIndex + 1} to {Math.min(endIndex, logs.length)} of {logs.length} logs
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                    disabled={currentPage === 1}
                    className="border-border"
                  >
                    Previous
                  </Button>
                  <div className="flex items-center gap-1 flex-wrap">
                    {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                      <Button
                        key={page}
                        variant={currentPage === page ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setCurrentPage(page)}
                        className={currentPage === page ? 'bg-primary text-primary-foreground hover:opacity-90' : 'border-border'}
                      >
                        {page}
                      </Button>
                    ))}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                    disabled={currentPage === totalPages}
                    className="border-border"
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}