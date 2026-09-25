import mongoose, { Schema } from "mongoose";
import type { KitStatus } from "../types/kit";

const kitSchema = new Schema(
  {
    clerkUserId: { type: String, required: true, index: true },
    status: {
      type: String,
      enum: ["queued", "researching", "generating", "ready", "failed"],
      default: "queued",
    },
    input: {
      jobDescription: { type: String, required: true },
      companyUrl: { type: String, required: true },
      companyName: String,
      daysUntilInterview: { type: Number, required: true },
    },
    research: {
      pages: [
        {
          url: String,
          title: String,
          text: String,
        },
      ],
      snippets: [
        {
          title: String,
          url: String,
          description: String,
        },
      ],
      interviewProcessInferred: { type: Boolean, default: false },
    },
    kit: { type: Schema.Types.Mixed },
    error: String,
    pinnedAt: { type: Date, default: null },
    practice: {
      flashcards: { type: Schema.Types.Mixed, default: {} },
      quizResults: { type: [Schema.Types.Mixed], default: [] },
      shortAnswerRatings: { type: [Schema.Types.Mixed], default: [] },
    },
  },
  { timestamps: true },
);

kitSchema.index({ clerkUserId: 1, pinnedAt: 1, createdAt: -1, _id: -1 });

kitSchema.set("toJSON", {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    const value = ret as Record<string, unknown> & { _id?: unknown };
    value.id = String(value._id);
    delete value._id;
    return value;
  },
});

export type KitDocument = mongoose.InferSchemaType<typeof kitSchema> & {
  id: string;
  status: KitStatus;
};

export const Kit = mongoose.model("Kit", kitSchema);
