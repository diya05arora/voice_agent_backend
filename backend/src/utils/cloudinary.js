import { v2 as cloudinary } from 'cloudinary';
import dotenv from "dotenv";
import { ApiError } from './ApiError.js';

dotenv.config();

// configure cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
})

const uploadOnCloudinary = async (localFilePath) => {
    try {
        if(!localFilePath) return null;
        const response = await cloudinary.uploader.upload(
            localFilePath, {
                resource_type: "auto"
            }
        )
        console.log("File uploaded on Cloudinary, File src: " + response.url);
        return response;
    } catch(error) {
        console.log("Error uploading file to Cloudinary: ", error);
        throw new ApiError(500, "Cloudinary upload failed");
    }
}

const deleteFromCloudinary = async (publicId) => {
    try {
        const result = await cloudinary.uploader.destroy(publicId);
        console.log("File deleted from Cloudinary, Public ID: " + publicId);
        return result;
    } catch (error) {
        console.log("Error deleting file from Cloudinary: ", error);
        return null;
    }
}

export {uploadOnCloudinary, deleteFromCloudinary}