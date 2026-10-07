-- CreateEnum
CREATE TYPE "MemberRegistrationLinkStatus" AS ENUM ('pending', 'used', 'expired', 'cancelled');

-- CreateEnum
CREATE TYPE "MemberVerificationStatus" AS ENUM ('pending', 'verified', 'rejected');

-- CreateTable
CREATE TABLE "member_registration_links" (
    "id" UUID NOT NULL,
    "fellowship_id" UUID NOT NULL,
    "token" UUID NOT NULL,
    "created_by" UUID NOT NULL,
    "status" "MemberRegistrationLinkStatus" NOT NULL DEFAULT 'pending',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "member_registration_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pending_member_verifications" (
    "id" UUID NOT NULL,
    "fellowship_id" UUID NOT NULL,
    "link_id" UUID,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "gender" TEXT,
    "department_id" UUID,
    "status" "MemberVerificationStatus" NOT NULL DEFAULT 'pending',
    "submitted_data" JSONB NOT NULL,
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pending_member_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "member_registration_links_token_key" ON "member_registration_links"("token");

-- CreateIndex
CREATE INDEX "member_registration_links_fellowship_id_status_idx" ON "member_registration_links"("fellowship_id", "status");

-- CreateIndex
CREATE INDEX "member_registration_links_token_idx" ON "member_registration_links"("token");

-- CreateIndex
CREATE INDEX "pending_member_verifications_fellowship_id_status_idx" ON "pending_member_verifications"("fellowship_id", "status");

-- CreateIndex
CREATE INDEX "pending_member_verifications_link_id_idx" ON "pending_member_verifications"("link_id");
