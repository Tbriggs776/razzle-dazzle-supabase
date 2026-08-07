import React from 'react';
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from 'lucide-react';

const statusSteps = ['Accepted', 'Scheduled', 'Materials Ordered', 'In Progress', 'Quality Checks', 'Completed'];

export default function ProjectDialogs({
  showAssignDialog, setShowAssignDialog,
  showEditDialog, setShowEditDialog,
  showRescheduleDialog, setShowRescheduleDialog,
  showSetInstallationDialog, setShowSetInstallationDialog,
  showDeleteDialog, setShowDeleteDialog,
  allTeamMembers,
  assignData, setAssignData,
  editData, setEditData,
  installationDateData, setInstallationDateData,
  installationDateStatusData, setInstallationDateStatusData,
  handleAssignSubmit,
  handleEditSubmit,
  handleRescheduleSubmit,
  handleSetInstallationSubmit,
  onDeleteConfirm,
  updateProjectMutation,
  deleteProjectMutation
}) {
  return (
    <>
      {/* Assign Team Dialog */}
      <Dialog open={showAssignDialog} onOpenChange={setShowAssignDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Assign Team Members</DialogTitle>
            <DialogDescription>Assign project and installation managers to this project</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Project Manager</Label>
              <Select value={assignData.project_manager} onValueChange={(v) => setAssignData({ ...assignData, project_manager: v })}>
                <SelectTrigger><SelectValue placeholder="Select project manager..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={null}>None</SelectItem>
                  {allTeamMembers.map(m => <SelectItem key={m.id} value={m.id}>{m.first_name} {m.last_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Installation Manager</Label>
              <Select value={assignData.installation_manager} onValueChange={(v) => setAssignData({ ...assignData, installation_manager: v })}>
                <SelectTrigger><SelectValue placeholder="Select installation manager..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={null}>None</SelectItem>
                  {allTeamMembers.map(m => <SelectItem key={m.id} value={m.id}>{m.first_name} {m.last_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAssignDialog(false)}>Cancel</Button>
            <Button onClick={handleAssignSubmit} disabled={updateProjectMutation.isPending} className="bg-indigo-600 hover:bg-indigo-700">
              {updateProjectMutation.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving...</> : 'Assign Team'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Project</DialogTitle>
            <DialogDescription>Update project status, dates, and notes</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={editData.status} onValueChange={(v) => setEditData({ ...editData, status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{statusSteps.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Installation Date</Label>
              <Input type="date" value={editData.installation_date} onChange={(e) => setEditData({ ...editData, installation_date: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Scheduled Start</Label><Input type="date" value={editData.scheduled_start_date} onChange={(e) => setEditData({ ...editData, scheduled_start_date: e.target.value })} /></div>
              <div className="space-y-2"><Label>Scheduled End</Label><Input type="date" value={editData.scheduled_end_date} onChange={(e) => setEditData({ ...editData, scheduled_end_date: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Actual Start</Label><Input type="date" value={editData.actual_start_date} onChange={(e) => setEditData({ ...editData, actual_start_date: e.target.value })} /></div>
              <div className="space-y-2"><Label>Actual Completion</Label><Input type="date" value={editData.actual_completion_date} onChange={(e) => setEditData({ ...editData, actual_completion_date: e.target.value })} /></div>
            </div>
            <div className="space-y-2"><Label>Project Notes</Label><Textarea placeholder="Add project notes..." value={editData.project_notes} onChange={(e) => setEditData({ ...editData, project_notes: e.target.value })} rows={3} /></div>
            <div className="space-y-2"><Label>Materials Notes</Label><Textarea placeholder="Add materials notes..." value={editData.materials_notes} onChange={(e) => setEditData({ ...editData, materials_notes: e.target.value })} rows={3} /></div>
            <div className="space-y-2"><Label>Quality Check Notes</Label><Textarea placeholder="Add quality check notes..." value={editData.quality_check_notes} onChange={(e) => setEditData({ ...editData, quality_check_notes: e.target.value })} rows={3} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditDialog(false)}>Cancel</Button>
            <Button onClick={handleEditSubmit} disabled={updateProjectMutation.isPending} className="bg-indigo-600 hover:bg-indigo-700">
              {updateProjectMutation.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving...</> : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reschedule Dialog */}
      <Dialog open={showRescheduleDialog} onOpenChange={setShowRescheduleDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reschedule Installation</DialogTitle>
            <DialogDescription>Update the installation date and status for this project</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Installation Date</Label>
              <Input type="date" value={editData.installation_date} onChange={(e) => setEditData({ ...editData, installation_date: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={installationDateStatusData} onValueChange={setInstallationDateStatusData}>
                <SelectTrigger><SelectValue placeholder="Select status (optional)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={null}>None</SelectItem>
                  <SelectItem value="pending payment">Pending Payment</SelectItem>
                  <SelectItem value="pending contract">Pending Contract</SelectItem>
                  <SelectItem value="on hold">On Hold</SelectItem>
                  <SelectItem value="pending cancellation">Pending Cancellation</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRescheduleDialog(false)}>Cancel</Button>
            <Button onClick={handleRescheduleSubmit} disabled={updateProjectMutation.isPending} className="bg-yellow-600 hover:bg-yellow-700">
              {updateProjectMutation.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving...</> : 'Update Date'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Set Installation Date Dialog */}
      <Dialog open={showSetInstallationDialog} onOpenChange={setShowSetInstallationDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Set Installation Date</DialogTitle>
            <DialogDescription>Choose the installation date and status for this project</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Installation Date</Label>
              <Input type="date" value={installationDateData} onChange={(e) => setInstallationDateData(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={installationDateStatusData} onValueChange={setInstallationDateStatusData}>
                <SelectTrigger><SelectValue placeholder="Select status (optional)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={null}>None</SelectItem>
                  <SelectItem value="pending payment">Pending Payment</SelectItem>
                  <SelectItem value="pending contract">Pending Contract</SelectItem>
                  <SelectItem value="on hold">On Hold</SelectItem>
                  <SelectItem value="pending cancellation">Pending Cancellation</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSetInstallationDialog(false)}>Cancel</Button>
            <Button onClick={handleSetInstallationSubmit} disabled={updateProjectMutation.isPending} className="bg-blue-600 hover:bg-blue-700">
              {updateProjectMutation.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving...</> : 'Set Date'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Project</DialogTitle>
            <DialogDescription>Are you sure you want to delete this project? This action cannot be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>Cancel</Button>
            <Button onClick={onDeleteConfirm} disabled={deleteProjectMutation.isPending} className="bg-red-600 hover:bg-red-700">
              {deleteProjectMutation.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Deleting...</> : 'Delete Project'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}