import { z } from 'zod';

/** Shared between API validation and React forms. One definition, no drift. */

export const employmentType = z.enum(['PERMANENT', 'CONTRACT', 'TEMPORARY', 'OTHER']);
export const employeeStatus = z.enum(['ONBOARDING', 'ACTIVE', 'ON_LEAVE', 'SUSPENDED', 'EXITED']);

const money = z.coerce.number().nonnegative();

export const employeeCreateSchema = z.object({
  staffId: z.string().regex(/^MAPA-\d{2}-[A-Z]{3}-\d{4}$/, 'Format: MAPA-26-PER-0008'),
  firstName: z.string().min(1, 'Required'),
  middleName: z.string().optional(),
  lastName: z.string().min(1, 'Required'),
  dateOfBirth: z.coerce.date().optional(),
  gender: z.enum(['MALE', 'FEMALE']).optional(),
  maritalStatus: z.enum(['SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED']).optional(),
  nationality: z.string().default('Nigerian'),
  stateOfOrigin: z.string().optional(),
  localGovernmentArea: z.string().optional(),
  residentialAddress: z.string().optional(),
  phoneNumber: z.string().optional(),
  personalEmail: z.string().email().optional().or(z.literal('')),

  departmentId: z.string().uuid().optional(),
  jobTitleId: z.string().uuid().optional(),
  gradeLevelId: z.string().uuid().optional(),
  employmentType: employmentType.default('PERMANENT'),
  status: employeeStatus.default('ONBOARDING'),
  dateOfEmployment: z.coerce.date().optional(),
  dateOfAssumption: z.coerce.date().optional(),
  supervisorId: z.string().uuid().optional(),

  bankName: z.string().optional(),
  bankAccountName: z.string().optional(),
  bankAccountNumber: z.string().regex(/^\d{10}$/, 'NUBAN is 10 digits').optional().or(z.literal('')),
  pensionFundAdministrator: z.string().optional(),
  rsaPin: z.string().optional(),
  taxIdentificationNumber: z.string().optional(),
  nhfNumber: z.string().optional(),
  nhfEnrolled: z.boolean().default(false),
  annualRentPaid: money.optional(),

  nextOfKinName: z.string().optional(),
  nextOfKinRelationship: z.string().optional(),
  nextOfKinPhone: z.string().optional(),
  nextOfKinAddress: z.string().optional(),
  emergencyContactName: z.string().optional(),
  emergencyContactRelationship: z.string().optional(),
  emergencyContactPhone: z.string().optional(),
  emergencyContactAddress: z.string().optional(),
});

export const employeeUpdateSchema = employeeCreateSchema.partial();

export const compensationSchema = z.object({
  employeeId: z.string().uuid(),
  structureId: z.string().uuid(),
  totalPackage: money,
  monthlyGross: money,
  peculiarAllowance: money.default(0),
  effectiveFrom: z.coerce.date(),
  reason: z.string().optional(),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'At least 8 characters'),
});

export type EmployeeCreate = z.infer<typeof employeeCreateSchema>;
export type EmployeeUpdate = z.infer<typeof employeeUpdateSchema>;
export type Login = z.infer<typeof loginSchema>;
