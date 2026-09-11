-- CreateEnum
CREATE TYPE "PayrollAccountKey" AS ENUM ('SALARIES_EXPENSE', 'PENSION_EXPENSE_EMPLOYER', 'NET_SALARIES_PAYABLE', 'PAYE_PAYABLE', 'PENSION_PAYABLE', 'NHF_PAYABLE');

-- CreateTable
CREATE TABLE "PayrollAccountMapping" (
    "id" TEXT NOT NULL,
    "key" "PayrollAccountKey" NOT NULL,
    "accountId" TEXT NOT NULL,
    "description" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "PayrollAccountMapping_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PayrollAccountMapping_key_key" ON "PayrollAccountMapping"("key");

-- AddForeignKey
ALTER TABLE "PayrollAccountMapping" ADD CONSTRAINT "PayrollAccountMapping_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
