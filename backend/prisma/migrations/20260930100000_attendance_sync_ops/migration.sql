-- CreateTable
CREATE TABLE "attendance_sync_ops" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "op_id" UUID NOT NULL,
    "activity_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "result" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_sync_ops_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "attendance_sync_ops_activity_id_idx" ON "attendance_sync_ops"("activity_id");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_sync_ops_user_id_op_id_key" ON "attendance_sync_ops"("user_id", "op_id");

