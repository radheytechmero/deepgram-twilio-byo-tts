import type { SessionState, TwilioParsedData } from './types';

export const sessions = new Map<string, SessionState>();

function createDefaultSessionState(params: {
    callSid: string;
    restaurantNo: string | undefined;
    customerPhone: string | undefined;
}): SessionState {
    return {
        callSid: params.callSid,
        streamSid: null,
        ws: null,
        restaurantNo: params.restaurantNo,
        customerPhone: params.customerPhone,
        storedMenu: { data: [] },
        storedCustomer: null,
        agent: null,
        agentReady: false,
        pendingAudio: [],
        stt_model: 'deepgram',
        deepgram: {
            stt_deepgram_language: 'en',
            stt_deepgram_voice: 'nova-3'
        }
    };
}

export function createSessionStateFromParsed(
    params: {
        callSid: string;
        restaurantNo: string | undefined;
        customerPhone: string | undefined;
    },
    parsed: TwilioParsedData
): SessionState {
    const baseState = {
        callSid: params.callSid,
        streamSid: null,
        ws: null,
        restaurantNo: params.restaurantNo,
        customerPhone: params.customerPhone,
        storedMenu: { data: [] },
        storedCustomer: null,
        agent: null,
        agentReady: false,
        pendingAudio: []
    };

    switch (parsed.stt_model) {
        case 'openai':
            return {
                ...baseState,
                stt_model: 'openai',
                openai: {
                    stt_openai_base_url: typeof parsed.stt_openai_base_url === 'string' ? parsed.stt_openai_base_url : undefined,
                    stt_openai_api_key: typeof parsed.stt_openai_api_key === 'string' ? parsed.stt_openai_api_key : undefined,
                    stt_openai_model: typeof parsed.stt_openai_model === 'string' ? parsed.stt_openai_model : undefined,
                    stt_openai_voice: typeof parsed.stt_openai_voice === 'string' ? parsed.stt_openai_voice : undefined
                }
            };
        case 'elevenlabs':
            return {
                ...baseState,
                stt_model: 'elevenlabs',
                elevenlabs: {
                    stt_elevenlabs_api_key: typeof parsed.stt_elevenlabs_api_key === 'string' ? parsed.stt_elevenlabs_api_key : undefined,
                    stt_elevenlabs_voice_id: typeof parsed.stt_elevenlabs_voice_id === 'string' ? parsed.stt_elevenlabs_voice_id : undefined
                }
            };
        case 'deepgram':
            return {
                ...baseState,
                stt_model: 'deepgram',
                deepgram: {
                    stt_deepgram_language: typeof parsed.stt_deepgram_language === 'string' ? parsed.stt_deepgram_language : 'en',
                    stt_deepgram_voice: typeof parsed.stt_deepgram_voice === 'string' ? parsed.stt_deepgram_voice : 'nova-3'
                }
            };
        default:
            return createDefaultSessionState(params);
    }
}

export function createOrUpdateSession(
    callSid: string,
    restaurantNo: string,
    customerPhone: string,
    parsed?: TwilioParsedData
): SessionState {
    const existing = sessions.get(callSid);
    const session: SessionState = existing ?? createSessionStateFromParsed({
        callSid,
        restaurantNo,
        customerPhone
    }, parsed || {});
    session.restaurantNo = restaurantNo;
    session.customerPhone = customerPhone;
    session.agentReady = false;
    session.pendingAudio = [];
    sessions.set(callSid, session);
    return session;
}

export function getSession(callSid: string): SessionState | undefined {
    return sessions.get(callSid);
}

export function deleteSession(callSid: string): boolean {
    return sessions.delete(callSid);
}

export function getListenProvider(session: SessionState) {
    switch (session.stt_model) {
        case 'openai':
            throw new Error('OpenAI STT session config is defined, but Deepgram agent listen.provider currently supports only Deepgram STT.');
        case 'elevenlabs':
            throw new Error('ElevenLabs STT session config is defined, but Deepgram agent listen.provider currently supports only Deepgram STT.');
        case 'deepgram':
            return {
                type: 'deepgram' as const,
                version: 'v1' as const,
                model: session.deepgram.stt_deepgram_voice,
                language: session.deepgram.stt_deepgram_language
            };
    }
}