import { DeepgramClient } from '@deepgram/sdk';
import { WebSocketServer, WebSocket } from 'ws';
import 'dotenv/config';
import axios from 'axios';
import parsePhoneNumber from 'libphonenumber-js'
import * as fs from "fs";
import * as https from "https";
import * as http from "http";
import * as querystring from "querystring";
const twilio = require("twilio");
import { sendOrderPlacedMessage } from './twilio-sms';



const deepgram = new DeepgramClient({ apiKey: process.env.DEEPGRAM_API_KEY });
const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH);

// let API_BASE_URL = "http://127.0.0.1:5002"
// let API_BASE_URL = "https://q6f1bmhp-5002.inc1.devtunnels.ms"
// let WSS_BACKEND_BASE_URL = "wss://q6f1bmhp-443.inc1.devtunnels.ms"

// let API_BASE_URL = "https://q6f1bmhp-5002.inc1.devtunnels.ms"
// let WSS_BACKEND_BASE_URL = "wss://q6f1bmhp-443.inc1.devtunnels.ms"

let API_BASE_URL = "https://ptmq4121-5002.inc1.devtunnels.ms"
let WSS_BACKEND_BASE_URL = "wss://ptmq4121-443.inc1.devtunnels.ms"


function getNationalNumber(phone: unknown): string | undefined {
    if (typeof phone === 'string') {
        const phno = parsePhoneNumber(phone, 'US');
        return phno ? phno.countryCallingCode + phno.nationalNumber : phone;
    }
    return undefined;
}
type SessionState = {
    callSid: string;
    streamSid: string | null;
    ws: WebSocket | null;
    restaurantNo: string | undefined;
    restaurantName?: string | undefined;
    customerPhone: string | undefined;
    storedMenu: any; // { data: [] }
    storedCustomer: any; // object or null
    agent: any | null;
    agentReady: boolean;
    pendingAudio: Buffer[];
};

const sessions = new Map<string, SessionState>();

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
            body += chunk.toString(); // collect data
        });

        req.on('end', async () => {
            console.log("Hello - Twilio POST received");
            const parsed = querystring.parse(body);
            // Extract CallSid from Twilio request
            const callSid = parsed.CallSid as string;
            console.log('Here before parsing numbers');
            console.log(parsed.To, "To");
            console.log(parsed.From, "From");
            const restaurantNo = (parsed.To as string).replace('+','')
            const customerPhone = (parsed.From as string).replace('+','');
          
            // Initialize per-call session
            const existing = sessions.get(callSid);
            const session: SessionState = existing ?? {
                callSid,
                streamSid: null,
                ws: null,
                restaurantNo,
                // restaurantName,
                customerPhone,
                storedMenu: { data: [] },
                storedCustomer: null,
                agent: null,
                agentReady: false,
                pendingAudio: []
            };
            session.restaurantNo = restaurantNo;
            session.customerPhone = customerPhone;
            session.agentReady = false;
            session.pendingAudio = [];
            sessions.set(callSid, session);

            // Kick off data fetches for this session
            if (session.restaurantNo) {
                try {
                    let restro = await findRestaurant(session.restaurantNo)
                    console.log(restro, "restro");
                    session.restaurantName = restro.data?.name || undefined;

                    if (!restro.data.active) {
                        const twilioResponse = `<?xml version="1.0" encoding="UTF-8"?>
                        <Response>
                        <Reject reason="busy"/>
                        </Response>`;
                        res.writeHead(200, { 'Content-Type': 'application/xml' });
                        res.end(twilioResponse);
                        return
                    }
                } catch (error) {
                    console.log(error, "Error");

                }
                // let menu = await 
                fetchMenu(session.restaurantNo)
                    .then(menu => session.storedMenu = menu)
                    .catch(error => {
                        console.error('Error fetching menu:', error);
                    });
            }
            if (session.customerPhone) {
                try {
                    let customer = await findCustomer(session.customerPhone, session.restaurantNo)
                    console.log(customer, "Customer");
                    session.storedCustomer = customer
                    //                     if (!customer.customer.active) {
                    //                         const twilioResponse = `<?xml version="1.0" encoding="UTF-8"?>
                    // <Response>
                    //   <Reject reason="busy"/>
                    // </Response>`;
                    //                         res.writeHead(200, { 'Content-Type': 'application/xml' });
                    //                         res.end(twilioResponse);
                    //                         return
                    //                     }
                } catch (error) {
                    session.storedCustomer = null;
                    console.log(error, "Error");

                }

                //     .then(customerResult => {
                //     })
                //     .catch(error => {
                //         console.error('Background customer fetch error:', (error as any)?.data ?? error);
                //     });
            }

            //             const twilioResponse = `<?xml version="1.0" encoding="UTF-8"?>
            // <Response>
            //   <Connect>
            //     <Stream url="wss://q6f1bmhp-443.inc1.devtunnels.ms">
            //       <Parameter name="callSid" value="${callSid}" />
            //     </Stream>
            //   </Connect>
            // </Response>`;

                const twilioResponse = `<?xml version="1.0" encoding="UTF-8"?>
                    <Response>
                        <Connect>
                            <Stream url="${WSS_BACKEND_BASE_URL}">
                                <Parameter name="callSid" value="${callSid}" />
                            </Stream>
                        </Connect>
                    </Response>`;

            // ✅ Start recording call via REST API
            try {
                setTimeout(async () => {
                    if (session.customerPhone && session.restaurantNo) {
                        const recording = await client.calls(callSid).recordings.create({
                            // recordingStatusCallback: `${API_BASE_URL}/api/recording`
                            recordingStatusCallback: `${API_BASE_URL}/api/recording?from=${encodeURIComponent(session.customerPhone)}&to=${encodeURIComponent(session.restaurantNo)}`
                        });
                        console.log("🎙️ Recording started:", recording.sid);
                    }
                }, 2000)

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


// const server = http.createServer((req, res) => {
//     if (req.url === '/') {
//         res.writeHead(200, { 'Content-Type': 'text/plain' });
//         res.end('Hello');
//     }
//     else if (req.url === '/api/twilio' && req.method === 'POST') {
        
//         let body = '';
//         req.on('data', chunk => {
//             body += chunk.toString(); // collect data
//         });

//         req.on('end', async () => {
//             console.log("Hello - Twilio POST received");
//             const parsed = querystring.parse(body);
//             // Extract CallSid from Twilio request
//             const callSid = parsed.CallSid as string;
//             const restaurantNo = getNationalNumber(parsed.To);
//             const customerPhone = getNationalNumber(parsed.From);
//             console.log(` Restaurant: ${restaurantNo}, Customer: ${customerPhone}`);

//             // Initialize per-call session
//             const existing = sessions.get(callSid);
//             const session: SessionState = existing ?? {
//                 callSid,
//                 streamSid: null,
//                 ws: null,
//                 restaurantNo,
//                 customerPhone,
//                 storedMenu: { data: [] },
//                 storedCustomer: null,
//                 agent: null
//             };
//             session.restaurantNo = restaurantNo;
//             session.customerPhone = customerPhone;
//             sessions.set(callSid, session);

//             // Kick off data fetches for this session
//             if (session.restaurantNo) {
//                 try {
//                     let restro = await findRestaurant(session.restaurantNo)
//                     // console.log(restro, "restro");
//                     session.restaurantName = restro.data?.name || undefined;
//                     if (!restro.data.active) {
//                         const twilioResponse = `<?xml version="1.0" encoding="UTF-8"?>
// <Response>
//   <Reject reason="busy"/>
// </Response>`;
//                         res.writeHead(200, { 'Content-Type': 'application/xml' });
//                         res.end(twilioResponse);
//                         return
//                     }
//                 } catch (error) {
//                     console.log(error, "Error");

//                 }
//                 // let menu = await 
//                 fetchMenu(session.restaurantNo)
//                     .then(menu => session.storedMenu = menu)
//                     .catch(error => {
//                         console.error('Error fetching menu:', error);
//                     });
//             }
//             if (session.customerPhone) {
//                 try {
//                     let customer = await findCustomer(session.customerPhone, session.restaurantNo)
//                     console.log(customer, "Customer");
//                     session.storedCustomer = customer
//                     //                     if (!customer.customer.active) {
//                     //                         const twilioResponse = `<?xml version="1.0" encoding="UTF-8"?>
//                     // <Response>
//                     //   <Reject reason="busy"/>
//                     // </Response>`;
//                     //                         res.writeHead(200, { 'Content-Type': 'application/xml' });
//                     //                         res.end(twilioResponse);
//                     //                         return
//                     //                     }
//                 } catch (error) {
//                     session.storedCustomer = null;
//                     console.log(error, "Error");

//                 }

//                 //     .then(customerResult => {
//                 //     })
//                 //     .catch(error => {
//                 //         console.error('Background customer fetch error:', (error as any)?.data ?? error);
//                 //     });
//             }

//             //             const twilioResponse = `<?xml version="1.0" encoding="UTF-8"?>
//             // <Response>
//             //   <Connect>
//             //     <Stream url="wss://q6f1bmhp-443.inc1.devtunnels.ms">
//             //       <Parameter name="callSid" value="${callSid}" />
//             //     </Stream>
//             //   </Connect>
//             // </Response>`;

//                 const twilioResponse = `<?xml version="1.0" encoding="UTF-8"?>
// <Response>
//     <Connect>
//         <Stream url="${WSS_BACKEND_BASE_URL}">
//             <Parameter name="callSid" valconfigue="${callSid}" />
//         </Stream>
//     </Connect>
// </Response>`;

//             // ✅ Start recording call via REST API
//             try {
//                 setTimeout(async () => {
//                     if (session.customerPhone && session.restaurantNo) {
//                         const recording = await client.calls(callSid).recordings.create({
//                             // recordingStatusCallback: `${API_BASE_URL}/api/recording`
//                             recordingStatusCallback: `${API_BASE_URL}/api/recording?from=${encodeURIComponent(session.customerPhone)}&to=${encodeURIComponent(session.restaurantNo)}`
//                         });
//                         console.log("🎙️ Recording started:", recording.sid);
//                     }
//                 }, 2000)

//             } catch (err) {
//                 console.error("❌ Error starting recording:", err);
//             }

//             console.log('Twilio response:', twilioResponse);
//             res.writeHead(200, { 'Content-Type': 'application/xml' });
//             res.end(twilioResponse);
//         });
//     }
//     else {
//         res.writeHead(404);
//         res.end();
//     }
// });

const wss = new WebSocketServer({ server });

async function fetchMenu(callId: string) {
    try {
        // callId here is actually restaurantNo in our usage; keeping existing signature to minimize changes
        const url = `${API_BASE_URL}/api/menu-items?no=${callId}`
        console.log(`Fetching menu for call ${callId}:`, url);

        const response: any = await axios.get(url);
        const data = response.data.data;

        const modifiedData = data.map((d: any) => ({
            id: d.id,
            menuUID: d.menuUID,
            name: d.name,
            price: d.price
        }))
        return modifiedData;
    } catch (error) {
        console.error('Menu API Error:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            data: []
        };
    }
}

async function findCustomer(phone: string | undefined, restaurantNo: string | undefined) {
    try {
        let url = `${API_BASE_URL}/api/customers?phone=${phone}&restaurantNo=${restaurantNo}`;
        console.log(`Looking up customer:`, url);

        const response: any = await axios.get(url);
        const data = response.data;

        return data || null;
    } catch (error: any) {
        console.error('Customer lookup Error:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            data: null
        };
    }
}

async function findRestaurant(phone: string | undefined) {
    try {
        let url = `${API_BASE_URL}/api/restaurant/${phone}`;
        console.log(`Looking up restaurant:`, url);

        const response: any = await axios.get(url);
        const data = response.data;

        return data || null;
    } catch (error: any) {
        console.error('Restaurant lookup Error:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            data: null
        };
    }
}

async function forwardAgentAudioToTwilio(audio: unknown, session: SessionState) {
    let buffer: Buffer | null = null;

    if (Buffer.isBuffer(audio)) {
        buffer = audio;
    } else if (audio instanceof ArrayBuffer) {
        buffer = Buffer.from(audio);
    } else if (ArrayBuffer.isView(audio)) {
        buffer = Buffer.from(audio.buffer, audio.byteOffset, audio.byteLength);
    } else if (typeof Blob !== 'undefined' && audio instanceof Blob) {
        buffer = Buffer.from(await audio.arrayBuffer());
    }

    if (!buffer || session.ws?.readyState !== WebSocket.OPEN || !session.streamSid) {
        return;
    }

    session.ws.send(JSON.stringify({
        event: 'media',
        streamSid: session.streamSid,
        media: {
            payload: buffer.toString('base64')
        }
    }));
}

const humanLikeFunctions = [
    {
        "name": "end_conversation",
        "description": "End conversation naturally when customer indicates they're done (goodbye, thanks, that's all, etc.)",
        "parameters": {
            "type": "object",
            "properties": {
                "reason": {
                    "type": "string",
                    "description": "Why the conversation is ending"
                }
            },
            "required": ["reason"]
        }
    },
    {
        "name": "placeOrder",
        "description": "Submit the complete order to the kitchen - make sure everything is perfect!",
        "parameters": {
            "type": "object",
            "properties": {
                "customerName": {
                    "type": "string",
                    "description": "Customer's name (only needed for new customers)"
                },
                "customerPhone": {
                    "type": "string",
                    "description": "Phone number (usually already have this)"
                },
                "customerEmail": {
                    "type": "string",
                    "description": "Email if they want receipts/updates"
                },
                "orderType": {
                    "type": "string",
                    "enum": ["dine-in", "takeaway", "delivery"],
                    "description": "How they want their food - eating here, taking out, or delivery"
                },
                "tableNumber": {
                    "type": "string",
                    "description": "Table number for dine-in orders"
                },
                "deliveryAddress": {
                    "type": "object",
                    "description": "Where to deliver (only for delivery orders)",
                    "properties": {
                        "street": { "type": "string" },
                        "city": { "type": "string" },
                        "zipCode": { "type": "string" },
                        "specialInstructions": { "type": "string", "description": "Delivery notes like 'ring doorbell', 'leave at door'" }
                    },
                    "required": ["street", "city", "zipCode"]
                },
                "orderItems": {
                    "type": "array",
                    "description": "Everything they want to eat - must include exact details from menu",
                    "items": {
                        "type": "object",
                        "properties": {
                            "id": {
                                "type": "integer",
                                "description": "Menu item ID number (from fetchMenu)"
                            },
                            "menuUID": {
                                "type": "string",
                                "description": "Menu item menuUID (from fetchMenu)"
                            },
                            "menuItemName": {
                                "type": "string",
                                "description": "Exact name from menu (from fetchMenu)"
                            },
                            "quantity": {
                                "type": "integer",
                                "minimum": 1,
                                "description": "How many they want"
                            },
                            "price": {
                                "type": "number",
                                "description": "Price per item (from fetchMenu)"
                            },
                            "size": {
                                "type": "string",
                                "enum": ["small", "medium", "large", "extra-large"],
                                "description": "Size if applicable"
                            },
                            // "customizations": {
                            //     "type": "array",
                            //     "items": {"type": "string"},
                            //     "description": "Special requests like 'no onions', 'extra cheese'"
                            // },
                            "notes": {
                                "type": "string",
                                "description": "Any special instructions for this item"
                            }
                        },
                        "required": ["id", "menuUID", "menuItemName", "quantity", "price"]
                    }
                },
                "specialRequests": {
                    "type": "string",
                    "description": "Any special notes for the whole order"
                },
                "isConfirmed": {
                    "type": "boolean",
                    "description": "Customer has confirmed they want to place this order"
                }
            },
            "required": ["customerName", "orderItems", "isConfirmed"]
        }
    }
];
async function connectToAgent(prompt: string, session: SessionState) {
    try {
        const apiKey = process.env.DEEPGRAM_API_KEY;
        if (!apiKey) {
            throw new Error('DEEPGRAM_API_KEY is not configured');
        }

        const agent = await deepgram.agent.v1.connect({
            Authorization: `Token ${apiKey}`,
        });

        let keepAliveTimer: NodeJS.Timeout | null = null;

        agent.on('open', () => {
            console.log('✅ Agent websocket opened');
        });

        agent.on('message', async (message: any) => {
            const isBinaryAudio =
                Buffer.isBuffer(message) ||
                message instanceof ArrayBuffer ||
                ArrayBuffer.isView(message) ||
                (typeof Blob !== 'undefined' && message instanceof Blob);

            if (isBinaryAudio) {
                await forwardAgentAudioToTwilio(message, session);
                return;
            }

            switch (message?.type) {
                case 'Welcome':
                    console.log('✅ Agent connected', message.request_id);
                    break;
                case 'SettingsApplied':
                    console.log('⚙️ Agent settings applied');
                    session.agentReady = true;
                    while (session.pendingAudio.length > 0) {
                        const chunk = session.pendingAudio.shift();
                        if (!chunk) {
                            break;
                        }
                        agent.sendMedia(chunk);
                    }
                    break;
                case 'ConversationText':
                    console.log(`🧠 ${message.role}:`, message.content);
                    break;
                case 'AgentThinking':
                    console.log('🤔 Agent thinking:', message.content);
                    break;
                case 'FunctionCallRequest': {
                    const fn = message.functions?.[0];
                    if (!fn) {
                        return;
                    }

                    const functionName = fn.name;
                    const functionId = fn.id;
                    let responsePayload: any = {};

                    try {
                        if (functionName === 'placeOrder') {
                            const args = JSON.parse(fn.arguments || '{}');

                            const orderResponse = await fetch(`${API_BASE_URL}/api/create-order`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    ...args,
                                    restaurantNo: session.restaurantNo
                                })
                            });

                            const result = await orderResponse.json();

                            responsePayload = {
                                success: true,
                                orderId: result.data?.id
                            };
                        }

                        if (functionName === 'end_conversation') {
                            responsePayload = {
                                success: true,
                                message: 'Goodbye!'
                            };
                        }

                        agent.sendFunctionCallResponse({
                            type: 'FunctionCallResponse',
                            id: functionId,
                            name: functionName,
                            content: JSON.stringify(responsePayload)
                        });

                        if (functionName === 'end_conversation') {
                            setTimeout(() => {
                                agent.close();
                                session.ws?.close();
                            }, 2000);
                        }
                    } catch (err: any) {
                        console.error('Function error:', err);

                        agent.sendFunctionCallResponse({
                            type: 'FunctionCallResponse',
                            id: functionId,
                            name: functionName,
                            content: JSON.stringify({
                                success: false,
                                error: err.message
                            })
                        });
                    }
                    break;
                }
                case 'Error':
                    console.error('❌ Agent error:', message);
                    break;
                case 'Warning':
                    console.warn('⚠️ Agent warning:', message);
                    break;
                default:
                    break;
            }
        });

        agent.on('close', () => {
            session.agentReady = false;
            if (keepAliveTimer) {
                clearInterval(keepAliveTimer);
                keepAliveTimer = null;
            }
            console.log('🔌 Agent closed');
        });

        agent.on('error', (err) => {
            console.error('❌ Agent socket error:', err);
        });

        agent.connect();
        await agent.waitForOpen();

        agent.sendSettings({
            type: 'Settings',
            audio: {
                input: {
                    encoding:    'mulaw',
                    sample_rate: 8000
                },
                output: {
                    encoding: 'mulaw',
                    sample_rate: 8000,
                    container: 'none'
                }
            },
            agent: {
                listen: {
                    provider: {
                        type: 'deepgram',
                        version: 'v1',
                        model: 'nova-3',
                    }
                },
                think: {
                    provider: {
                        type: 'open_ai',
                        model: 'gpt-4o-mini'
                    },
                    prompt,
                    functions: humanLikeFunctions
                },
                speak: {
                    provider: {
                        type: "deepgram",
                        model: "aura-2-thalia-en"
                    }
                },
                language: 'en',
                greeting: `Hello! Welcome to ${session.restaurantName || 'our restaurant'}`
            }
        });

        keepAliveTimer = setInterval(() => {
            if (agent.readyState === WebSocket.OPEN) {
                agent.sendKeepAlive({ type: 'KeepAlive' });
            }
        }, 5000);

        return agent;

    } catch (err) {
        session.agentReady = false;
        console.error('Agent init error:', err);
        throw err;
    }
}

const port = 443;
// const port = 5002;
wss.on('connection', async (ws, request) => {
    // We will bind this socket after we get the 'start' event with customParameters.callSid
    let boundSession: SessionState | null = null;

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

                const session = sessions.get(callSid);
                if (!session) {
                    console.error(`No session found for CallSid ${callSid}`);
                    return;
                }

                session.streamSid = streamSid;
                session.ws = ws;
                boundSession = session;

                // Build the dynamic prompt using session state
                const menuDataSafe = Array.isArray(session.storedMenu) ? session.storedMenu : [];
                console.log(menuDataSafe, "asd");
                console.log(session.storedCustomer, "customer");

                const updatedPrompt = `
                    Customer: ${session.storedCustomer?.success ? JSON.stringify(session.storedCustomer) : 'No customer found'}
                    Menu: ${JSON.stringify(menuDataSafe)}, Total Menu Items: ${menuDataSafe.length}

                    You are a friendly restaurant assistant. Keep responses under 50 words.

                    CRITICAL:
                    Customer Verification:

                    If customer not found (${!session.storedCustomer?.success}), ALWAYS ask for name first
                    If customer found, greet by name and proceed

                    Menu Suggestions:
                    NEVER list all menu items
                    Suggest only 2-3 best/popular items at once
                    Use menu data to personalize recommendations

                    Order Completion:
                    After taking order, confirm details
                    Say: "So that's [items] for [customer name/type]"
                    IMMEDIATELY call placeOrder() function
                    IMMEDIATELY call end_conversation() function

                    Extra Details: 
                    Restro No. ${session.restaurantNo}, Customer Phone: ${session.customerPhone}

                    WORKFLOW:
                    Greet: "Hi! What can I get you today?"
                    Take Order: Ask for specific items, suggest from menu
                    Confirm: Repeat order back to customer
                    Complete: Confirm → placeOrder() → "Thank you! Your order is being prepared." → end_conversation()

                    Be warm, efficient, and helpful. Ask one question at a time.
                    `;

                // Connect agent for this session
                try {
                    const agent: any = await connectToAgent(updatedPrompt, session);
                    session.agent = agent;
                } catch (error) {
                    console.error('Failed to initialize Deepgram agent:', error);
                    session.agent = null;
                }
                return;
            }

            // Send media payload to Deepgram
            if (data.event === 'media' && data.media?.payload) {
                const payload = Buffer.from(data.media.payload, 'base64');

                if (!boundSession) {
                    return;
                }

                if (!boundSession.agent || !boundSession.agentReady) {
                    if (boundSession.pendingAudio.length < 200) {
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
            sessions.delete(boundSession.callSid);
        }
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
});

wss.on('listening', () => {
    console.log(`WebSocket server is listening on port ${port}`);
});

server.listen(port, () => {
    console.log(`Listening on wss://localhost:${port}`);
});

// Handle graceful shutdown
process.on('SIGINT', async () => {
    console.log('\nReceived SIGINT. Closing server gracefully...');

    // Close all WebSocket connections
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.close(1000, 'Server shutting down');
        }
    });

    // Close WebSocket server
    wss.close(() => {
        console.log('WebSocket server closed');
    });

    // Close HTTPS server
    server.close(() => {
        console.log('HTTPS server closed');
        process.exit(0);
    });
});

process.on('SIGTERM', async () => {
    console.log('\nReceived SIGTERM. Closing server gracefully...');

    // Close all WebSocket connections
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.close(1000, 'Server shutting down');
        }
    });

    // Close WebSocket server
    wss.close(() => {
        console.log('WebSocket server closed');
    });

    // Close HTTPS server
    server.close(() => {
        console.log('HTTPS server closed');
        process.exit(0);
    });
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);

    // Close all WebSocket connections
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.close(1011, 'Server error');
        }
    });

    // Close WebSocket server
    wss.close(() => {
        console.log('WebSocket server closed due to error');
    });

    // Close HTTPS server
    server.close(() => {
        console.log('HTTPS server closed due to error');
        process.exit(1);
    });
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);

    // Close all WebSocket connections
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.close(1011, 'Server error');
        }
    });

    // Close WebSocket server
    wss.close(() => {
        console.log('WebSocket server closed due to error');
    });

    // Close HTTPS server
    server.close(() => {
        console.log('HTTPS server closed due to error');
        process.exit(1);
    });
});
