import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js"
import { User } from "../models/user.models.js"
import { ApiResponse } from "../utils/ApiResponse.js";
import jwt from "jsonwebtoken";


const generateAccessAndRefreshToken = async (userId) => {
    try {
        const user = await User.findById(userId);
        if (!user) {
            throw new ApiError(404, "User not found");
        }

        const accessToken = user.generateAccessToken();
        const refreshToken = user.generateRefreshToken();

        user.refreshToken = refreshToken;
        await user.save({ validateBeforeSave: false });
        return { accessToken, refreshToken };
    } catch (error) {
        console.error("Error generating tokens:", error);
        throw new ApiError(500, "Something went wrong while generating tokens");
    }

}

const registerUser = asyncHandler(async (req, res) => {
    if (req.body === undefined) {
        throw new ApiError(400, "All fields are required.")
    }
    const { fullName, email, password } = req.body;

    // validation
    if (
        [fullName, email, password].some((field) => field?.trim() === "" || field === undefined)
    ) {
        throw new ApiError(400, "All fields are required.")
    }

    const existedUser = await User.findOne({
        $or: [{ email }]
    })

    if (existedUser) {
        throw new ApiError(409, "User with email already exists")
    }


    try {
        const user = await User.create({
            fullName,
            email,
            password,
        })

        const createdUser = await User.findById(user._id).select(
            "-password -refreshToken"
        )

        if (!createdUser) {
            throw new ApiError(500, "Something went wrong while registering a user!")
        }

        return res
            .status(201)
            .json(new ApiResponse(201, createdUser, "User registered successfully!"))

    } catch (error) {
        console.log("User creation failed: ", error);
        throw new ApiError(500, "Something went wrong while registering a user!")
    }


})

const loginUser = asyncHandler(async (req, res) => {
    // get data from body
    if (req.body === undefined) {
        throw new ApiError(400, "All fields are required.")
    }
    const { email, username, password } = req.body;

    // validation
    if (!email) {
        throw new ApiError(400, "Email is required");
    }
    if (!password) {
        throw new ApiError(400, "Password is required");
    }

    const user = await User.findOne({
        $or: [{ username }, { email }]
    })

    if (!user) {
        throw new ApiError(404, "User not found");
    }

    // validate password
    const isPasswordCorrect = await user.isPasswordCorrect(password)
    if (!isPasswordCorrect) {
        throw new ApiError(400, "Incorrect password");
    }

    const { accessToken, refreshToken } = await generateAccessAndRefreshToken(user._id);

    const loggedInUser = await User.findById(user._id)
        .select("-password -refreshToken");

    if (!loggedInUser) {
        throw new ApiError(404, "User not found");
    }

    const options = {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production"
    }

    return res.status(200)
        .cookie("accessToken", accessToken, options)
        .cookie("refreshToken", refreshToken, options)
        .json(new ApiResponse(200,
            { user: loggedInUser, accessToken, refreshToken },
            "User logged in successfully!"));

})

const refreshAccessToken = asyncHandler(async (req, res) => {
    const incomingRefreshToken = req.cookies.refreshToken || req.body.refreshToken;

    if (!incomingRefreshToken) {
        throw new ApiError(401, "Refresh token is required");
    }

    try {
        const decodedToken = jwt.verify(
            incomingRefreshToken,
            process.env.REFRESH_TOKEN_SECRET
        );

        const user = await User.findById(decodedToken?._id);

        if (!user) {
            throw new ApiError(404, "Invalid Refresh Token");
        }

        if(incomingRefreshToken !== user?.refreshToken){
            throw new ApiError(401, "Invalid refresh token");
        }

        const options = {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production"
        }

        const { accessToken, refreshToken: newRefreshToken } = 
        await generateAccessAndRefreshToken(user._id);

        return res.status(200)
            .cookie("accessToken", accessToken, options)
            .cookie("refreshToken", newRefreshToken, options)
            .json(new ApiResponse(200,
                { user, accessToken, newRefreshToken },
                "Access token refreshed successfully!"));

    } catch (error) {
        throw new ApiError(401, "Something went wrong while refreshing access token");
    }


})

const logoutUser = asyncHandler( async (req, res) => {
    await User.findByIdAndUpdate(
        req.user._id,
        { $set: {refreshToken: null }},
        {new : true}
    );

    const options = {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production"
    }

    return res.status(200)
        .clearCookie("accessToken", options)
        .clearCookie("refreshToken", options)
        .json(new ApiResponse(200, null, "User logged out successfully!"));
})

function deleteUnusedFiles(filePath) {
    try {
        if (filePath){
            fs.unlinkSync(filePath);
        }
    } catch (error) {
        console.error("Failed to delete avatar file:", error);
    }
}

const changeCurrentPassword = asyncHandler ( async (req, res) => {
    const {oldPassword, newPassword} = req.body;
    const user = await User.findById(req.user?._id);
    if(!user){
        throw new ApiError(404, "User not found");
    }
    const isPasswordCorrect = await user.isPasswordCorrect(oldPassword);
    if(!isPasswordCorrect) {
        throw new ApiError(400, "Incorrect old password");
    }
    user.password = newPassword;
    await user.save({validateBeforeSave: false});
    return res.status(200).json(new ApiResponse(200, null, "Password changed successfully!"));
})

const getCurrentUser = asyncHandler( async (req, res) => {
    return res.status(200).json(new ApiResponse(200, req.user, "Current user fetched successfully!"));
})

const updateAccountDetails = asyncHandler( async (req, res) => {
    const {fullName, email} = req.body;

    if(!fullName || !email){
        throw new ApiError(400, "Full name and email are required");
    }

    // const user = await User.findById(req.user?._id);
    // if(!user){
    //     throw new ApiError(404, "User not found");
    // }
    // user.fullName = fullName;
    // user.email = email;
    // await user.save({validateBeforeSave: false});
    // return res.status(200).json(new ApiResponse(200, null, "Account details updated successfully!"));

    const user = await User.findByIdAndUpdate(
        req.user?._id,
        {
            $set: {
                fullName,
                email
            }
        },
        {new: true}
    ).select("-password -refreshToken");

    return res
            .status(200)
            .json(new ApiResponse(200, user, "Account details updated successfully!"));
})

const updateUserAvatar = asyncHandler( async (req, res) => {
    const avatarLocalPath = req.file?.path;
    if(!avatarLocalPath){
        throw new ApiError(400, "Avatar file is missing");
    }

    const user = await User.findById(req.user?._id);
    if(!user){
        throw new ApiError(404, "User not found");
    }

    if(user.avatar){
        await deleteFromCloudinary(user.avatarPublicId);
    }

    const avatar = await uploadOnCloudinary(avatarLocalPath);
    if(!avatar?.url){
        throw new ApiError(400, "Failed to upload avatar");
    }
    deleteUnusedFiles(avatarLocalPath);

    user.avatar = avatar.url;
    user.avatarPublicId = avatar.public_id;

    await user.save({validateBeforeSave: false});

    const updatedUser = await User.findById(user?._id).select("-password -refreshToken");

    return res.status(200) 
        .json(new ApiResponse(200, updatedUser, "Avatar updated successfully!"));  
})

const updateUserCoverImage = asyncHandler( async (req, res) => {
    const coverImageLocalPath = req.file?.path;
    if(!coverImageLocalPath){
        throw new ApiError(400, "Cover image file is missing");
    }

    const user = await User.findById(req.user?._id);
    if(!user){
        throw new ApiError(404, "User not found");
    }

    if(user.coverImage){
        await deleteFromCloudinary(user.coverImagePublicId);
    }

    const coverImage = await uploadOnCloudinary(coverImageLocalPath);
    if(!coverImage?.url){
        throw new ApiError(400, "Failed to upload cover image");
    }
    deleteUnusedFiles(coverImageLocalPath);

    user.coverImage = coverImage.url;

    await user.save({validateBeforeSave: false});

    const updatedUser = await User.findById(user?._id).select("-password -refreshToken");

    return res.status(200) 
        .json(new ApiResponse(200, updatedUser, "Cover image updated successfully!"));  
})

const deleteUserAccount = asyncHandler( async (req, res) => {
    const user = await User.findById(req.user?._id);
    if(!user){
        throw new ApiError(404, "User not found");
    }
    await deleteFromCloudinary(user.avatarPublicId);
    if(user.coverImage)
        await deleteFromCloudinary(user.coverImagePublicId);
    await User.findByIdAndDelete(req.user?._id);
    return res.status(200).json(new ApiResponse(200, null, "User account deleted successfully!"));  
});

const getUserChannelProfile = asyncHandler( async (req, res) => {
    const { username } = req.params;

    if(!username || username.trim() === ""){
        throw new ApiError(400, "Username is required");
    }

    const existedUser = await User.findOne({
        username: username.toLowerCase()
    })

    if(!existedUser){
        throw new ApiError(404, "user not found");
    }
    
    const channel = await User.aggregate(
        [
            {
                $match: 
                {
                    username: username.toLowerCase()
                }
            },
            {
                $lookup: {
                    from: "subscription",
                    localField: "_id",
                    foreignField: "channel",
                    as: "subscribers"
                }
            },
            {
                $lookup: {
                    from: "subscription",
                    localField: "_id",
                    foreignField: "subscriber",
                    as: "subscribedTo"
                }
            },
            {
                $addFields: {
                    subscribersCount: { $size: "$subscribers" },
                    subscribedToCount: { $size: "$subscribedTo" },
                    isSubscribed: {
                        $cond: {
                            if: { $in: [req.user?._id, "$subscribers.subscriber"] },
                            then: true,
                            else: false
                        }
                    }
                }
            },
            {
                // Project necessary fields only
                $project: {
                    fullName: 1,
                    username: 1,
                    avatar: 1,
                    coverImage: 1,
                    subscribersCount: 1,
                    subscribedToCount: 1,
                    isSubscribed: 1
                }
            }
        ]
    )

    if(!channel?.length){
        throw new ApiError(404, "Channel not found");
    }

    console.log(channel);

    return res.status(200).json(new ApiResponse(200, channel[0], "Channel profile fetched successfully!"));
});

const getWatchHistory = asyncHandler( async (req, res) => {
    const user = await User.aggregate(
        [
            {
                $match: {
                    _id: req.user?._id
                }
            },
            {
                $lookup: {
                    from: "video",
                    localField: "watchHistory",
                    foreignField: "_id",
                    as: "watchHistory",
                    pipeline: [
                        {
                            $lookup: {
                                from: "user",
                                localField: "owner",
                                foreignField: "_id",
                                as: "owner",
                                pipeline: [
                                    {
                                        $project: {
                                            fullName: 1,
                                            username: 1,
                                            avatar: 1
                                        }
                                    }
                                ]
                            }
                        },
                        {
                            $addFields: {
                                owner: {
                                    $arrayElemAt: ["$owner", 0]
                                }
                            }
                        }
                    ]
                }
            }
        ]
    )

    if(!user?.length){
        throw new ApiError(404, "User not found");
    }

    return res.status(200).json(new ApiResponse(200, user[0].watchHistory, "Watch history fetched successfully!"));
});

export {
    registerUser,
    loginUser,
    refreshAccessToken,
    logoutUser,
    changeCurrentPassword,
    getCurrentUser,
    updateAccountDetails,
    updateUserAvatar,
    updateUserCoverImage,
    deleteUserAccount,
    getUserChannelProfile,
    getWatchHistory
}