const { google } = require("googleapis");
const db = require("../config/db");
const fs = require("fs");
require("dotenv").config();

// **Path to Google Service Account JSON Key File**
const GOOGLE_CREDENTIALS_PATH = "./config/google_service_account.json"; // Ensure this path is correct

// **Authenticate with Google API**
const authenticateGoogle = () => {
    return new google.auth.GoogleAuth({
        keyFile: GOOGLE_CREDENTIALS_PATH,
        scopes: ["https://www.googleapis.com/auth/webmasters.readonly"],
    });
};

// **Function to Check if a Backlink is Indexed**
const checkBacklinkIndexing = async () => {
    const auth = await authenticateGoogle();
    const searchConsole = google.searchconsole({ version: "v1", auth });

    db.query(
        `SELECT id, backlink_url FROM backlinks WHERE indexed_status = 'unknown' LIMIT 10`,
        async (err, results) => {
            if (err) {
                console.error("❌ Database error fetching backlinks:", err);
                return;
            }

            for (const backlink of results) {
                try {
                    const request = {
                        siteUrl: "sc-domain:yourwebsite.com", // Replace with the Search Console domain
                        url: backlink.backlink_url,
                    };

                    const response = await searchConsole.urlInspection.index.inspect(request);
                    const isIndexed =
                        response.data.inspectionResult.indexStatusResult.verdict === "PASS"
                            ? "indexed"
                            : "not_indexed";

                    db.query(
                        `UPDATE backlinks SET indexed_status = ?, checked_at = NOW() WHERE id = ?`,
                        [isIndexed, backlink.id],
                        (err) => {
                            if (err) {
                                console.error(`❌ Error updating indexing status for ${backlink.backlink_url}:`, err);
                            } else {
                                console.log(`✅ Checked backlink: ${backlink.backlink_url}, Indexed: ${isIndexed}`);
                            }
                        }
                    );
                } catch (error) {
                    console.error(`❌ Error checking backlink indexing for ${backlink.backlink_url}:`, error.message);
                }
            }
        }
    );
};

// **Run the Index Check**
checkBacklinkIndexing();
