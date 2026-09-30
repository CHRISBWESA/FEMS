-- CreateEnum
CREATE TYPE "RegistrationStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateTable
CREATE TABLE "fellowship_registrations" (
    "id" UUID NOT NULL,
    "fellowship_name" TEXT NOT NULL,
    "location" TEXT,
    "description" TEXT,
    "contact_first_name" TEXT NOT NULL,
    "contact_last_name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "requested_plan_code" TEXT,
    "reason" TEXT,
    "status" "RegistrationStatus" NOT NULL DEFAULT 'pending',
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMP(3),
    "decision_note" TEXT,
    "created_fellowship_id" UUID,
    "submitted_ip" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fellowship_registrations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fellowship_registrations_status_created_at_idx" ON "fellowship_registrations"("status", "created_at");

-- CreateIndex
CREATE INDEX "fellowship_registrations_email_idx" ON "fellowship_registrations"("email");

-- CreateIndex
CREATE INDEX "fellowship_registrations_created_fellowship_id_idx" ON "fellowship_registrations"("created_fellowship_id");
