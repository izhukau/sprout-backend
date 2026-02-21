import { Router } from "express";
import multer from "multer";
import path from "path";
import { db } from "../db";
import { topicDocuments, nodes } from "../db/schema";
import { eq, and } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import { uploadToS3, deleteFromS3 } from "../utils/s3";
import { extractText } from "../utils/extract-text";

const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/x-markdown",
];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}`));
    }
  },
});

const router = Router();

// POST /api/nodes/:nodeId/documents
router.post(
  "/:nodeId/documents",
  upload.array("files", 5),
  async (req, res, next) => {
    try {
      const nodeId = req.params.nodeId as string;
      const files = req.files as Express.Multer.File[];

      if (!files || !files.length) {
        return res.status(400).json({ error: "No files provided" });
      }

      // Verify node exists
      const nodeResult = await db
        .select()
        .from(nodes)
        .where(eq(nodes.id, nodeId));
      if (!nodeResult.length) {
        return res.status(404).json({ error: "Node not found" });
      }

      const uploaded = [];

      for (const file of files) {
        const id = uuid();
        const ext = path.extname(file.originalname) || ".bin";
        const s3Key = `documents/${id}${ext}`;

        // Extract text from buffer
        let extractedText: string | null = null;
        let extractionStatus: "completed" | "failed" = "completed";
        let extractionError: string | null = null;

        try {
          extractedText = await extractText(file.buffer, file.mimetype);
        } catch (err: any) {
          extractionStatus = "failed";
          extractionError = err.message ?? "Unknown extraction error";
        }

        // Upload to S3
        await uploadToS3(s3Key, file.buffer, file.mimetype);

        // Insert into DB
        await db.insert(topicDocuments).values({
          id,
          nodeId,
          originalFilename: file.originalname,
          s3Key,
          mimeType: file.mimetype,
          fileSizeBytes: file.size,
          extractedText,
          extractionStatus,
          extractionError,
        });

        uploaded.push({
          id,
          nodeId,
          originalFilename: file.originalname,
          mimeType: file.mimetype,
          fileSizeBytes: file.size,
          extractionStatus,
          extractedTextLength: extractedText?.length ?? 0,
          createdAt: new Date().toISOString(),
        });
      }

      res.status(201).json({ uploaded });
    } catch (e) {
      next(e);
    }
  },
);

// GET /api/nodes/:nodeId/documents
router.get("/:nodeId/documents", async (req, res, next) => {
  try {
    const nodeId = req.params.nodeId as string;
    const docs = await db
      .select({
        id: topicDocuments.id,
        nodeId: topicDocuments.nodeId,
        originalFilename: topicDocuments.originalFilename,
        mimeType: topicDocuments.mimeType,
        fileSizeBytes: topicDocuments.fileSizeBytes,
        extractionStatus: topicDocuments.extractionStatus,
        createdAt: topicDocuments.createdAt,
      })
      .from(topicDocuments)
      .where(eq(topicDocuments.nodeId, nodeId));

    res.json(docs);
  } catch (e) {
    next(e);
  }
});

// DELETE /api/nodes/:nodeId/documents/:documentId
router.delete("/:nodeId/documents/:documentId", async (req, res, next) => {
  try {
    const nodeId = req.params.nodeId as string;
    const documentId = req.params.documentId as string;

    const doc = await db
      .select()
      .from(topicDocuments)
      .where(
        and(
          eq(topicDocuments.id, documentId),
          eq(topicDocuments.nodeId, nodeId),
        ),
      );

    if (!doc.length) {
      return res.status(404).json({ error: "Document not found" });
    }

    // Delete from S3
    await deleteFromS3(doc[0].s3Key);

    // Delete from DB
    await db
      .delete(topicDocuments)
      .where(eq(topicDocuments.id, documentId));

    res.status(204).send();
  } catch (e) {
    next(e);
  }
});

export default router;
