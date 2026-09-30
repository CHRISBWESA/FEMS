-- CreateEnum
CREATE TYPE "PublicPageKey" AS ENUM ('home', 'about', 'leadership', 'departments', 'ministries', 'events', 'publications', 'news', 'gallery', 'sermons', 'testimonies', 'projects', 'get_involved', 'prayer', 'give', 'contact');

-- CreateEnum
CREATE TYPE "PublicPostKind" AS ENUM ('sermon', 'testimony', 'project');

-- CreateEnum
CREATE TYPE "PublicEnquiryKind" AS ENUM ('prayer_request', 'contact_message', 'donation_pledge');

-- CreateTable
CREATE TABLE "public_profiles" (
    "fellowship_id" UUID NOT NULL,
    "tagline" TEXT,
    "story" TEXT,
    "mission" TEXT,
    "vision" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "service_times" TEXT,
    "facebook_url" TEXT,
    "youtube_url" TEXT,
    "whatsapp_url" TEXT,
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "public_profiles_pkey" PRIMARY KEY ("fellowship_id")
);

-- CreateTable
CREATE TABLE "public_pages" (
    "fellowship_id" UUID NOT NULL,
    "key" "PublicPageKey" NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "body" TEXT,
    "is_visible" BOOLEAN NOT NULL DEFAULT true,
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "public_pages_pkey" PRIMARY KEY ("fellowship_id","key")
);

-- CreateTable
CREATE TABLE "public_posts" (
    "id" UUID NOT NULL,
    "fellowship_id" UUID NOT NULL,
    "kind" "PublicPostKind" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "reference" TEXT,
    "attribution" TEXT,
    "media_url" TEXT,
    "happens_at" TIMESTAMP(3),
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "public_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public_enquiries" (
    "id" UUID NOT NULL,
    "fellowship_id" UUID NOT NULL,
    "kind" "PublicEnquiryKind" NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "message" TEXT NOT NULL,
    "amount" DECIMAL(12,2),
    "currency" TEXT DEFAULT 'USD',
    "is_private" BOOLEAN NOT NULL DEFAULT true,
    "is_handled" BOOLEAN NOT NULL DEFAULT false,
    "handled_by" UUID,
    "handled_at" TIMESTAMP(3),
    "submitted_ip" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "public_enquiries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "public_posts_fellowship_id_kind_is_published_idx" ON "public_posts"("fellowship_id", "kind", "is_published");

-- CreateIndex
CREATE INDEX "public_enquiries_fellowship_id_kind_created_at_idx" ON "public_enquiries"("fellowship_id", "kind", "created_at");

-- CreateIndex
CREATE INDEX "public_enquiries_fellowship_id_is_handled_idx" ON "public_enquiries"("fellowship_id", "is_handled");

-- AddForeignKey
ALTER TABLE "public_profiles" ADD CONSTRAINT "public_profiles_fellowship_id_fkey" FOREIGN KEY ("fellowship_id") REFERENCES "fellowships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public_pages" ADD CONSTRAINT "public_pages_fellowship_id_fkey" FOREIGN KEY ("fellowship_id") REFERENCES "fellowships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public_posts" ADD CONSTRAINT "public_posts_fellowship_id_fkey" FOREIGN KEY ("fellowship_id") REFERENCES "fellowships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public_enquiries" ADD CONSTRAINT "public_enquiries_fellowship_id_fkey" FOREIGN KEY ("fellowship_id") REFERENCES "fellowships"("id") ON DELETE CASCADE ON UPDATE CASCADE;
