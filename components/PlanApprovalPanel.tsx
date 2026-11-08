"use client";

import { useState, useCallback } from "react";

export interface ApprovalInfo {
  planId: string;
  status: "draft" | "computed" | "pending_approval" | "approved" | "rejected";
  authorId: string;
  authorName: string;
  requiredApproverKind: "tcs" | "pe" | "knowledgeable_official";
  requiresPeStamp: boolean;
  disclaimer: string;
  approverName?: string;
  approverCredential?: string;
  approvalDate?: string;
  rejectionReason?: string;
}

export interface PlanApprovalPanelProps {
  approval: ApprovalInfo;
  currentUserId: string;
  currentUserRole: "planner" | "tcs_approver" | "engineer_approver";
  currentUserCredential?: {
    id: string;
    kind: "tcs" | "pe";
    identifier: string;
  };
  onSubmit: (planId: string) => Promise<void>;
  onApprove: (planId: string, credentialId: string, attestation: string, comments?: string) => Promise<void>;
  onReject: (planId: string, credentialId: string, reason: string) => Promise<void>;
}

export default function PlanApprovalPanel({
  approval,
  currentUserId,
  currentUserRole,
  currentUserCredential,
  onSubmit,
  onApprove,
  onReject,
}: PlanApprovalPanelProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [showApprovalForm, setShowApprovalForm] = useState(false);
  const [attestation, setAttestation] = useState("");
  const [comments, setComments] = useState("");
  const [rejectionReason, setRejectionReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const isAuthor = currentUserId === approval.authorId;
  const canSubmit = isAuthor && approval.status === "computed";
  const canApprove = 
    !isAuthor && 
    approval.status === "pending_approval" &&
    ["tcs_approver", "engineer_approver"].includes(currentUserRole) &&
    currentUserCredential;
  
  const needsPeCredential = approval.requiredApproverKind === "pe";
  const hasCorrectCredential = 
    currentUserCredential && 
    (approval.requiredApproverKind !== "pe" || currentUserCredential.kind === "pe");

  const handleSubmit = useCallback(async () => {
    setIsSubmitting(true);
    setError(null);
    try {
      await onSubmit(approval.planId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit");
    } finally {
      setIsSubmitting(false);
    }
  }, [approval.planId, onSubmit]);

  const handleApprove = useCallback(async () => {
    if (!currentUserCredential || !attestation.trim()) {
      setError("Please provide attestation text");
      return;
    }
    
    setIsApproving(true);
    setError(null);
    try {
      await onApprove(approval.planId, currentUserCredential.id, attestation, comments || undefined);
      setShowApprovalForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to approve");
    } finally {
      setIsApproving(false);
    }
  }, [approval.planId, currentUserCredential, attestation, comments, onApprove]);

  const handleReject = useCallback(async () => {
    if (!currentUserCredential || !rejectionReason.trim()) {
      setError("Please provide a rejection reason");
      return;
    }
    
    setIsApproving(true);
    setError(null);
    try {
      await onReject(approval.planId, currentUserCredential.id, rejectionReason);
      setShowApprovalForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reject");
    } finally {
      setIsApproving(false);
    }
  }, [approval.planId, currentUserCredential, rejectionReason, onReject]);

  return (
    <div className="bg-white border border-slate-200 rounded-sm shadow-sm overflow-hidden">
      <div className="p-3 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
        <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wide">
          Plan Status
        </h3>
        <StatusBadge status={approval.status} />
      </div>

      <div className="p-4 space-y-4">
        {/* PE Stamp Banner */}
        {approval.requiresPeStamp && (
          <div className="bg-amber-50 border border-amber-200 rounded-sm p-3 flex items-start gap-2">
            <svg className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div>
              <p className="text-sm font-bold text-amber-800">PE Stamp Required</p>
              <p className="text-xs text-amber-700">
                State highway jurisdiction requires Professional Engineer approval.
              </p>
            </div>
          </div>
        )}

        {/* Draft Status */}
        {approval.status === "draft" && (
          <div className="text-center py-4 text-slate-500">
            <p className="text-sm">Plan is in draft. Generate computation to continue.</p>
          </div>
        )}

        {/* Computed - Ready to Submit */}
        {canSubmit && (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              Plan computation is complete. Submit for approval when ready.
            </p>
            <button
              onClick={handleSubmit}
              disabled={isSubmitting}
              className="w-full py-2.5 bg-blue-600 text-white font-semibold rounded-sm hover:bg-blue-700 disabled:opacity-50 transition flex items-center justify-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Submitting...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Submit for Approval
                </>
              )}
            </button>
          </div>
        )}

        {/* Pending Approval - Author View */}
        {approval.status === "pending_approval" && isAuthor && (
          <div className="bg-blue-50 border border-blue-200 rounded-sm p-3">
            <p className="text-sm text-blue-800">
              Awaiting approval from a {needsPeCredential ? "Professional Engineer" : "TCS holder"}.
            </p>
          </div>
        )}

        {/* Pending Approval - Approver View */}
        {canApprove && !showApprovalForm && (
          <div className="space-y-3">
            {!hasCorrectCredential && needsPeCredential && (
              <div className="bg-red-50 border border-red-200 rounded-sm p-3 text-sm text-red-700">
                This plan requires PE approval. Your TCS credential is not sufficient.
              </div>
            )}
            
            {hasCorrectCredential && (
              <>
                <p className="text-sm text-slate-600">
                  Review this plan using your credential:{" "}
                  <span className="font-mono font-medium">{currentUserCredential?.identifier}</span>
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowApprovalForm(true)}
                    className="flex-1 py-2 bg-emerald-600 text-white font-semibold rounded-sm hover:bg-emerald-700 transition"
                  >
                    Review & Approve
                  </button>
                  <button
                    onClick={() => {
                      setShowApprovalForm(true);
                      setRejectionReason("");
                    }}
                    className="py-2 px-4 border border-red-300 text-red-700 font-medium rounded-sm hover:bg-red-50 transition"
                  >
                    Reject
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* Approval Form */}
        {showApprovalForm && canApprove && hasCorrectCredential && (
          <div className="space-y-4 border-t border-slate-200 pt-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Attestation Statement *
              </label>
              <textarea
                value={attestation}
                onChange={(e) => setAttestation(e.target.value)}
                placeholder="I have reviewed this TCP and attest that it meets the requirements of..."
                rows={3}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
              />
            </div>
            
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Comments (optional)
              </label>
              <textarea
                value={comments}
                onChange={(e) => setComments(e.target.value)}
                placeholder="Additional notes..."
                rows={2}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Rejection Reason (if rejecting)
              </label>
              <input
                type="text"
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                placeholder="Leave empty to approve"
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
              />
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setShowApprovalForm(false)}
                className="flex-1 py-2 border border-slate-300 text-slate-700 font-medium rounded-sm hover:bg-slate-50 transition"
              >
                Cancel
              </button>
              {rejectionReason ? (
                <button
                  onClick={handleReject}
                  disabled={isApproving}
                  className="flex-1 py-2 bg-red-600 text-white font-semibold rounded-sm hover:bg-red-700 disabled:opacity-50 transition"
                >
                  {isApproving ? "Rejecting..." : "Reject Plan"}
                </button>
              ) : (
                <button
                  onClick={handleApprove}
                  disabled={isApproving || !attestation.trim()}
                  className="flex-1 py-2 bg-emerald-600 text-white font-semibold rounded-sm hover:bg-emerald-700 disabled:opacity-50 transition"
                >
                  {isApproving ? "Approving..." : "Approve Plan"}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Approved Status */}
        {approval.status === "approved" && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-sm p-4">
            <div className="flex items-center gap-2 mb-2">
              <svg className="w-5 h-5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-sm font-bold text-emerald-800">Plan Approved</span>
            </div>
            {approval.approverName && (
              <p className="text-sm text-emerald-700">
                By {approval.approverName}
                {approval.approverCredential && ` (${approval.approverCredential})`}
              </p>
            )}
            {approval.approvalDate && (
              <p className="text-xs text-emerald-600 mt-1">{approval.approvalDate}</p>
            )}
          </div>
        )}

        {/* Rejected Status */}
        {approval.status === "rejected" && (
          <div className="bg-red-50 border border-red-200 rounded-sm p-4">
            <div className="flex items-center gap-2 mb-2">
              <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-sm font-bold text-red-800">Plan Rejected</span>
            </div>
            {approval.rejectionReason && (
              <p className="text-sm text-red-700">{approval.rejectionReason}</p>
            )}
          </div>
        )}

        {/* Error Display */}
        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-sm text-red-700 text-sm">
            {error}
          </div>
        )}

        {/* Disclaimer */}
        <div className="text-xs text-slate-500 border-t border-slate-100 pt-3 mt-3">
          {approval.disclaimer}
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: ApprovalInfo["status"] }) {
  const styles = {
    draft: "bg-slate-100 text-slate-600 border-slate-200",
    computed: "bg-blue-100 text-blue-700 border-blue-200",
    pending_approval: "bg-amber-100 text-amber-700 border-amber-200",
    approved: "bg-emerald-100 text-emerald-700 border-emerald-200",
    rejected: "bg-red-100 text-red-700 border-red-200",
  };

  const labels = {
    draft: "Draft",
    computed: "Ready",
    pending_approval: "Pending",
    approved: "Approved",
    rejected: "Rejected",
  };

  return (
    <span className={`px-2 py-1 text-xs font-bold uppercase rounded-sm border ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}
