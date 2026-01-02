import mongoose from "mongoose";
import { DB_NAME } from "../constants.js";

const connectDB = async () => {
  try {
    const uri = `${process.env.MONGO_URI}/${DB_NAME}`;

    console.log("Connecting to:", uri); // TEMP DEBUG

    const connectionInstance = await mongoose.connect(uri);
    console.log(
      `MongoDB connected! DB host: ${connectionInstance.connection.host}`
    );
  } catch (error) {
    console.error("MongoDB Connection error", error.message);
    process.exit(1);
  }
};

export default connectDB;
