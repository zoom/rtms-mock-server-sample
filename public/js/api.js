class APIHandler {
    static async validateWebhook() {
        try {
            const webhookUrl = document.getElementById("webhookUrl").value;
            console.log("Validating webhook URL:", webhookUrl);

            const response = await fetch("/api/validate-webhook", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ webhookUrl }),
            });

            const data = await response.json();
            console.log("Validation response:", data);

            if (data.success) {
                document.getElementById("response").innerHTML = "Webhook validated successfully!";
                document.getElementById("sendBtn").disabled = false;
            } else {
                document.getElementById("response").innerHTML = `Validation failed: ${data.error}`;
                document.getElementById("sendBtn").disabled = true;
            }
        } catch (error) {
            console.error("Validation error:", error);
            document.getElementById("response").innerHTML = `Error: ${error.message}`;
        }
    }

    static async sendWebhook() {
        try {
            const webhookUrl = document.getElementById("webhookUrl").value;
            console.log("Sending webhook to URL:", webhookUrl);

            const response = await fetch("/api/send-webhook", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ webhookUrl }),
            });

            const data = await response.json();
            document.getElementById("response").innerHTML = `<pre>${JSON.stringify(data, null, 2)}</pre>`;

            if (data.success && data.sent.payload.payload.object.server_urls) {
                await MediaHandler.startMediaStream(data.sent.payload.payload.object.server_urls);
            }
        } catch (error) {
            console.error("Send webhook error:", error);
            document.getElementById("response").innerHTML = `Error: ${error.message}`;
        }
    }
} 