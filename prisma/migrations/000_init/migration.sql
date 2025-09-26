-- Enable extensions
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateTable
CREATE TABLE "Source" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "visibility" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "searchable" TEXT NOT NULL,
    "raw" JSONB NOT NULL,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Chunk" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "embedding" vector(3072),
    "meta" JSONB,

    CONSTRAINT "Chunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "principalType" TEXT NOT NULL,
    "principalId" TEXT NOT NULL,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncState" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "cursor" TEXT,
    "lastRun" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "stats" JSONB,

    CONSTRAINT "SyncState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Source_externalId_key" ON "Source"("externalId");

-- CreateIndex
CREATE INDEX "Source_kind_externalId_idx" ON "Source"("kind", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Document_externalId_key" ON "Document"("externalId");

-- CreateIndex
CREATE INDEX "Document_sourceId_idx" ON "Document"("sourceId");

-- CreateIndex
CREATE INDEX "Document_externalId_idx" ON "Document"("externalId");

-- CreateIndex
CREATE INDEX "Document_updatedAt_idx" ON "Document"("updatedAt");

-- CreateIndex
CREATE INDEX "Chunk_documentId_idx" ON "Chunk"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "Chunk_documentId_ordinal_key" ON "Chunk"("documentId", "ordinal");

-- CreateIndex
CREATE INDEX "Permission_principalType_principalId_idx" ON "Permission"("principalType", "principalId");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_documentId_principalType_principalId_key" ON "Permission"("documentId", "principalType", "principalId");

-- CreateIndex
CREATE UNIQUE INDEX "SyncState_sourceId_key" ON "SyncState"("sourceId");

-- Create GIN index for text search
CREATE INDEX "Document_searchable_gin_idx" ON "Document" USING gin("searchable" gin_trgm_ops);

-- Create IVFFlat index for vector similarity
CREATE INDEX "Chunk_embedding_ivfflat_idx" ON "Chunk" USING ivfflat("embedding" vector_cosine_ops) WITH (lists = 100);

-- Create BRIN index for time-based queries
CREATE INDEX "Document_updatedAt_brin_idx" ON "Document" USING brin("updatedAt");

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Chunk" ADD CONSTRAINT "Chunk_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Permission" ADD CONSTRAINT "Permission_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;