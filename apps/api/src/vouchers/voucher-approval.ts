import { ForbiddenException, BadRequestException } from '@nestjs/common';
import Decimal from 'decimal.js';

/**
 * Voucher approval routing for Majestic APA Limited.
 *
 *   Below the threshold -> Executive Director approves
 *   At or above         -> Managing Director approves
 *
 * Limits are data (the ApprovalLimit table), not constants, so raising
 * the threshold is a settings change rather than a deploy. Each approval
 * records the limit that was in force at the time, so a voucher approved
 * last year still shows the rule it was judged against even after the
 * threshold moves.
 *
 * Authority escalates but never descends: the MD can approve anything the
 * ED could, the ED can never approve something that needs the MD.
 */

export interface Limit {
  roleCode: string;
  rank: number;
  /** null = unlimited */
  maxAmount: Decimal | null;
}

export interface Actor {
  id: string;
  roles: string[];
}

/**
 * The lowest-authority role permitted to approve this amount.
 * Limits are sorted by rank; the first whose ceiling covers the amount wins.
 */
export function requiredApprover(amount: Decimal, limits: Limit[]): Limit {
  if (amount.lte(0)) {
    throw new BadRequestException('Voucher amount must be greater than zero.');
  }
  const ordered = [...limits].sort((a, b) => a.rank - b.rank);
  const match = ordered.find(
    (l) => l.maxAmount === null || amount.lte(l.maxAmount),
  );
  if (!match) {
    throw new BadRequestException(
      `No approval limit covers ${amount.toFixed(2)}. ` +
        `Configure an unlimited role before raising vouchers of this size.`,
    );
  }
  return match;
}

export interface VoucherForApproval {
  id: string;
  voucherNo: string;
  amount: Decimal;
  status: string;
  raisedById: string | null;
  approvedById: string | null;
}

/**
 * Validates an approval. Returns the limit that authorised it, which the
 * caller writes onto the VoucherApproval row.
 */
export function authorizeVoucherApproval(
  voucher: VoucherForApproval,
  actor: Actor,
  limits: Limit[],
): { approvedUnder: Limit; requiredRole: string } {
  if (voucher.status !== 'PENDING_APPROVAL') {
    throw new BadRequestException(
      `Voucher ${voucher.voucherNo} is ${voucher.status} and is not awaiting approval.`,
    );
  }

  // The person who raised it cannot approve it, whatever roles they hold.
  if (voucher.raisedById && voucher.raisedById === actor.id) {
    throw new ForbiddenException(
      'You raised this voucher. It must be approved by someone else.',
    );
  }

  const required = requiredApprover(voucher.amount, limits);
  const ordered = [...limits].sort((a, b) => a.rank - b.rank);

  // Any role the actor holds that ranks at or above the required one.
  const held = ordered.filter(
    (l) => actor.roles.includes(l.roleCode) && l.rank >= required.rank,
  );

  if (!held.length) {
    const naira = voucher.amount.toNumber().toLocaleString('en-NG', {
      style: 'currency',
      currency: 'NGN',
    });
    throw new ForbiddenException(
      `${naira} requires ${required.roleCode} approval.`,
    );
  }

  return { approvedUnder: held[0], requiredRole: required.roleCode };
}

/** Human-readable routing, for the voucher form as the amount is typed. */
export function describeRouting(amount: Decimal, limits: Limit[]): string {
  try {
    const r = requiredApprover(amount, limits);
    const label =
      { ED: 'Executive Director', MD: 'Managing Director' }[r.roleCode] ??
      r.roleCode;
    return `Requires ${label} approval`;
  } catch {
    return 'Amount is outside all approval limits';
  }
}
