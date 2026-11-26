export interface PartnerWorkspaceActivityData {
  campaigns: Array<{
    assignmentId: string;
    campaign: { id: string; name: string };
    sites: Array<{ id: string; name: string }>;
  }>;
  proofs: Array<{
    id: string;
    campaign_id: string;
    site_id: string;
    status: string;
    submitted_at: string;
  }>;
  stockHistory: Array<{
    id: string;
    assignment_id: string;
    movement_type: string;
    quantity: number;
    notes: string;
    created_at: string;
  }>;
  requests: Array<{
    id: string;
    assignment_id: string;
    request_type: string;
    details: string;
    status: string;
    created_at: string;
  }>;
  damageReports: Array<{
    id: string;
    assignment_id: string;
    issue_type: string;
    details: string;
    status: string;
    created_at: string;
  }>;
  ledger: Array<{
    id: string;
    campaign_id: string | null;
    entry_type: string;
    amount: number;
    status: string;
    reference: string;
    notes: string;
    created_at: string;
  }>;
}

export interface PartnerWorkspaceActivity {
  id: string;
  createdAt: string;
  type: string;
  details: string;
  status: string;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-IN').format(value);
}

export function buildPartnerWorkspaceActivity(data: PartnerWorkspaceActivityData): PartnerWorkspaceActivity[] {
  const campaignById = new Map(data.campaigns.map(({ campaign }) => [campaign.id, campaign.name]));
  const campaignByAssignmentId = new Map(data.campaigns.map((assignment) => [
    assignment.assignmentId,
    assignment.campaign.name,
  ]));
  const siteById = new Map(data.campaigns.flatMap(({ sites }) => sites.map(({ id, name }) => [id, name] as const)));
  const activity: PartnerWorkspaceActivity[] = [
    ...data.proofs.map((proof) => ({
      id: `proof:${proof.id}`,
      createdAt: proof.submitted_at,
      type: 'Proof submission',
      details: `${siteById.get(proof.site_id) || 'Assigned shop'} · ${campaignById.get(proof.campaign_id) || 'Campaign'}`,
      status: proof.status,
    })),
    ...data.stockHistory.map((movement) => ({
      id: `stock:${movement.id}`,
      createdAt: movement.created_at,
      type: movement.movement_type.replaceAll('_', ' '),
      details: `${campaignByAssignmentId.get(movement.assignment_id) || 'Campaign'} · ${movement.quantity > 0 ? '+' : ''}${formatNumber(movement.quantity)} WildCards${movement.notes ? ` · ${movement.notes}` : ''}`,
      status: 'recorded',
    })),
    ...data.requests.map((request) => ({
      id: `request:${request.id}`,
      createdAt: request.created_at,
      type: request.request_type.replaceAll('_', ' '),
      details: `${campaignByAssignmentId.get(request.assignment_id) || 'Campaign'} · ${request.details}`,
      status: request.status,
    })),
    ...data.damageReports.map((report) => ({
      id: `damage:${report.id}`,
      createdAt: report.created_at,
      type: 'Damage report',
      details: `${campaignByAssignmentId.get(report.assignment_id) || 'Campaign'} · ${report.issue_type.replaceAll('_', ' ')}${report.details ? ` · ${report.details}` : ''}`,
      status: report.status,
    })),
    ...data.ledger.map((entry) => ({
      id: `ledger:${entry.id}`,
      createdAt: entry.created_at,
      type: `NGA Coins · ${entry.entry_type}`,
      details: `${entry.amount > 0 ? '+' : ''}${formatNumber(entry.amount)} coins · ${entry.notes || entry.reference || campaignById.get(entry.campaign_id || '') || 'Balance activity'}`,
      status: entry.status,
    })),
  ];

  return activity.sort((left, right) => {
    const leftTime = Date.parse(left.createdAt);
    const rightTime = Date.parse(right.createdAt);
    return (Number.isNaN(rightTime) ? 0 : rightTime) - (Number.isNaN(leftTime) ? 0 : leftTime);
  });
}
