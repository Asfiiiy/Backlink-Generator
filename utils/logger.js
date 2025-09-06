const fs = require("fs");
const path = require("path");

const logFilePath = path.join(__dirname, "logs.txt");

// **Function to Log Messages**
const logToFile = (level, message) => {
    const timestamp = new Date().toISOString();
    const logMessage = `${timestamp} [${level.toUpperCase()}] ${message}\n`;

    fs.appendFileSync(logFilePath, logMessage, (err) => {
        if (err) console.error("❌ Error writing to log file:", err);
    });

    console.log(logMessage); // Also print to console
};

// **Logger Functions**
const logger = {
    info: (message) => logToFile("info", message),
    warn: (message) => logToFile("warn", message),
    error: (message) => logToFile("error", message),
};

module.exports = logger;
