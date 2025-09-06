const express = require("express");
const { registerUser, loginUser, getUserProfile } = require("../controllers/userController");
const { submitWebsite, getUserWebsites, getNiches } = require("../controllers/websiteController");
const { getBacklinkIndexStatus, getBacklinks, createBacklink } = require("../controllers/backlinkController"); // ✅ Fixed duplicate import

const { protect } = require("../middleware/authMiddleware");

const router = express.Router();

// **User Authentication Routes**
router.post("/register", registerUser);
router.post("/login", loginUser);
router.get("/profile", protect, getUserProfile);

// **Website Submission & Niches**
router.get("/niches", getNiches); // ✅ Fetch available niches
router.post("/submit-website", protect, submitWebsite);
router.get("/my-websites", protect, getUserWebsites);

// **Backlink Generation & Tracking**
router.post("/generate-backlink", protect, createBacklink); // ✅ Changed from `generateBacklink` to `createBacklink`
router.get("/my-backlinks", protect, getBacklinks);
router.get("/backlinks/index-status", protect, getBacklinkIndexStatus); // ✅ Ensured it requires authentication

module.exports = router;
