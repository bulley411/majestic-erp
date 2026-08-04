-- AlterTable
ALTER TABLE "Department" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "EmployeeCompensation" ADD COLUMN     "recordedById" TEXT;

-- AlterTable
ALTER TABLE "GradeLevel" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "JobTitle" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true;
