const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const cors = require('cors');
const https = require('https');
const fetch = require('node-fetch');
const CredentialsManager = require('../utils/credentialsManager');

// Load credentials for client ID and other values
const credentials = CredentialsManager.loadCredentials();

// Common webhook headers
const WEBHOOK_HEADERS = {
    'User-Agent': 'Zoom Marketplace/1.0a',
    'Content-Type': 'application/json; charset=utf-8',
    'clientid': credentials.auth_credentials[0].client_id,
    'authorization': `Bearer ${credentials.auth_credentials[0].client_secret}`,
};

// Function to generate Zoom webhook headers with dynamic values
const generateWebhookHeaders = (body) => {
    const timestamp = Date.now();
    const message = `v0:${timestamp}:${JSON.stringify(body)}`;
    const hashForValidate = crypto
        .createHmac('sha256', credentials.webhookToken)
        .update(message)
        .digest('hex');
    const signature = `v0=${hashForValidate}`;

    return {
        ...WEBHOOK_HEADERS,
        'x-zm-signature': signature,
        'x-zm-request-timestamp': timestamp,
        'x-zm-trackingid': crypto.randomBytes(16).toString('hex'),
        'Content-Length': Buffer.byteLength(JSON.stringify(body))
    };
};

const router = express.Router();

// Add middleware
router.use(cors());
router.use(express.json());

// Create a custom HTTPS agent that ignores SSL certificate validation
const httpsAgent = new https.Agent({
    rejectUnauthorized: false
});

// Add webhook validation endpoint
router.post("/validate-webhook", async (req, res) => {
    console.log("Received validation request for webhook URL:", req.body.webhookUrl);
    const { webhookUrl } = req.body;
    const plainToken = crypto.randomBytes(16).toString("base64");

    const validationBody = {
        event: "endpoint.url_validation",
        payload: {
            plainToken: plainToken,
        },
        event_ts: Date.now(),
    };

    try {
        console.log("Attempting to validate webhook at URL:", webhookUrl);
        const validationResponse = await fetch(webhookUrl, {
            method: "POST",
            headers: generateWebhookHeaders(validationBody),
            body: JSON.stringify(validationBody),
            agent: httpsAgent,
            timeout: 5000
        });

        console.log("Validation response status:", validationResponse.status);

        if (!validationResponse.ok) {
            console.log("Validation failed with status:", validationResponse.status);
            return res.json({
                success: false,
                error: `Webhook endpoint returned error ${validationResponse.status}`,
            });
        }

        const data = await validationResponse.json();
        console.log("Validation response data:", data);

        // Verify the response
        const expectedHash = crypto
            .createHmac("sha256", credentials.webhookToken)
            .update(plainToken)
            .digest("hex");

        if (data.plainToken === plainToken && data.encryptedToken === expectedHash) {
            console.log("Validation successful");
            res.json({ success: true });
        } else {
            console.log("Invalid validation response");
            res.json({ success: false, error: "Invalid validation response" });
        }
    } catch (error) {
        console.error("Validation error:", error);
        res.json({ 
            success: false, 
            error: error.message,
            details: error.cause ? error.cause.message : 'No additional details'
        });
    }
});

router.post("/send-webhook", async (req, res) => {
    const { webhookUrl, isNewMeeting, existingPayload } = req.body;
    
    try {
        let payload;
        if (isNewMeeting || !existingPayload) {
            // Generate new payload for new meetings
            const credentials = CredentialsManager.loadCredentials();
            const credential = getRandomEntry(credentials.auth_credentials);
            const meetingInfo = getRandomEntry(credentials.stream_meeting_info);

            payload = {
                event: "meeting.rtms.started",
                event_ts: Date.now(),
                payload: {
                    meeting_uuid: meetingInfo.meeting_uuid,
                    rtms_stream_id: meetingInfo.rtms_stream_id,
                    server_urls: "ws://0.0.0.0:9092"
                }
            };
        } else {
            payload = existingPayload;
        }

        const response = await fetch(webhookUrl, {
            method: "POST",
            headers: generateWebhookHeaders(payload),
            body: JSON.stringify(payload),
            agent: httpsAgent,
            timeout: 5000
        });

        let responseData;
        const contentType = response.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
            responseData = await response.json();
        } else {
            responseData = await response.text();
        }

        res.json({
            success: response.ok,
            status: response.status,
            sent: payload,
            response: responseData,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
            details: error.cause ? error.cause.message : 'No additional details',
            attempted_payload: payload,
        });
    }
});

function getRandomEntry(array) {
    return array[Math.floor(Math.random() * array.length)];
}

module.exports = router;