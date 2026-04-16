import { DeepgramClient } from '@deepgram/sdk';
import type { SessionState } from './types';
import { CONFIG  } from './config';
import { forwardAgentAudioToTwilio } from './audio';
import { createOrder } from './api';

export const deepgram = new DeepgramClient({ apiKey: process.env.DEEPGRAM_API_KEY });

export async function connectToAgent(prompt: string, session: SessionState): Promise<any> {
    try {
        const apiKey = process.env.DEEPGRAM_API_KEY;
        if (!apiKey) {
            throw new Error('DEEPGRAM_API_KEY is not configured');
        }

        const agent = await deepgram.agent.v1.connect({
            Authorization: `Token ${apiKey}`,
        });

        let keepAliveTimer: NodeJS.Timeout | null = null;
        let speakProvider;
        console.log('Building agent settings with session:', session);
        let detectedSpeakProviderType: 'deepgram' | 'eleven_labs' | 'open_ai' = 'deepgram';
        if(session.stt_model === 'deepgram') {
            speakProvider = {
                provider:{
                    type: 'deepgram',
                version:'v1',
                model: `aura-2-thalia-${session.deepgram.stt_deepgram_language}`
                }
            };
            detectedSpeakProviderType = 'deepgram';
        } else if(session.stt_model==='elevenlabs' && session.elevenlabs?.stt_elevenlabs_api_key && session.elevenlabs?.stt_elevenlabs_voice_id) {
            speakProvider = {
                provider: {
                    type: 'eleven_labs',
                    model_id: 'eleven_multilingual_v2',
                    language_code: "en",
                },
                endpoint: {
                    url: `https://api.elevenlabs.io/v1/text-to-speech/cgSgspJ2msm6clMCkdW9/stream`,
                    headers: {
                        "xi-api-key": session.elevenlabs.stt_elevenlabs_api_key,
                        "Content-Type": "application/json"

                    }
                }
            };
            detectedSpeakProviderType = 'eleven_labs';
        } else {
            speakProvider={
                provider:{
                    type:'open_ai',
                    model:session.openai.stt_openai_model || 'tts-1',
                    voice:session.openai.stt_openai_voice
                },
                endpoint:{
                    url:`https://api.openai.com/v1/audio/speech`,
                    headers:{
                        "Authorization": `Bearer ${session.openai.stt_openai_api_key}`,
                    }
                }
            };
            detectedSpeakProviderType = 'open_ai';
        }
        const openAISpeak = detectedSpeakProviderType === 'open_ai';
        const audioOutputSettings = openAISpeak
        ? { encoding: 'linear16', sample_rate: 24000, container: 'none' }
        : { encoding: CONFIG.AUDIO_OUTPUT.encoding, sample_rate: CONFIG.AUDIO_OUTPUT.sampleRate, container: CONFIG.AUDIO_OUTPUT.container }
        
        console.log('Applying agent settings with speak provider:', speakProvider);
        agent.on('open', () => {
            console.log('✅ Agent websocket opened');
             agent.sendSettings({
            type: 'Settings',
            audio: {
                input: {
                    encoding: CONFIG.AUDIO_INPUT.encoding,
                    sample_rate: CONFIG.AUDIO_INPUT.sampleRate
                },
                output: audioOutputSettings
            },
            agent: {
                listen: {
                    provider: {
                            type: 'deepgram',
                            version:'v1',
                            model: 'nova-3'
                        }
                },
                think: {
                        provider: {
                        type: "open_ai",
                        model: "gpt-4o-mini",
                },
                },
                speak: speakProvider,
                language: 'en',
                greeting: `Hello! Welcome to ${session.restaurantName || 'our restaurant'}`
            }
        });

        });

        agent.on('message', async (message: any) => {
            console.log('📩 Agent message received:', message);
            const isBinaryAudio =
                Buffer.isBuffer(message) ||
                message instanceof ArrayBuffer ||
                ArrayBuffer.isView(message) ||
                (typeof Blob !== 'undefined' && message instanceof Blob);

            if (isBinaryAudio) {
                let buf: Buffer;
                if (Buffer.isBuffer(message)) {
                    console.log('is buffereddd')
                    buf = message;
                } else if (message instanceof ArrayBuffer) {
                    console.log('is array buffer')
                    buf = Buffer.from(message);
                } else if (ArrayBuffer.isView(message)) {
                    console.log('is array buffer view')

                    buf = Buffer.from(message as Uint8Array);
                } else if (typeof Blob !== 'undefined' && message instanceof Blob) {
                    console.log('is blob')
                    const arrayBuffer = await message.arrayBuffer();
                    buf = Buffer.from(arrayBuffer);
                } else {
                    console.log('Unknown audio message format');
                    buf = Buffer.from(message as unknown as ArrayBuffer);
                }
                console.log('🔊 Audio chunk size:', buf.length);
                console.log('🔊 First bytes:', buf.subarray(0, 10));

                await forwardAgentAudioToTwilio(buf, session);
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
                            const result = await createOrder(args, session.restaurantNo || '');

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
        
        session.speakProviderType = detectedSpeakProviderType;
       
        keepAliveTimer = setInterval(() => {
            if (agent.readyState === WebSocket.OPEN) {
                agent.sendKeepAlive({ type: 'KeepAlive' });
            }
        }, CONFIG.KEEPALIVE_INTERVAL_MS);

        return agent;

    } catch (err) {
        session.agentReady = false;
        console.error('Agent init error:', err);
        throw err;
    }
}

export function buildDynamicPrompt(session: SessionState): string {
    const menuDataSafe = Array.isArray(session.storedMenu) ? session.storedMenu : [];

    return `
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
}
