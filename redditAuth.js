const snoowrap = require("snoowrap");
require("dotenv").config();

// **Reddit API Credentials**
const redditClient = new snoowrap({
    userAgent: process.env.REDDIT_USER_AGENT,
    clientId: process.env.REDDIT_CLIENT_ID,
    clientSecret: process.env.REDDIT_CLIENT_SECRET,
    username: process.env.REDDIT_USERNAME,
    password: process.env.REDDIT_PASSWORD,
});

// **Function to Authenticate**
const authenticateReddit = async () => {
    try {
        const me = await redditClient.getMe();
        console.log(`✅ Reddit Authentication Successful! Logged in as: ${me.name}`);
    } catch (error) {
        console.error("❌ Reddit Authentication Failed:", error.message);
    }
};

// **Run Authentication**
authenticateReddit();
