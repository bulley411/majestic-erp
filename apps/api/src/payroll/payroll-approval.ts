import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { ApprovalAction, PayrollRunStatus } from '@prisma/client';

/**
 * Payroll approval chain for Majestic APA Limited.
 *
 *   Accountant prepares -> Head of Finance reviews -> MD approves -> posts to GL
 *
 * Two rules are enforced here rather than left to the UI:
 *
 *  1. Only the role that owns a stage can advance it.
 *  2. No one may sign off on a stage they already signed. A user holding
 *     both FINANCE_HEAD and MD cannot review and then approve the same run.
 *     That is the entire point of a three-way chain — if one person can
 *     walk a payroll run from draft to posted alone, the control is theatre.
 */

export const ROLES = {
  ACCOUNTANT: 'ACCOUNTANT',
  FINANCE_HEAD: 'FINANCE_HEAD',
  MD: 'MD',
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

interface Transition {
  from: PayrollRunStatus;
  to: PayrollRunStatus;
  /** Roles permitted to perform this transition. */
  roles: Role[];
  /** Stages whose signer must not be the current actor. */
  conflictsWith: ('preparedById' | 'reviewedById' | 'approvedById')[];
  /** Field on PayrollRun that records the signer. */
  records?: 'preparedById' | 'reviewedById' | 'approvedById' | 'postedById';
}

export const TRANSITIONS: Record<ApprovalAction, Transition[]> = {
  PREPARE: [
    {
      from: 'DRAFT',
      to: 'PREPARED',
      roles: [ROLES.ACCOUNTANT, ROLES.FINANCE_HEAD],
      conflictsWith: [],
      records: 'preparedById',
    },
    {
      from: 'REJECTED',
      to: 'PREPARED',
      roles: [ROLES.ACCOUNTANT, ROLES.FINANCE_HEAD],
      conflictsWith: [],
      records: 'preparedById',
    },
  ],
  REVIEW: [
    {
      from: 'PREPARED',
      to: 'REVIEWED',
      roles: [ROLES.FINANCE_HEAD],
      conflictsWith: ['preparedById'],
      records: 'reviewedById',
    },
  ],
  APPROVE: [
    {
      from: 'REVIEWED',
      to: 'APPROVED',
      roles: [ROLES.MD],
      conflictsWith: ['preparedById', 'reviewedById'],
      records: 'approvedById',
    },
  ],
  REJECT: [
    { from: 'PREPARED', to: 'REJECTED', roles: [ROLES.FINANCE_HEAD, ROLES.MD], conflictsWith: [] },
    { from: 'REVIEWED', to: 'REJECTED', roles: [ROLES.MD], conflictsWith: [] },
  ],
  POST: [
    {
      from: 'APPROVED',
      to: 'POSTED',
      roles: [ROLES.ACCOUNTANT, ROLES.FINANCE_HEAD],
      conflictsWith: [],
      records: 'postedById',
    },
  ],
  MARK_PAID: [
    { from: 'POSTED', to: 'PAID', roles: [ROLES.ACCOUNTANT, ROLES.FINANCE_HEAD], conflictsWith: [] },
  ],
};

export interface RunSigners {
  status: PayrollRunStatus;
  preparedById: string | null;
  reviewedById: string | null;
  approvedById: string | null;
}

export interface Actor {
  id: string;
  roles: string[];
}

/**
 * Validates a requested transition. Throws on any violation; returns the
 * target status and the field to stamp on success.
 */
export function authorizeTransition(
  run: RunSigners,
  action: ApprovalAction,
  actor: Actor,
  remarks?: string,
): { to: PayrollRunStatus; records?: Transition['records']; role: Role } {
  const candidates = TRANSITIONS[action] ?? [];
  const transition = candidates.find((t) => t.from === run.status);

  if (!transition) {
    throw new BadRequestException(
      `Cannot ${action.toLowerCase()} a payroll run that is ${run.status}.`,
    );
  }

  const role = transition.roles.find((r) => actor.roles.includes(r));
  if (!role) {
    throw new ForbiddenException(
      `This step requires ${transition.roles.join(' or ')}.`,
    );
  }

  for (const field of transition.conflictsWith) {
    if (run[field] === actor.id) {
      throw new ForbiddenException(
        `You already signed this run at an earlier stage. ` +
          `Payroll needs three separate people: preparer, reviewer, approver.`,
      );
    }
  }

  if (action === 'REJECT' && !remarks?.trim()) {
    throw new BadRequestException('A rejection must include a reason.');
  }

  return { to: transition.to, records: transition.records, role };
}

/** What the current user can do with this run right now — drives the UI. */
export function availableActions(run: RunSigners, actor: Actor): ApprovalAction[] {
  return (Object.keys(TRANSITIONS) as ApprovalAction[]).filter((action) => {
    try {
      authorizeTransition(run, action, actor, action === 'REJECT' ? 'x' : undefined);
      return true;
    } catch {
      return false;
    }
  });
}
