const { google } = require("googleapis");
require("dotenv").config();

// **Load Service Account Credentials**
const GOOGLE_CREDENTIALS_PATH = process.env.GOOGLE_CREDENTIALS_PATH || "../config/google_service_account.json";

const authenticateGoogle = async () => {
    try {
        // **Authenticate with Google API**
        const auth = new google.auth.GoogleAuth({
            keyFile: GOOGLE_CREDENTIALS_PATH,
            scopes: ["https://www.googleapis.com/auth/webmasters.readonly"],
        });

        const client = await auth.getClient();
        const searchConsole = google.searchconsole({ version: "v1", auth: client });

        // **Fetch list of sites**
        const response = await searchConsole.sites.list();
        console.log("✅ Google API Authentication Successful!");
        console.log("🔗 Verified Sites in Search Console:", response.data.siteEntry);
    } catch (error) {
        console.error("❌ Google API Authentication Failed:", error.message);

        // **Detailed Error Logging**
        if (error.errors) {
            console.error("Error Details:", error.errors);
        }

        // **Check for JWT Errors**
        if (error.message.includes("invalid_grant")) {
            console.error("⚠️ Possible Causes:");
            console.error("- System clock is out of sync.");
            console.error("- Service account credentials are invalid or expired.");
            console.error("- JWT token is expired or malformed.");
        }
    }
};

// **Run Authentication Test**
authenticateGoogle();