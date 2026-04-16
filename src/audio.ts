// `@tw2gem/audio-converter` sets `"main": "src/index.ts"`, which breaks on Node 25
// (Node refuses to "strip types" for TS files under `node_modules`). Import the
// dependency's published JS entry instead.
import { AudioConverter } from '@tw2gem/audio-converter/dist';
import { SessionState } from './types';

export async function forwardAgentAudioToTwilio(audio: unknown, session: SessionState): Promise<void> {
    let buffer: Buffer | null = null;

    if (Buffer.isBuffer(audio)) buffer = audio;
    else if (audio instanceof ArrayBuffer) buffer = Buffer.from(audio);
    else if (ArrayBuffer.isView(audio)) buffer = Buffer.from(audio.buffer, audio.byteOffset, audio.byteLength);
    else if (typeof Blob !== 'undefined' && audio instanceof Blob) buffer = Buffer.from(await audio.arrayBuffer());

    if (!buffer || session.ws?.readyState !== WebSocket.OPEN || !session.streamSid) return;

    const isOpenAISpeak = session.speakProviderType === 'open_ai';
    if (isOpenAISpeak) {
        // One line replaces your entire transcodeLinear16ToMulaw function
        const base64Mulaw = AudioConverter.convertBase64PCM24kToBase64MuLaw8k(buffer.toString('base64'));
        session.ws.send(JSON.stringify({
            event: 'media',
            streamSid: session.streamSid,
            media: { payload: base64Mulaw }
        }));
        return;
    }

    session.ws.send(JSON.stringify({
        event: 'media',
        streamSid: session.streamSid,
        media: { payload: buffer.toString('base64') }
    }));
}