-- CreateIndex
CREATE INDEX "activities_fellowship_id_date_idx" ON "activities"("fellowship_id", "date");

-- CreateIndex
CREATE INDEX "attendance_activity_id_idx" ON "attendance"("activity_id");

-- CreateIndex
CREATE INDEX "attendance_member_id_idx" ON "attendance"("member_id");

