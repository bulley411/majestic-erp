/*
  Warnings:

  - You are about to drop the column `checkedAt` on the `EmployeeDocument` table. All the data in the column will be lost.
  - You are about to drop the column `checkedById` on the `EmployeeDocument` table. All the data in the column will be lost.
  - You are about to drop the column `createdAt` on the `EmployeeDocument` table. All the data in the column will be lost.
  - You are about to drop the column `fileName` on the `EmployeeDocument` table. All the data in the column will be lost.
  - You are about to drop the column `fileUrl` on the `EmployeeDocument` table. All the data in the column will be lost.
  - You are about to drop the column `onFile` on the `EmployeeDocument` table. All the data in the column will be lost.
  - You are about to drop the column `reviewedAt` on the `EmployeeDocument` table. All the data in the column will be lost.
  - You are about to drop the column `reviewedById` on the `EmployeeDocument` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[storedName]` on the table `EmployeeDocument` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `checksum` to the `EmployeeDocument` table without a default value. This is not possible if the table is not empty.
  - Added the required column `originalName` to the `EmployeeDocument` table without a default value. This is not possible if the table is not empty.
  - Added the required column `storedName` to the `EmployeeDocument` table without a default value. This is not possible if the table is not empty.
  - Made the column `fileSizeBytes` on table `EmployeeDocument` required. This step will fail if there are existing NULL values in that column.
  - Made the column `mimeType` on table `EmployeeDocument` required. This step will fail if there are existing NULL values in that column.

*/
-- DropIndex
DROP INDEX "EmployeeDocument_employeeId_documentTypeId_key";

-- AlterTable
ALTER TABLE "DocumentType" ADD COLUMN     "allowMultiple" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "EmployeeDocument" DROP COLUMN "checkedAt",
DROP COLUMN "checkedById",
DROP COLUMN "createdAt",
DROP COLUMN "fileName",
DROP COLUMN "fileUrl",
DROP COLUMN "onFile",
DROP COLUMN "reviewedAt",
DROP COLUMN "reviewedById",
ADD COLUMN     "checksum" TEXT NOT NULL,
ADD COLUMN     "originalName" TEXT NOT NULL,
ADD COLUMN     "storedName" TEXT NOT NULL,
ADD COLUMN     "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "uploadedById" TEXT,
ALTER COLUMN "fileSizeBytes" SET NOT NULL,
ALTER COLUMN "mimeType" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeDocument_storedName_key" ON "EmployeeDocument"("storedName");

-- CreateIndex
CREATE INDEX "EmployeeDocument_employeeId_idx" ON "EmployeeDocument"("employeeId");

-- CreateIndex
CREATE INDEX "EmployeeDocument_documentTypeId_idx" ON "EmployeeDocument"("documentTypeId");
