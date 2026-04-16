import type { WebSocket } from 'ws';

export type BaseSessionState = {
    callSid: string;
    streamSid: string | null;
    ws: WebSocket | null;
    restaurantNo: string | undefined;
    restaurantName?: string | undefined;
    customerPhone: string | undefined;
    storedMenu: any;
    storedCustomer: any;
    agent: any | null;
    agentReady: boolean;
    pendingAudio: Buffer[];
    speakProviderType?: 'deepgram' | 'eleven_labs' | 'open_ai';
};

export type OpenAISttSessionState = BaseSessionState & {
    stt_model: 'openai';
    openai: {
        stt_openai_base_url?: string;
        stt_openai_api_key?: string;
        stt_openai_model?: string;
        stt_openai_voice?: string;
    };
    elevenlabs?: never;
    deepgram?: never;
};

export type ElevenLabsSttSessionState = BaseSessionState & {
    stt_model: 'elevenlabs';
    elevenlabs: {
        stt_elevenlabs_api_key?: string;
        stt_elevenlabs_voice_id?: string;
        stt_elevenlabs_model_ai?: string;
    };
    openai?: never;
    deepgram?: never;
};

export type DeepgramSttSessionState = BaseSessionState & {
    stt_model: 'deepgram';
    deepgram: {
        stt_deepgram_language: string;
        stt_deepgram_voice: string;
    };
    openai?: never;
    elevenlabs?: never;
};

export type SessionState =
    | OpenAISttSessionState
    | ElevenLabsSttSessionState
    | DeepgramSttSessionState;

export type TwilioParsedData = Record<string, unknown>;