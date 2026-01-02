import { Schema, model } from "mongoose";

const FormSubmissionSchema = new Schema({
  agentId: {
    type: Schema.Types.ObjectId,
    ref: "Agent",
    required: true
  },

  answers: {
    type: Object, // dynamic key-value
    required: true
  },

  createdAt: { type: Date, default: Date.now }
});

export default model("FormSubmission", FormSubmissionSchema);
