import * as https from "https";
import * as querystring from "querystring";
import { WebSocketServer, WebSocket } from 'ws';
import * as fs from "fs";
import { CONFIG } from './config';
import { sessions, createOrUpdateSession, getSession, deleteSession } from './session';
import { fetchMenu, findCustomer, findRestaurant } from './api';
import { connectToAgent, buildDynamicPrompt } from './agent';
import { getNationalNumber } from './utils';
import { SessionState } from "./types";

const twilio = require("twilio");
const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH);

const server = https.createServer({
    cert: fs.readFileSync('./cert.pem'),
    key: fs.readFileSync('./key.pem'),
}, (req, res) => {
    if (req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('Hello');
    }
    else if (req.url === '/api/twilio' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });

        req.on('end', async () => {
            console.log("Hello - Twilio POST received");
            const parsed = querystring.parse(body);
            const callSid = parsed.CallSid as string;
            console.log('Here before parsing numbers');
            const restaurantNo = (parsed.To as string).replace('+', '');
            const customerPhone = (parsed.From as string).replace('+', '');
            let session:SessionState;

            if (restaurantNo) {
                try {
                    let restro = await findRestaurant(restaurantNo);
                    console.log(restro, "restro");
                    

                    if (!restro.data.active) {
                        const twilioResponse = `<?xml version="1.0" encoding="UTF-8"?>
                        <Response>
                        <Reject reason="busy"/>
                        </Response>`;
                        res.writeHead(200, { 'Content-Type': 'application/xml' });
                        res.end(twilioResponse);
                        return;
                    }
                    const newSession = createOrUpdateSession(callSid, restaurantNo, customerPhone, restro.data as Record<string, unknown>);
                    newSession.restaurantName = restro.data?.name || undefined;
                    session = newSession;
                } catch (error) {
                    console.log(error, "Error");
                    if (!session) {
                        session = createOrUpdateSession(callSid, restaurantNo, customerPhone, {});
                    }
                }

                if (session) {
                    fetchMenu(restaurantNo)
                        .then(menu => session.storedMenu = menu)
                        .catch(error => {
                            console.error('Error fetching menu:', error);
                        });
                }
            }

            if (customerPhone && session) {
                try {
                    let customer = await findCustomer(customerPhone, restaurantNo);
                    console.log(customer, "Customer");
                    session.storedCustomer = customer;
                } catch (error) {
                    session.storedCustomer = null;
                    console.log(error, "Error");
                }
            }

            const twilioResponse = `<?xml version="1.0" encoding="UTF-8"?>
                <Response>
                    <Connect>
                        <Stream url="${CONFIG.WSS_BACKEND_BASE_URL}">
                            <Parameter name="callSid" value="${callSid}" />
                        </Stream>
                    </Connect>
                </Response>`;

            try {
                if (session && session.customerPhone && session.restaurantNo) {
                    setTimeout(async () => {
                        const recording = await client.calls(callSid).recordings.create({
                            recordingStatusCallback: `${CONFIG.API_BASE_URL}/api/recording?from=${encodeURIComponent(session.customerPhone)}&to=${encodeURIComponent(session.restaurantNo)}`
                        });
                        console.log("🎙️ Recording started:", recording.sid);
                    }, CONFIG.RECORDING_DELAY_MS);
                }
            } catch (err) {
                console.error("❌ Error starting recording:", err);
            }

            console.log('Twilio response:', twilioResponse);
            res.writeHead(200, { 'Content-Type': 'application/xml' });
            res.end(twilioResponse);
        });
    }
    else {
        res.writeHead(404);
        res.end();
    }
});

export const wss = new WebSocketServer({ server });

export function setupWebSocketServer(): void {
    wss.on('connection', async (ws, request) => {
        let boundSession: any = null;

        ws.on('message', async (message: Buffer) => {
            try {
                const data = JSON.parse(message.toString());

                if (data.event === 'start') {
                    const streamSid = data.start.streamSid as string;
                    const params = (data.start.customParameters || {}) as Record<string, string>;
                    const callSid = params.callSid as string;

                    if (!callSid) {
                        console.error('Missing callSid in customParameters');
                        return;
                    }

                    const session = getSession(callSid);
                    if (!session) {
                        console.error(`No session found for CallSid ${callSid}`);
                        return;
                    }

                    session.streamSid = streamSid;
                    session.ws = ws;
                    boundSession = session;

                    const updatedPrompt = buildDynamicPrompt(session);

                    try {
                        const agent: any = await connectToAgent(updatedPrompt, session);
                        session.agent = agent;
                    } catch (error) {
                        console.error('Failed to initialize Deepgram agent:', error);
                        session.agent = null;
                    }
                    return;
                }

                if (data.event === 'media' && data.media?.payload) {
                    const payload = Buffer.from(data.media.payload, 'base64');

                    if (!boundSession) {
                        return;
                    }

                    if (!boundSession.agent || !boundSession.agentReady) {
                        if (boundSession.pendingAudio.length < CONFIG.MAX_PENDING_AUDIO) {
                            boundSession.pendingAudio.push(payload);
                        }
                        return;
                    }

                    boundSession.agent.sendMedia(payload);
                } else if (data.event === 'stop') {
                    console.log('Twilio stream stopped');
                } else {
                    console.log('Unhandled Twilio websocket event:', data.event);
                }
            } catch (error) {
                console.error('Message error:', error instanceof Error ? error.message : 'Unknown error');
            }
        });

        ws.on('close', async () => {
            if (boundSession?.agent) {
                boundSession.agent.close();
            }
            if (boundSession?.callSid) {
                deleteSession(boundSession.callSid);
            }
        });

        ws.on('error', (error) => {
            console.error('WebSocket error:', error);
        });
    });

    wss.on('listening', () => {
        console.log(`WebSocket server is listening on port ${CONFIG.PORT}`);
    });

    server.listen(CONFIG.PORT, () => {
        console.log(`Listening on wss://localhost:${CONFIG.PORT}`);
    });
}

export function setupGracefulShutdown(): void {
    process.on('SIGINT', async () => {
        console.log('\nReceived SIGINT. Closing server gracefully...');
        wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.close(1000, 'Server shutting down');
            }
        });
        wss.close(() => {
            console.log('WebSocket server closed');
        });
        server.close(() => {
            console.log('HTTPS server closed');
            process.exit(0);
        });
    });

    process.on('SIGTERM', async () => {
        console.log('\nReceived SIGTERM. Closing server gracefully...');
        wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.close(1000, 'Server shutting down');
            }
        });
        wss.close(() => {
            console.log('WebSocket server closed');
        });
        server.close(() => {
            console.log('HTTPS server closed');
            process.exit(0);
        });
    });

    process.on('uncaughtException', (error) => {
        console.error('Uncaught Exception:', error);
        wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.close(1011, 'Server error');
            }
        });
        wss.close(() => {
            console.log('HTTPS server closed due to error');
        });
        server.close(() => {
            console.log('HTTPS server closed due to error');
            process.exit(1);
        });
    });

    process.on('unhandledRejection', (reason, promise) => {
        console.error('Unhandled Rejection at:', promise, 'reason:', reason);
        wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.close(1011, 'Server error');
            }
        });
        wss.close(() => {
            console.log('HTTPS server closed due to error');
        });
        server.close(() => {
            console.log('HTTPS server closed due to error');
            process.exit(1);
        });
    });
}