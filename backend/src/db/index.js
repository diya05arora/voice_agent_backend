import mongoose from "mongoose";
import { DB_NAME } from "../constants.js";

const connectDB = async () => {
  try {
    const uri = process.env.MONGO_URI;

    if (!uri) {
      throw new Error("MONGO_URI is not configured");
    }

    const connectionInstance = await mongoose.connect(uri, {
      dbName: DB_NAME
    });
    console.log(
      `MongoDB connected! DB host: ${connectionInstance.connection.host}`
    );
  } catch (error) {
    console.error("MongoDB Connection error", error.message);
    process.exit(1);
  }
};

export default connectDB;
