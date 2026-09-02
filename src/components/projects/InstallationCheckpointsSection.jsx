import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, CheckCircle2, Circle, Camera, X, ChevronDown, ChevronRight, Clock } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { SignedImage, openSignedFile } from '@/lib/fileUrl';

const CATEGORIES = ['Pre-Install', 'In Progress', 'Post-Install'];

const statusColors = {
  Completed: 'bg-good/12 text-good border-good/25',
  Pending: 'bg-muted text-muted-foreground border-border',
  'N/A': 'bg-warn/12 text-warn border-warn/25'
};

export default function InstallationCheckpointsSection({ project, currentUser }) {
  const queryClient = useQueryClient();
  const projectId = project.id;
  const [expandedCategories, setExpandedCategories] = useState({ 'Pre-Install': true });
  const [savingId, setSavingId] = useState(null);
  const [uploadingId, setUploadingId] = useState(null);
  const [editingNotes, setEditingNotes] = useState({});

  const { data: templates = [], isLoading: templatesLoading } = useQuery({
    queryKey: ['checkpointTemplates'],
    queryFn: () => base44.entities.ProjectCheckpointTemplate.filter({ is_active: true })
  });

  const { data: checkpoints = [], isLoading: checkpointsLoading } = useQuery({
    queryKey: ['projectCheckpoints', projectId],
    queryFn: () => base44.entities.ProjectCheckpoint.filter({ project_id: projectId })
  });

  const getCheckpoint = (templateId) => checkpoints.find(c => c.template_id === templateId);

  const handleMarkStatus = async (template, newStatus) => {
    setSavingId(template.id);
    const existing = getCheckpoint(template.id);
    const isCompleting = newStatus === 'Completed';
    const data = {
      project_id: projectId,
      template_id: template.id,
      status: newStatus,
      notes: existing?.notes || editingNotes[template.id] || '',
      photo_urls: existing?.photo_urls || [],
      ...(isCompleting ? {
        completed_by_name: currentUser?.full_name || currentUser?.email || '',
        completed_by_email: currentUser?.email || '',
        completed_date: new Date().toISOString()
      } : {
        completed_by_name: '',
        completed_by_email: '',
        completed_date: null
      })
    };
    if (existing) {
      await base44.entities.ProjectCheckpoint.update(existing.id, data);
    } else {
      await base44.entities.ProjectCheckpoint.create(data);
    }
    queryClient.invalidateQueries({ queryKey: ['projectCheckpoints', projectId] });
    setSavingId(null);
  };

  const handleSaveNotes = async (template) => {
    const existing = getCheckpoint(template.id);
    const notes = editingNotes[template.id] ?? existing?.notes ?? '';
    if (existing) {
      await base44.entities.ProjectCheckpoint.update(existing.id, { notes });
    } else {
      await base44.entities.ProjectCheckpoint.create({
        project_id: projectId,
        template_id: template.id,
        status: 'Pending',
        notes,
        photo_urls: []
      });
    }
    queryClient.invalidateQueries({ queryKey: ['projectCheckpoints', projectId] });
    setEditingNotes(prev => { const n = { ...prev }; delete n[template.id]; return n; });
  };

  const handlePhotoUpload = async (template, files) => {
    if (!files.length) return;
    setUploadingId(template.id);
    const newUrls = await Promise.all(Array.from(files).map(async (file) => {
      const { file_url: fileUrl } = await base44.integrations.Core.UploadFile({ file });
      return fileUrl;
    }));
    const existing = getCheckpoint(template.id);
    const updatedPhotos = [...(existing?.photo_urls || []), ...newUrls];
    if (existing) {
      await base44.entities.ProjectCheckpoint.update(existing.id, { photo_urls: updatedPhotos });
    } else {
      await base44.entities.ProjectCheckpoint.create({
        project_id: projectId,
        template_id: template.id,
        status: 'Pending',
        notes: '',
        photo_urls: updatedPhotos
      });
    }
    queryClient.invalidateQueries({ queryKey: ['projectCheckpoints', projectId] });
    setUploadingId(null);
  };

  const handleDeletePhoto = async (template, photoIndex) => {
    const existing = getCheckpoint(template.id);
    if (!existing) return;
    const updatedPhotos = existing.photo_urls.filter((_, i) => i !== photoIndex);
    await base44.entities.ProjectCheckpoint.update(existing.id, { photo_urls: updatedPhotos });
    queryClient.invalidateQueries({ queryKey: ['projectCheckpoints', projectId] });
  };

  const toggleCategory = (cat) => {
    setExpandedCategories(prev => ({ ...prev, [cat]: !prev[cat] }));
  };

  if (templatesLoading || checkpointsLoading) {
    return (
      <div className="bg-white rounded-2xl border border-border p-6 md:col-span-2 flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 text-info animate-spin" />
      </div>
    );
  }

  if (templates.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-border p-6 md:col-span-2">
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4">Installation Checkpoints</h2>
        <p className="text-sm text-muted-foreground text-center py-6">
          No checkpoint templates configured yet. Add templates in the Settings to get started.
        </p>
      </div>
    );
  }

  const categorized = CATEGORIES.map(cat => ({
    cat,
    items: templates
      .filter(t => t.category === cat)
      .sort((a, b) => (a.order || 0) - (b.order || 0))
  })).filter(g => g.items.length > 0);

  const totalCount = templates.length;
  const completedCount = checkpoints.filter(c => c.status === 'Completed').length;

  return (
    <div className="bg-white rounded-2xl border border-border p-6 md:col-span-2">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Installation Checkpoints</h2>
          <p className="text-xs text-muted-foreground mt-0.5">{completedCount} of {totalCount} completed</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-2 w-32 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-good rounded-full transition-all"
              style={{ width: totalCount > 0 ? `${(completedCount / totalCount) * 100}%` : '0%' }}
            />
          </div>
          <span className="text-xs text-muted-foreground font-medium">{totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0}%</span>
        </div>
      </div>

      <div className="space-y-4">
        {categorized.map(({ cat, items }) => {
          const catCompleted = items.filter(t => getCheckpoint(t.id)?.status === 'Completed').length;
          const isExpanded = expandedCategories[cat];

          return (
            <div key={cat} className="border border-border rounded-xl overflow-hidden">
              <button
                onClick={() => toggleCategory(cat)}
                className="w-full flex items-center justify-between px-4 py-3 bg-muted hover:bg-muted transition-colors"
              >
                <div className="flex items-center gap-2">
                  {isExpanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                  <span className="font-semibold text-foreground text-sm">{cat}</span>
                  <span className="text-xs text-muted-foreground">({catCompleted}/{items.length})</span>
                </div>
                <div className="flex gap-1">
                  {items.map(t => {
                    const cp = getCheckpoint(t.id);
                    return (
                      <div
                        key={t.id}
                        className={cn('w-2.5 h-2.5 rounded-full border', cp?.status === 'Completed' ? 'bg-good border-good' : cp?.status === 'N/A' ? 'bg-warn border-warn' : 'bg-white border-border')}
                      />
                    );
                  })}
                </div>
              </button>

              {isExpanded && (
                <div className="divide-y divide-border">
                  {items.map(template => {
                    const cp = getCheckpoint(template.id);
                    const status = cp?.status || 'Pending';
                    const isSaving = savingId === template.id;
                    const isUploading = uploadingId === template.id;
                    const notesValue = editingNotes[template.id] !== undefined ? editingNotes[template.id] : (cp?.notes || '');
                    const notesChanged = editingNotes[template.id] !== undefined && editingNotes[template.id] !== (cp?.notes || '');

                    return (
                      <div key={template.id} className={cn('p-4 transition-colors', status === 'Completed' ? 'bg-good/12/40' : 'bg-white')}>
                        <div className="flex items-start gap-3">
                          <div className="flex-shrink-0 mt-0.5">
                            {status === 'Completed'
                              ? <CheckCircle2 className="w-5 h-5 text-good" />
                              : <Circle className="w-5 h-5 text-muted-foreground" />
                            }
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2 flex-wrap">
                              <div>
                                <p className={cn('font-medium text-sm', status === 'Completed' ? 'text-muted-foreground line-through decoration-green-500' : 'text-foreground')}>
                                  {template.name}
                                  {template.required_photos && <span className="ml-1 text-xs text-crit">*photo req.</span>}
                                </p>
                                {template.description && (
                                  <p className="text-xs text-muted-foreground mt-0.5">{template.description}</p>
                                )}
                              </div>
                              <Badge className={cn('border text-xs flex-shrink-0', statusColors[status])}>{status}</Badge>
                            </div>

                            {/* Completed timestamp */}
                            {status === 'Completed' && cp?.completed_date && (
                              <div className="flex items-center gap-1.5 mt-2 text-xs text-good bg-good/12 rounded-lg px-2 py-1 w-fit">
                                <Clock className="w-3 h-3" />
                                <span>
                                  Completed by <strong>{cp.completed_by_name || cp.completed_by_email}</strong> on{' '}
                                  {format(new Date(cp.completed_date), 'MMM d, yyyy')} at{' '}
                                  {format(new Date(cp.completed_date), 'h:mm a')}
                                </span>
                              </div>
                            )}

                            {/* Notes */}
                            <div className="mt-2 flex gap-2">
                              <textarea
                                value={notesValue}
                                onChange={e => setEditingNotes(prev => ({ ...prev, [template.id]: e.target.value }))}
                                placeholder="Add notes..."
                                rows={2}
                                className="flex-1 text-xs rounded-lg border border-border px-2 py-1.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-info/25 resize-none"
                              />
                              {notesChanged && (
                                <Button size="sm" variant="outline" onClick={() => handleSaveNotes(template)} className="text-xs h-auto">Save</Button>
                              )}
                            </div>

                            {/* Photos */}
                            {cp?.photo_urls?.length > 0 && (
                              <div className="flex flex-wrap gap-2 mt-2">
                                {cp.photo_urls.map((url, i) => (
                                  <div key={i} className="relative group">
                                    <SignedImage
                                      src={url}
                                      alt="checkpoint"
                                      className="w-16 h-16 object-cover rounded-lg border border-border cursor-pointer hover:opacity-90"
                                      onClick={() => openSignedFile(url)}
                                    />
                                    <button
                                      onClick={() => handleDeletePhoto(template, i)}
                                      className="absolute -top-1 -right-1 w-4 h-4 bg-crit rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                    >
                                      <X className="w-2.5 h-2.5 text-white" />
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}

                            {/* Action buttons */}
                            <div className="flex flex-wrap gap-2 mt-3">
                              {status !== 'Completed' && (
                                <Button
                                  size="sm"
                                  onClick={() => handleMarkStatus(template, 'Completed')}
                                  disabled={isSaving}
                                  className="bg-good hover:bg-good text-xs h-7"
                                >
                                  {isSaving ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <CheckCircle2 className="w-3 h-3 mr-1" />}
                                  Mark Complete
                                </Button>
                              )}
                              {status === 'Completed' && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleMarkStatus(template, 'Pending')}
                                  disabled={isSaving}
                                  className="border-border text-muted-foreground text-xs h-7"
                                >
                                  Undo
                                </Button>
                              )}
                              {status !== 'N/A' && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleMarkStatus(template, 'N/A')}
                                  disabled={isSaving}
                                  className="border-warn/25 text-warn text-xs h-7"
                                >
                                  N/A
                                </Button>
                              )}
                              <label className={cn('inline-flex items-center gap-1 px-2 py-1 rounded-md border text-xs cursor-pointer transition-colors h-7', isUploading ? 'border-info/25 text-info' : 'border-info/25 text-info hover:bg-info/12')}>
                                <input type="file" accept="image/*" multiple className="hidden" disabled={isUploading} onChange={e => { handlePhotoUpload(template, e.target.files); e.target.value = ''; }} />
                                {isUploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Camera className="w-3 h-3" />}
                                {isUploading ? 'Uploading...' : 'Add Photos'}
                              </label>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}