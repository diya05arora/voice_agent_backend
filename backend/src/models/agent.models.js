import { Schema, model } from 'mongoose';

const FormFieldSchema = new Schema({
  key: { type: String, required: true },       // internal key
  label: { type: String, required: true },     // question shown to user
  type: {
    type: String,
    enum: ['string', 'number', 'phone', 'date'],
    default: 'string'
  },
  required: { type: Boolean, default: true }
});

const AgentSchema = new Schema({
  adminId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  agentName: { type: String, required: true },

  agentType: {
    type: String,
    enum: ['query', 'survey', 'form'],
    required: true
  },

  language: {
  type: String,
  enum: ['en', 'hi'],
  default: 'en'
  },

  // free text for query/survey agents
  knowledgeBase: { type: String },

  // ONLY for form agents
  formFields: [FormFieldSchema],

  systemPrompt: String,
  greeting: String,

  createdAt: { type: Date, default: Date.now }
});

export default model('Agent', AgentSchema);
