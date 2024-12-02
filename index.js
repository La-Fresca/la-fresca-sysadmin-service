require("dotenv").config(); // Load environment variables
const express = require("express");
const bodyParser = require("body-parser");
const cron = require("cron");
const { Dropbox } = require("dropbox");
const fs = require("fs");
const path = require("path");
const moment = require("moment");
const jwt = require('jsonwebtoken');

const app = express();
const PORT = 3000;

// Middleware
app.use(bodyParser.json());

// JWT authentication middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    // Decode base64 secret to get the actual key bytes
    const key = Buffer.from(process.env.JWT_SECRET, 'base64');
    const decoded = jwt.verify(token, key, {
      algorithms: ['HS384']
    });
    
    if (!decoded.role || !['ADMIN', 'SYSADMIN'].includes(decoded.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    
    req.user = decoded;
    next();
  } catch (error) {
    console.error('Token verification error:', error.message);
    return res.status(403).json({ error: 'Invalid token' });
  }
};

// Backup storage location
const BACKUP_DIR = path.join(__dirname, "backups");
if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR);
}

// MongoDB URI and Dropbox Token from environment variables
const mongoURI = process.env.MONGO_URI;
const dropboxToken = process.env.DROPBOX_TOKEN;

if (!mongoURI || !dropboxToken) {
  console.error("Error: MONGO_URI and DROPBOX_TOKEN must be set in .env file.");
  process.exit(1);
}

// Utility function for MongoDB dump
const createBackup = async () => {
  const backupName = `backup_${moment().format("YYYY-MM-DD_HH-mm-ss")}.gz`;
  const backupPath = path.join(BACKUP_DIR, backupName);

  try {
    // Use `mongodump` to create the backup
    const exec = require("child_process").exec;
    await new Promise((resolve, reject) => {
      exec(
        `mongodump --uri="${mongoURI}" --archive="${backupPath}" --gzip`,
        (error, stdout, stderr) => {
          if (error) return reject(error);
          resolve(stdout || stderr);
        }
      );
    });

    console.log(`Backup created: ${backupName}`);

    // Upload the backup to Dropbox
    const dbx = new Dropbox({ accessToken: dropboxToken });
    const fileContent = fs.readFileSync(backupPath);

    await dbx.filesUpload({
      path: `/${backupName}`,
      contents: fileContent,
    });

    console.log(`Backup uploaded to Dropbox: ${backupName}`);
  } catch (error) {
    console.error("Error creating backup:", error);
    throw error;
  }

  return backupName;
};

// Utility function to list Dropbox backups
const listDropboxBackups = async () => {
  const dbx = new Dropbox({ accessToken: dropboxToken });
  try {
    const response = await dbx.filesListFolder({ path: '' });
    return response.result.entries
      .filter(entry => entry.name.endsWith('.gz'))
      .map(entry => ({
        name: entry.name,
        size: entry.size,
        modified: entry.server_modified
      }));
  } catch (error) {
    console.error("Error listing Dropbox backups:", error);
    throw error;
  }
};

// Restore utility
const restoreBackup = async (backupName) => {
  const dbx = new Dropbox({ accessToken: dropboxToken });
  const backupPath = path.join(BACKUP_DIR, backupName);

  try {
    // Download the backup from Dropbox
    const { result } = await dbx.filesDownload({ path: `/${backupName}` });
    fs.writeFileSync(backupPath, result.fileBinary);

    console.log(`Backup downloaded: ${backupName}`);

    // Restore the database
    const exec = require("child_process").exec;
    await new Promise((resolve, reject) => {
      exec(
        `mongorestore --uri="${mongoURI}" --archive="${backupPath}" --gzip --drop`,
        (error, stdout, stderr) => {
          if (error) return reject(error);
          resolve(stdout || stderr);
        }
      );
    });

    console.log(`Database restored from: ${backupName}`);
    
    // Clean up downloaded file
    fs.unlinkSync(backupPath);
  } catch (error) {
    console.error("Error restoring backup:", error);
    if (fs.existsSync(backupPath)) {
      fs.unlinkSync(backupPath);
    }
    throw error;
  }
};

// Schedule backup
let backupSchedule = null;
const scheduleBackup = (interval) => {
  if (backupSchedule) {
    backupSchedule.stop();
  }

  let cronTime;
  switch (interval) {
    case "daily":
      cronTime = "0 0 * * *"; // Every day at midnight
      break;
    case "weekly":
      cronTime = "0 0 * * 0"; // Every Sunday at midnight
      break;
    case "monthly":
      cronTime = "0 0 1 * *"; // 1st of every month at midnight
      break;
    default:
      throw new Error("Invalid interval. Use daily, weekly, or monthly.");
  }

  backupSchedule = new cron.CronJob(cronTime, async () => {
    try {
      await createBackup();
    } catch (error) {
      console.error("Scheduled backup failed:", error);
    }
  });

  backupSchedule.start();
  console.log(`Backup scheduled: ${interval}`);
};

// Routes
app.post("/schedule", authenticateToken, (req, res) => {
  const { interval } = req.body;
  try {
    scheduleBackup(interval);
    res.status(200).send(`Backup schedule set to ${interval}`);
  } catch (error) {
    res.status(400).send(error.message);
  }
});

app.get("/backups", authenticateToken, async (req, res) => {
  try {
    const backups = await listDropboxBackups();
    res.status(200).json(backups);
  } catch (error) {
    res.status(500).send(error.message);
  }
});

app.post("/backup", authenticateToken, async (req, res) => {
  try {
    const backupName = await createBackup();
    res.status(200).send(`Backup created: ${backupName}`);
  } catch (error) {
    res.status(500).send(error.message);
  }
});

app.post("/restore", authenticateToken, async (req, res) => {
  const { backupName } = req.body;
  try {
    await restoreBackup(backupName);
    res.status(200).send(`Database restored from: ${backupName}`);
  } catch (error) {
    res.status(500).send(error.message);
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Backup service running on port ${PORT}`);
});
