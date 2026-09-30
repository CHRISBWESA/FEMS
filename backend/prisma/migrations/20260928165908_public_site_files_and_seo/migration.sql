/*
  Warnings:

  - You are about to drop the column `is_private` on the `public_enquiries` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "fellowships" ADD COLUMN     "site_updated_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "public_enquiries" DROP COLUMN "is_private";
