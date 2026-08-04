import { z } from 'zod';

/** Shared between API validation and React forms. One definition, no drift. */

export const employmentType = z.enum(['PERMANENT', 'CONTRACT', 'TEMPORARY', 'OTHER']);
export const employeeStatus = z.enum(['ONBOARDING', 'ACTIVE', 'ON_LEAVE', 'SUSPENDED', 'EXITED']);

const money = z.coerce.number().nonnegative();

/**
 * Optional fields arrive three ways: absent, an empty string from a form
 * input, or null from the database. All three mean "not set", so they are
 * normalised to undefined before any format rule runs. Without this, every
 * empty field on a loaded record fails validation on save.
 */
const blankToUndefined = (v: unknown) =>
  v === null || v === '' || (typeof v === 'string' && v.trim() === '') ? undefined : v;

const optional = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess(blankToUndefined, schema.optional());

const optionalText = optional(z.string().trim().min(1));

/**
 * RSA PIN: PEN + 12 digits. Issued by the PFA and used for pension
 * remittance, so a wrong one means contributions go nowhere.
 */
const rsaPin = optional(
  z.string().trim().toUpperCase().regex(/^PEN\d{12}$/, 'RSA PIN is PEN followed by 12 digits'),
);

/** NUBAN: exactly 10 digits. */
const nuban = optional(
  z.string().trim().regex(/^\d{10}$/, 'Account number must be exactly 10 digits'),
);

/** TIN: 8-14 digits, sometimes hyphenated. */
const tin = optional(z.string().trim().regex(/^[\d-]{8,15}$/, 'TIN should be 8 to 14 digits'));

/** Nigerian mobile: 11 digits local, or +234 form. */
const phone = optional(
  z.string().trim().regex(/^(0\d{10}|\+234\d{10})$/, 'Use 08012345678 or +2348012345678'),
);

export const employeeCreateSchema = z.object({
  staffId: z.string().regex(/^MAPA-\d{2}-[A-Z]{3}-\d{4}$/, 'Format: MAPA-26-PER-0008'),
  firstName: z.string().min(1, 'Required'),
  middleName: optionalText,
  lastName: z.string().min(1, 'Required'),
  dateOfBirth: optional(z.coerce.date()),
  gender: optional(z.enum(['MALE', 'FEMALE'])),
  maritalStatus: optional(z.enum(['SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED'])),
  nationality: optional(z.string().trim().min(1)),
  stateOfOrigin: optionalText,
  localGovernmentArea: optionalText,
  residentialAddress: optionalText,
  phoneNumber: phone,
  personalEmail: optional(z.string().email('Enter a valid email')),

  departmentId: optional(z.string().uuid()),
  jobTitleId: optional(z.string().uuid()),
  gradeLevelId: optional(z.string().uuid()),
  employmentType: employmentType.default('PERMANENT'),
  status: employeeStatus.default('ONBOARDING'),
  dateOfEmployment: optional(z.coerce.date()),
  dateOfAssumption: optional(z.coerce.date()),
  supervisorId: optional(z.string().uuid()),

  bankName: optionalText,
  bankAccountName: optionalText,
  bankAccountNumber: nuban,
  pensionFundAdministrator: optionalText,
  rsaPin,
  taxIdentificationNumber: tin,
  nhfNumber: optionalText,
  nhfEnrolled: z.coerce.boolean().default(false),
  annualRentPaid: optional(money),

  nextOfKinName: optionalText,
  nextOfKinRelationship: optionalText,
  nextOfKinPhone: phone,
  nextOfKinAddress: optionalText,
  emergencyContactName: optionalText,
  emergencyContactRelationship: optionalText,
  emergencyContactPhone: phone,
  emergencyContactAddress: optionalText,
});

/**
 * Cross-field rules that a single field cannot express.
 */
const withEmployeeRules = <T extends z.ZodTypeAny>(schema: T) =>
  schema.superRefine((v: any, ctx) => {
    if (v.dateOfBirth && v.dateOfEmployment && v.dateOfBirth >= v.dateOfEmployment) {
      ctx.addIssue({ code: 'custom', path: ['dateOfBirth'],
        message: 'Date of birth must be before date of employment.' });
    }
    if (v.dateOfBirth) {
      const age = (Date.now() - new Date(v.dateOfBirth).getTime()) / 31557600000;
      if (age < 16) ctx.addIssue({ code: 'custom', path: ['dateOfBirth'],
        message: 'Employee must be at least 16 years old.' });
      if (age > 100) ctx.addIssue({ code: 'custom', path: ['dateOfBirth'],
        message: 'Check the date of birth — that age looks wrong.' });
    }
    // Assumption of duty is what activates payroll, so it cannot precede
    // the employment date.
    if (v.dateOfEmployment && v.dateOfAssumption && v.dateOfAssumption < v.dateOfEmployment) {
      ctx.addIssue({ code: 'custom', path: ['dateOfAssumption'],
        message: 'Assumption of duty cannot be before the employment date.' });
    }
    if (v.bankAccountNumber && !v.bankName) {
      ctx.addIssue({ code: 'custom', path: ['bankName'],
        message: 'Bank name is required when an account number is given.' });
    }
    if (v.rsaPin && !v.pensionFundAdministrator) {
      ctx.addIssue({ code: 'custom', path: ['pensionFundAdministrator'],
        message: 'PFA is required when an RSA PIN is given.' });
    }
  });

export const employeeCreate = withEmployeeRules(employeeCreateSchema);
export const employeeUpdateSchema = employeeCreateSchema.partial();
export const employeeUpdate = withEmployeeRules(employeeUpdateSchema);



/**
 * A compensation record is never edited — a new one supersedes the old.
 * That is what lets an old payslip reproduce exactly: the run reads the
 * record that was effective on its period, not whatever is current now.
 */
export const compensationSchema = z
  .object({
    structureId: z.string().uuid('Choose a salary structure'),
    /** Full monthly package, before the peculiar-allowance split. */
    totalPackage: money,
    /** Taxable payroll portion. PAYE and pension are computed from this. */
    monthlyGross: money,
    /** Non-taxable reimbursable portion. */
    peculiarAllowance: money.default(0),
    effectiveFrom: z.coerce.date(),
    reason: z.string().trim().max(200).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.monthlyGross <= 0) {
      ctx.addIssue({ code: 'custom', path: ['monthlyGross'],
        message: 'Monthly gross must be greater than zero.' });
    }
    // The two parts must reconcile, or the payslip and the bank transfer
    // will disagree and nobody will know which is right.
    // Compared in kobo as integers — 0.1 + 0.2 style float error would
    // otherwise reject figures that are actually correct.
    const kobo = (n: number) => Math.round(n * 100);
    const parts = kobo(v.monthlyGross) + kobo(v.peculiarAllowance);
    if (Math.abs(parts - kobo(v.totalPackage)) > 1) {
      ctx.addIssue({ code: 'custom', path: ['totalPackage'],
        message: `Gross (${v.monthlyGross.toLocaleString()}) plus allowance (${v.peculiarAllowance.toLocaleString()}) must equal the total package.` });
    }
  });

export type CompensationInput = z.infer<typeof compensationSchema>;

/** HR settings: departments, job titles, grade levels. */
export const departmentSchema = z.object({
  code: z.string().trim().min(2).max(12).toUpperCase(),
  name: z.string().trim().min(2).max(80),
  isActive: z.boolean().optional(),
});

export const jobTitleSchema = z.object({
  name: z.string().trim().min(2).max(80),
  isActive: z.boolean().optional(),
});

export const gradeLevelSchema = z.object({
  code: z.string().trim().min(1).max(12).toUpperCase(),
  name: z.string().trim().min(2).max(80),
  rank: z.coerce.number().int().min(1).max(99),
  defaultGross: money.optional(),
  isActive: z.boolean().optional(),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'At least 8 characters'),
});

export type EmployeeCreate = z.infer<typeof employeeCreateSchema>;
export type EmployeeUpdate = z.infer<typeof employeeUpdateSchema>;
export type Login = z.infer<typeof loginSchema>;
